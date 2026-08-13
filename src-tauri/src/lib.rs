#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) || tauri_debug_mode() {
                // `tauri dev` (including `tauri dev --release`) starts Next.js through
                // beforeDevCommand and loads devUrl.
                return Ok(());
            }

            let port = find_available_port().map_err(to_boxed_error)?;
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| "The Gretel main window was not created.".to_string())?;
            let server = start_production_server(app, port).map_err(to_boxed_error)?;
            app.manage(ServerProcess(Mutex::new(Some(server))));

            // Returning from setup lets the bundled startup page paint immediately
            // while Node and Next.js warm up away from Tauri's setup thread.
            thread::spawn(move || {
                let result = wait_for_server(port, Duration::from_secs(30))
                    .and_then(|_| navigate_to_server(&window, port));

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
        .env("NEXT_TELEMETRY_DISABLED", "1")
        .stdin(Stdio::null())
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

    command
        .spawn()
        .map_err(|error| format!("Could not start Gretel's embedded server: {error}"))
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
    let candidates = [resource_dir.join("node.exe"), resource_dir.join("node")];

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
) -> Result<(), String> {
    let url = Url::parse(&format!("http://127.0.0.1:{port}"))
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
