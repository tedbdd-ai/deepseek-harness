#!/bin/bash
# Builds the Safari container app "Atelier Clipper" from ../clipper, signs it to run locally and,
# with --install, copies it to ~/Applications and opens it once so Safari registers the extension.
set -euo pipefail
here="$(cd -- "$(dirname -- "$0")" && pwd -P)"
build="$here/build"
xcodebuild -project "$here/Atelier Clipper/Atelier Clipper.xcodeproj" -scheme "Atelier Clipper" -configuration Release \
  -derivedDataPath "$build" CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= -quiet build
app="$build/Build/Products/Release/Atelier Clipper.app"
echo "Gebaut: $app"
if [[ "${1:-}" == "--install" ]]; then
  target="$HOME/Applications/Atelier Clipper.app"
  mkdir -p "$HOME/Applications"
  rm -rf "$target"
  cp -R "$app" "$target"
  open "$target"
  echo "Installiert: $target"
fi
