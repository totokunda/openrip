#!/bin/bash
# Build OpenRip for this Mac and put it in /Applications, as an update would: a running OpenRip
# is left alone until it quits, the app it replaces is kept in ~/Library/Caches/OpenRip/previous/
# (to go back: move it to /Applications), and the new one isn't opened.
#
#   npm run install:mac                  (in apps/app)
#   npm run install:mac -- --no-build    installs the last build again
set -euo pipefail
cd "$(dirname "$0")/.."

case "$(uname -m)" in
  arm64) arch=arm64 app=dist/mac-arm64/OpenRip.app ;;
  *) arch=x64 app=dist/mac/OpenRip.app ;;
esac
[ "${1:-}" = "--no-build" ] || node scripts/build-app.js --platform darwin --arch "$arch"
[ -d "$app" ] || { echo "No build at $app" >&2; exit 1; }

if pgrep -x OpenRip >/dev/null; then
  echo "OpenRip is open: the new build goes in when you quit it."
  while pgrep -x OpenRip >/dev/null; do sleep 2; done
fi

previous="$HOME/Library/Caches/OpenRip/previous"
mkdir -p "$previous"
if [ -d /Applications/OpenRip.app ]; then
  rm -rf "$previous/OpenRip.app"
  mv /Applications/OpenRip.app "$previous/"
fi
ditto "$app" /Applications/OpenRip.app
echo "Installed OpenRip from $(git rev-parse --short HEAD) ($(git branch --show-current)). The one it replaced is in $previous."
