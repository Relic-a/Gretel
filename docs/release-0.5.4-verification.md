# Gretel 0.5.4 release verification

Verified on 2026-09-07 (America/Los_Angeles).

- [Published release](https://github.com/Relic-a/Gretel/releases/tag/v0.5.4)
- [Successful release workflow](https://github.com/Relic-a/Gretel/actions/runs/34172549598)
- Release source: `e3aa9e6`.

## Updater defect and repair

The unmodified 0.5.3 desktop app logged:

```text
Detect installation type: Command update_install_mode not allowed by ACL
```

The production frontend runs at `http://127.0.0.1:<port>`. Its capability allowed
the updater plugin but did not explicitly allow the application command used to
detect Arch installations. Version 0.5.4 adds that permission to the same
loopback-only, main-window capability. The configuration regression test checks
the command grant and remote URL scope.

A native IPC probe reproduced the denial in 0.5.3 and verified the repair in
0.5.4. The probe used a temporary Node preload to serve a small page from the
packaged server's loopback origin and invoked the real native commands. It did
not mock Tauri IPC or the GitHub update check.

## Completed checks

| Check | Result |
| --- | --- |
| Local `npm test` and `npm run lint` | Passed |
| CI source validation and Windows, macOS, Linux, Arch packaging | Passed |
| Published inventory | 13 nonempty assets; all six updater manifest targets reference published artifacts and signatures |
| Download integrity | Arch package, AppImage, detached signature, and manifest match GitHub's published SHA-256 digests |
| Published Arch package startup and native IPC | Version 0.5.4; installation mode `manual`; update check succeeds |
| Live update discovery | Version 0.5.3 discovers 0.5.4; version 0.5.4 reports no update |
| Signed AppImage download and installation | Real Tauri updater verifies and installs the published 212,310,520-byte artifact over a disposable 0.5.3 AppImage |
| Launch after installation | Updated AppImage starts its packaged server and reports version 0.5.4, installation mode `automatic`, and no newer update |
| Profile preservation | Exact profile record equality through the packaged backend before and after the AppImage upgrade |
| Invalid payload/signature controls | A valid signed 0.5.3 fixture succeeds; a modified payload and altered detached signature are rejected; the old executable remains unchanged |

The download/install harness uses the release's `tauri-plugin-updater` version
2.11.0 and production public key. Positive release testing uses the real HTTPS
endpoint. Negative controls serve signed fixtures over a loopback-only HTTP
server, with insecure transport enabled only in the disposable harness.

## Scope and local findings

- The installed Arch package was not replaced. The downloaded Arch package was
  extracted and launched with isolated data. Arch installation remains a manual
  package-manager operation.
- The AppImage installation used the real updater library and an actual old
  release file. Launch after installation was performed by the verifier; the UI
  update button and process plugin's automatic relaunch were not exercised.
- Native Windows/macOS installation and the full release qualification matrix
  were not run on this machine. CI built their release artifacts successfully.
- The existing machine installation's Node executable had a pacman checksum
  mismatch and crashed even on `--version`. The clean 0.5.3 download and the
  published 0.5.4 Arch runtime both ran successfully. This local modification was
  separate from the reproducible updater permission defect.

Evidence and the disposable harness are retained on the verification machine in
`$HOME/.cache/gretel-release-0.5.4-verification/`, including `report.json`, native
IPC reports, signature logs, profile snapshots, and the published update log.
Downloads and checksums are in `$HOME/Downloads/Gretel-0.5.4/`.
