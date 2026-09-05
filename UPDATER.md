# Gretel updater signing

Gretel uses Tauri's signed updater. The public verification key is embedded in `src-tauri/tauri.conf.json`; the matching private key must never be committed.

Before intentionally publishing the first updater-enabled release, add the private key to the repository's GitHub Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: the complete contents of the matching private key file.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the key password, or an empty value for an unencrypted key.

The single tag-driven release workflow builds all platforms in parallel, packages Arch from the same verified Debian payload, and publishes only after the complete asset inventory passes validation. It creates package-specific signed updater entries for AppImage, `.deb`, `.rpm`, NSIS, and macOS. Arch installations are marked during packaging and direct users to the matching `.pkg.tar.zst` release asset for installation through `pacman`.

Do not publish platform packages from a separate workflow. Keeping creation in the tag workflow ensures a release cannot appear before its Arch package or any other required artifact exists.

Keep an offline backup of the private key. Losing it prevents installed copies of Gretel from trusting future updates. Rotating the key requires distributing a normal installer containing the new public key.

Update failures show the failing stage and the error returned by Tauri in the update notification. Both automatic and manual checks, installation failures, and restart failures are also reported to the local `gretel.log` as `client.error` entries with `source: "updater"` and `clientDetails.stage`. Reporting uses the desktop API token; these diagnostics stay on the local server. Error messages are limited to 2,000 characters.
