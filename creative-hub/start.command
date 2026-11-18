#!/bin/bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
hub_dir="$(cd -- "$(dirname -- "$0")" && pwd -P)"
cd "$hub_dir"
port="${CREATIVITY_HUB_PORT:-3080}"
endpoint="http://127.0.0.1:$port/creativity-hub"
cli="${CREATIVITY_HUB_DSH:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}"

if [[ ! -x "$cli" ]]; then
  cli="$(command -v dsh || true)"
fi
if [[ -z "$cli" ]]; then
  echo "DeepSeek Harness wurde nicht gefunden."
  exit 1
fi

if /usr/bin/curl --noproxy '*' --silent --max-time 1 "$endpoint" >/dev/null; then
  echo "Port $port ist bereits belegt. Beende den bisherigen Webserver oder setze CREATIVITY_HUB_PORT."
  exit 1
fi

if [[ ! -s dist/assets/board.js || ! -s dist/assets/board.css || package.json -nt dist/assets/board.js || web/board.jsx -nt dist/assets/board.js || vite.config.js -nt dist/assets/board.js ]]; then
  if ! command -v npm >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) < 22 ? 1 : 0)' 2>/dev/null; then
    echo "Für den Excalidraw-Build werden Node.js ab Version 22 und npm benötigt."
    exit 1
  fi
  npm install --no-audit --no-fund
  npm run build
  if [[ ! -s dist/assets/board.js || ! -s dist/assets/board.css ]]; then
    echo "Der Excalidraw-Build hat die Editor-Dateien nicht erzeugt."
    exit 1
  fi
fi

run_dir="$(mktemp -d "${TMPDIR:-/tmp}/creativity-hub.XXXXXX")"
server_pid=''
cleanup() {
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; fi
  rm -f "$run_dir/overlay.yml"
  rmdir "$run_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

# YAML single-quoted scalars escape single quotes by doubling them.
escaped_path="$(printf '%s' "$hub_dir/host.mjs" | sed "s/'/''/g")"
printf '%s\n' '- insert:' '    - id: creativity-hub' "      name: '$escaped_path'" > "$run_dir/overlay.yml"

"$cli" web --patch "$run_dir/overlay.yml" --host 127.0.0.1 --port "$port" --no-open &
server_pid=$!

for (( attempt = 0; attempt < 100; attempt++ )); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    wait "$server_pid"
    exit 1
  fi
  code="$(/usr/bin/curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' --max-time 1 "$endpoint" || true)"
  case "$code" in
    200|301|302|303|307|308|401|403)
      /usr/bin/open "$endpoint"
      echo "Creativity Hub: $endpoint"
      echo "Dieses Fenster beim Arbeiten offen lassen. Mit Ctrl-C beendest du den Server."
      wait "$server_pid"
      exit 0
      ;;
  esac
  sleep 0.25
done
echo "Der Hub hat auf $endpoint nicht rechtzeitig geantwortet."
exit 1
