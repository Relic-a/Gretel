# Gretel updater signing

Gretel uses Tauri's signed updater. The public verification key is embedded in `src-tauri/tauri.conf.json`; the matching private key must never be committed.

Before intentionally publishing the first updater-enabled release, add the private key to the repository's GitHub Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: the complete contents of the matching private key file.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the key password, or an empty value for an unencrypted key.

The release workflow creates signed updater archives for AppImage, NSIS, and macOS, then publishes `latest.json`. Existing `.deb`, `.rpm`, Arch, AppImage, Windows, and macOS packages remain available.

Keep an offline backup of the private key. Losing it prevents installed copies of Gretel from trusting future updates. Rotating the key requires distributing a normal installer containing the new public key.
