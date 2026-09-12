#!/usr/bin/env bash
# Installs the showcase typeface (Space Mono) for the rendering user.
#
# The Remotion composition asks for "Space Mono" by name instead of fetching the
# woff2 at render time: `loadFont()` keeps a delayRender() open until the
# FontFace resolves, and a long concurrent render churns through many browser
# pages, which makes that wait unreliable. Installing the font system-wide
# removes the dependency on any single page's fetch.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FONT_DIR="${HOME}/.fonts"

mkdir -p "${FONT_DIR}"
cp "${HERE}/../public/fonts/"*.woff2 "${FONT_DIR}/"

if command -v fc-cache >/dev/null 2>&1; then
  fc-cache -f "${FONT_DIR}" >/dev/null
  echo "Installed $(ls "${FONT_DIR}"/space-mono-*.woff2 | wc -l) Space Mono faces into ${FONT_DIR}"
  fc-list | grep -i "space mono" | sed 's/^/  /'
else
  echo "fontconfig (fc-cache) not found."
  echo "Install it first, e.g.: sudo apt-get install -y fontconfig"
  exit 1
fi
