#!/usr/bin/env bash

set -euo pipefail

release_tag=${1:?Release tag is required}
deb_path=${2:?Debian package path is required}
output_dir=${3:?Output directory is required}

if [[ ! "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid release tag: $release_tag" >&2
  exit 1
fi

if [[ ! -s "$deb_path" ]]; then
  echo "Debian package is missing or empty: $deb_path" >&2
  exit 1
fi

release_version=${release_tag#v}
arch_version=${release_version//-/_}
deb_checksum=$(sha256sum "$deb_path" | cut -d ' ' -f 1)
package_root=$(mktemp -d "${TMPDIR:-/tmp}/gretel-arch-package.XXXXXX")
trap 'rm -rf "$package_root"' EXIT

cp "$deb_path" "$package_root/gretel.deb"

cat > "$package_root/PKGBUILD" <<EOF
pkgname=gretel
pkgver=$arch_version
pkgrel=1
pkgdesc='Build a more intentional YouTube feed'
arch=('x86_64')
url='https://github.com/Relic-a/Gretel'
license=('custom')
depends=('webkit2gtk-4.1' 'gtk3' 'gst-plugins-good' 'gst-plugins-bad' 'gst-libav')
options=('!strip')
source=('gretel.deb')
noextract=('gretel.deb')
sha256sums=('$deb_checksum')

package() {
  ar p "\$srcdir/gretel.deb" data.tar.gz | bsdtar -xzf - -C "\$pkgdir"
  touch "\$pkgdir/usr/lib/Gretel/.arch-package"
}
EOF

mkdir -p "$output_dir"
(
  cd "$package_root"
  PKGDEST="$output_dir" makepkg --force --noconfirm --nodeps
)

package_count=$(find "$output_dir" -maxdepth 1 -type f -name '*-x86_64.pkg.tar.zst' | wc -l)
if [[ "$package_count" -ne 1 ]]; then
  echo "Expected one x86_64 pacman package, found $package_count." >&2
  exit 1
fi
