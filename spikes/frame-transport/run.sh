#!/usr/bin/env bash
# Run one transport benchmark; appends raw JSON to results.jsonl and prints a summary.
#   ./run.sh --mode=shared --file=media/test-4k60-hevc.mp4 --fmt=nv12 [--draw=canvas2d] [--seconds=8]
cd "$(dirname "$0")"
./node_modules/.bin/electron . "$@" 2>&1 | grep -E '^RESULT:' | sed 's/^RESULT://' | tee -a results.jsonl | python3 summarize.py
