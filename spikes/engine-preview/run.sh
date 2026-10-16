#!/usr/bin/env bash
# Build the engine addon and run the preview spike with the frame-transport spike's Electron 44.
set -euo pipefail
cd "$(dirname "$0")"
(cd ../../engine && cargo build --release -p openrip-node)
cp ../../engine/target/release/libopenrip_node.dylib openrip_node.node
exec ../frame-transport/node_modules/.bin/electron . "$@"
