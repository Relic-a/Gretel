export const RELEASES_URL = "https://github.com/Relic-a/Gretel/releases";
export const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;
export const ISSUES_URL = "https://github.com/Relic-a/Gretel/issues";

const ASSET_BASE = `${LATEST_RELEASE_URL}/download`;

export type DownloadTarget = {
  id: string;
  label: string;
  detail: string;
  fileName: string;
  url: string;
};

/**
 * Release asset names are produced by scripts/verify-release-assets.mjs and the
 * Tauri bundlers. Keeping this mapping in one place lets the landing page link
 * straight at the newest installer instead of sending people to the releases
 * page to hunt for the right file.
 */
export function buildDownloadTargets(version: string): DownloadTarget[] {
  const archVersion = version.replaceAll("-", "_");

  const asset = (fileName: string, label: string, detail: string): DownloadTarget => ({
    id: fileName,
    label,
    detail,
    fileName,
    url: `${ASSET_BASE}/${encodeURIComponent(fileName)}`
  });

  return [
    asset(`Gretel_${version}_x64-setup.exe`, "Windows", "Windows 10 and 11, 64-bit"),
    asset(`Gretel_${version}_aarch64.dmg`, "macOS", "Apple silicon (M-series)"),
    asset(`Gretel_${version}_amd64.deb`, "Linux (.deb)", "Debian, Ubuntu, Pop!_OS"),
    asset(`Gretel_${version}_amd64.AppImage`, "Linux (AppImage)", "Portable, most distributions"),
    asset(`Gretel-${version}-1.x86_64.rpm`, "Linux (.rpm)", "Fedora, openSUSE, RHEL"),
    asset(`gretel-${archVersion}-1-x86_64.pkg.tar.zst`, "Arch Linux", "pacman package")
  ];
}
