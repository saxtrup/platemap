#!/bin/sh
set -eu
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export PWD="$ROOT"
export LOG="${TMPDIR:-/tmp}/formtopo-dev.log"

if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi

# New process session so this outlives the agent task (max_runtime).
python3 -c "
import os, subprocess
from pathlib import Path
root = Path(os.environ['PWD']).resolve()
log = open(os.environ['LOG'], 'ab', buffering=0)
subprocess.Popen(
    ['npm', 'run', 'dev'],
    cwd=root,
    stdin=subprocess.DEVNULL,
    stdout=log,
    stderr=subprocess.STDOUT,
    start_new_session=True,
)
" 

for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8080/; then
    exit 0
  fi
  sleep 0.4
done
exit 0
