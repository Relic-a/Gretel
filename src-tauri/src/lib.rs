use std::{
    env,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};

use tauri::{Manager, RunEvent, Url, WebviewWindow};

struct ServerProcess(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    configure_linux_rendering();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) || tauri_debug_mode() {
                // `tauri dev` (including `tauri dev --release`) starts Next.js through
                // beforeDevCommand and loads devUrl.
                return Ok(());
            }

            let port = find_available_port().map_err(to_boxed_error)?;
            let api_token = generate_api_token();
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| "The Gretel main window was not created.".to_string())?;
            let server = start_production_server(app, port, &api_token).map_err(to_boxed_error)?;
            app.manage(ServerProcess(Mutex::new(Some(server))));

            // Returning from setup lets the bundled startup page paint immediately
            // while Node and Next.js warm up away from Tauri's setup thread.
            let token_clone = api_token.clone();
            thread::spawn(move || {
                let result = wait_for_server(port, Duration::from_secs(30))
                    .and_then(|_| navigate_to_server(&window, port, &token_clone));

                if let Err(error) = result {
                    eprintln!("Gretel startup failed: {error}");
                    let _ = window.eval(startup_error_script(&error));

                    if let Some(server) = window.app_handle().try_state::<ServerProcess>() {
                        stop_managed_server(&server);
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Gretel Tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(server) = app_handle.try_state::<ServerProcess>() {
                    stop_managed_server(&server);
                }
            }
        });
}

#[cfg(target_os = "linux")]
#[derive(Debug, PartialEq, Eq)]
enum LinuxRenderingMode {
    Default,
    NvidiaWayland,
    DisableDmabuf,
}

#[cfg(target_os = "linux")]
impl LinuxRenderingMode {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::NvidiaWayland => "nvidia-wayland",
            Self::DisableDmabuf => "disable-dmabuf",
        }
    }
}

#[cfg(target_os = "linux")]
fn configure_linux_rendering() {
    let session = linux_display_session();
    let gpu_vendors = detect_linux_gpu_vendors();
    let requested = env::var("GRETEL_RENDER_MODE").unwrap_or_else(|_| "default".to_string());
    let selected = select_linux_rendering_mode(&requested, &session, &gpu_vendors);

    match selected {
        LinuxRenderingMode::NvidiaWayland => {
            if env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none() {
                env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
            }
        }
        LinuxRenderingMode::DisableDmabuf => {
            if env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
                env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
        }
        LinuxRenderingMode::Default => {}
    }

    let webkit_version = detect_webkit_version().unwrap_or_else(|| "unknown".to_string());
    eprintln!(
        "{{\"event\":\"gretel.renderer_config\",\"session\":\"{}\",\"gpuVendors\":\"{}\",\"webkitVersion\":\"{}\",\"requestedMode\":\"{}\",\"renderingMode\":\"{}\"}}",
        log_value(&session),
        log_value(&gpu_vendors.join("+")),
        log_value(&webkit_version),
        log_value(&requested),
        selected.as_str()
    );
}

#[cfg(target_os = "linux")]
fn select_linux_rendering_mode(
    requested: &str,
    session: &str,
    gpu_vendors: &[String],
) -> LinuxRenderingMode {
    match requested.trim().to_ascii_lowercase().as_str() {
        "nvidia-wayland"
            if session == "wayland" && gpu_vendors.iter().any(|vendor| vendor == "nvidia") =>
        {
            LinuxRenderingMode::NvidiaWayland
        }
        "disable-dmabuf" => LinuxRenderingMode::DisableDmabuf,
        _ => LinuxRenderingMode::Default,
    }
}

#[cfg(target_os = "linux")]
fn linux_display_session() -> String {
    let session_type = env::var("XDG_SESSION_TYPE")
        .unwrap_or_default()
        .to_ascii_lowercase();

    if session_type == "wayland" || env::var_os("WAYLAND_DISPLAY").is_some() {
        "wayland".to_string()
    } else if session_type == "x11" || env::var_os("DISPLAY").is_some() {
        "x11".to_string()
    } else {
        "unknown".to_string()
    }
}

#[cfg(target_os = "linux")]
fn detect_linux_gpu_vendors() -> Vec<String> {
    let mut vendors = Vec::new();
    let Ok(cards) = std::fs::read_dir("/sys/class/drm") else {
        return vec!["unknown".to_string()];
    };

    for card in cards.flatten() {
        let card_name = card.file_name();
        let card_name = card_name.to_string_lossy();
        if !card_name.starts_with("card") || card_name.contains('-') {
            continue;
        }

        let Ok(vendor) = std::fs::read_to_string(card.path().join("device/vendor")) else {
            continue;
        };
        let vendor = match vendor.trim().to_ascii_lowercase().as_str() {
            "0x10de" => "nvidia",
            "0x1002" => "amd",
            "0x8086" => "intel",
            _ => "other",
        };
        if !vendors.iter().any(|existing| existing == vendor) {
            vendors.push(vendor.to_string());
        }
    }

    vendors.sort();
    if vendors.is_empty() {
        vendors.push("unknown".to_string());
    }
    vendors
}

#[cfg(target_os = "linux")]
fn detect_webkit_version() -> Option<String> {
    ["webkit2gtk-4.1", "webkit2gtk-4.0"]
        .into_iter()
        .find_map(|package| {
            let output = Command::new("pkg-config")
                .args(["--modversion", package])
                .output()
                .ok()?;
            output
                .status
                .success()
                .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
        })
        .filter(|version| !version.is_empty())
}

#[cfg(target_os = "linux")]
fn log_value(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            '"' | '\\' => ' ',
            other if other.is_control() => ' ',
            other => other,
        })
        .collect()
}

fn stop_managed_server(server: &ServerProcess) {
    if let Ok(mut child) = server.0.lock() {
        if let Some(child) = child.as_mut() {
            stop_server(child);
        }
        child.take();
    }
}

fn stop_server(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn tauri_debug_mode() -> bool {
    matches!(
        env::var("TAURI_ENV_DEBUG").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("True")
    )
}

fn to_boxed_error(error: String) -> Box<dyn std::error::Error> {
    std::io::Error::other(error).into()
}

fn start_production_server<R: tauri::Runtime>(
    app: &tauri::App<R>,
    port: u16,
    api_token: &str,
) -> Result<Child, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Could not resolve Gretel resources: {error}"))?;
    let server_root = find_server_root(&resource_dir)?;
    let node = find_node_runtime(&resource_dir)?;
    let data_dir = resolve_data_dir(app)?;
    let log_file = data_dir
        .parent()
        .unwrap_or(&data_dir)
        .join("logs")
        .join("gretel.log");

    let mut command = Command::new(node);
    command
        // Pass the entry point relative to `current_dir`. On Windows, the
        // resource directory may use an extended-length path prefix that Node
        // does not reliably accept as its script argument.
        .arg("server.js")
        .current_dir(&server_root)
        .env("NODE_ENV", "production")
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("GRETEL_DATA_DIR", data_dir)
        .env("GRETEL_API_TOKEN", api_token)
        .env("NEXT_TELEMETRY_DISABLED", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    configure_background_process(&mut command);

    if env::var_os("GRETEL_CONFIG").is_none() {
        let bundled_config = resource_dir.join("config").join("gretel.config.json");
        if bundled_config.is_file() {
            command.env("GRETEL_CONFIG", bundled_config);
        }
    }

    if env::var_os("GRETEL_LOG_FILE").is_none() {
        command.env("GRETEL_LOG_FILE", log_file);
    }

    #[cfg(target_os = "linux")]
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(|| {
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
            Ok(())
        });
    }

    let child = command
        .spawn()
        .map_err(|error| format!("Could not start Gretel's embedded server: {error}"))?;

    #[cfg(target_os = "windows")]
    attach_to_job_object(&child);

    Ok(child)
}

#[cfg(target_os = "windows")]
fn attach_to_job_object(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if !job.is_null() {
            let mut info = std::mem::zeroed::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            AssignProcessToJobObject(job, child.as_raw_handle() as _);
        }
    }
}

#[cfg(target_os = "windows")]
fn configure_background_process(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    // Node is a console-subsystem executable. Without this flag Windows opens a
    // terminal alongside the otherwise GUI-only Gretel executable.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
}

#[cfg(not(target_os = "windows"))]
fn configure_background_process(_command: &mut Command) {}

fn resolve_data_dir<R: tauri::Runtime>(app: &tauri::App<R>) -> Result<PathBuf, String> {
    if let Some(configured) = env::var_os("GRETEL_DATA_DIR") {
        return Ok(PathBuf::from(configured));
    }

    let current = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve Gretel data directory: {error}"))?
        .join("data");

    let current_has_files = std::fs::read_dir(&current)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false);

    if current_has_files {
        return Ok(current);
    }

    if let Some(legacy) = legacy_data_dir() {
        if legacy.exists() {
            return Ok(legacy);
        }
    }

    Ok(current)
}

fn legacy_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        return env::var_os("APPDATA")
            .map(PathBuf::from)
            .map(|root| root.join("Gretel").join("data"));
    }

    #[cfg(target_os = "macos")]
    {
        let home = env::var_os("HOME").map(PathBuf::from);
        return home.map(|root| {
            root.join("Library")
                .join("Application Support")
                .join("Gretel")
                .join("data")
        });
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let home = env::var_os("HOME").map(PathBuf::from);
        let config_root = env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| home.map(|root| root.join(".config")));
        config_root.map(|root| root.join("Gretel").join("data"))
    }
}

fn find_server_root(resource_dir: &Path) -> Result<PathBuf, String> {
    let candidates = [
        resource_dir.join(".next").join("standalone"),
        resource_dir.join("standalone"),
    ];

    candidates
        .into_iter()
        .find(|candidate| candidate.join("server.js").is_file())
        .ok_or_else(|| {
            format!(
                "The bundled Next.js server was not found in {}.",
                resource_dir.display()
            )
        })
}

fn find_node_runtime(resource_dir: &Path) -> Result<PathBuf, String> {
    let candidates = [
        resource_dir.join("node-runtime").join("node.exe"),
        resource_dir.join("node-runtime").join("node"),
        resource_dir.join("node.exe"),
        resource_dir.join("node"),
    ];

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            format!(
                "The bundled Node.js runtime was not found in {}.",
                resource_dir.display()
            )
        })
}

fn find_available_port() -> Result<u16, String> {
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|error| format!("Could not find an available local port: {error}"))
}

fn generate_api_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = std::process::id();
    format!("gretel_{:x}{:x}", nanos, pid)
}

fn wait_for_server(port: u16, timeout: Duration) -> Result<(), String> {
    let started = std::time::Instant::now();
    let address = SocketAddr::from(([127, 0, 0, 1], port));

    while started.elapsed() < timeout {
        if let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(500)) {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            let _ =
                stream.write_all(b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
            let mut response = [0_u8; 32];
            if let Ok(read) = stream.read(&mut response) {
                if read > 0
                    && (response[..read].starts_with(b"HTTP/1.1 2")
                        || response[..read].starts_with(b"HTTP/1.0 2"))
                {
                    return Ok(());
                }
            }
        }

        thread::sleep(Duration::from_millis(250));
    }

    Err(format!(
        "Timed out waiting for Gretel's local server on port {port}."
    ))
}

fn navigate_to_server<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
    port: u16,
    api_token: &str,
) -> Result<(), String> {
    let url = Url::parse(&format!("http://127.0.0.1:{port}/?token={api_token}"))
        .map_err(|error| format!("Could not build Gretel server URL: {error}"))?;
    window
        .navigate(url)
        .map_err(|error| format!("Could not load Gretel's local server: {error}"))
}

fn startup_error_script(error: &str) -> String {
    let escaped = error
        .replace('\\', "\\\\")
        .replace('`', "\\`")
        .replace("${", "\\${")
        .replace('\n', " ")
        .replace('\r', " ");

    format!(
        "document.body.dataset.state='error';document.getElementById('startup-status').textContent=`{escaped}`;"
    )
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::{select_linux_rendering_mode, LinuxRenderingMode};

    #[test]
    fn nvidia_workaround_requires_nvidia_and_wayland() {
        let nvidia = vec!["amd".to_string(), "nvidia".to_string()];
        let amd = vec!["amd".to_string()];

        assert_eq!(
            select_linux_rendering_mode("nvidia-wayland", "wayland", &nvidia),
            LinuxRenderingMode::NvidiaWayland
        );
        assert_eq!(
            select_linux_rendering_mode("nvidia-wayland", "x11", &nvidia),
            LinuxRenderingMode::Default
        );
        assert_eq!(
            select_linux_rendering_mode("nvidia-wayland", "wayland", &amd),
            LinuxRenderingMode::Default
        );
    }

    #[test]
    fn dmabuf_fallback_is_explicit_and_vendor_independent() {
        assert_eq!(
            select_linux_rendering_mode("disable-dmabuf", "x11", &["intel".to_string()]),
            LinuxRenderingMode::DisableDmabuf
        );
        assert_eq!(
            select_linux_rendering_mode("unexpected", "wayland", &["nvidia".to_string()]),
            LinuxRenderingMode::Default
        );
    }
}
