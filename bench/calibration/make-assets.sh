#!/usr/bin/env bash
# Generate the calibration marker: a 400x400 red square with a white centre block and a
# green block in the top-left corner, so position, scale, rotation and flips can be
# measured from an exported frame.
set -euo pipefail
cd "$(dirname "$0")"
ffmpeg -hide_banner -loglevel error -y -f lavfi -i color=c=red:s=400x400:d=1 \
  -vf "drawbox=x=180:y=180:w=40:h=40:color=white:t=fill,drawbox=x=0:y=0:w=60:h=60:color=lime:t=fill" \
  -frames:v 1 marker.png
echo "wrote $(pwd)/marker.png"
