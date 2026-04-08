#!/usr/bin/env bash
set -euo pipefail

# Runtime verification checklist for OpenClow Smart deployments.
#
# Optional overrides:
#   SMART_VERIFY_PORT
#   SMART_VERIFY_REPO_DIR

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

PORT="${SMART_VERIFY_PORT:-18789}"
REPO_DIR="${SMART_VERIFY_REPO_DIR:-$DEFAULT_REPO_DIR}"
FAILURES=0
GATEWAY_PID=""

log() {
  printf '[openclow-smart-verify] %s\n' "$*"
}

warn() {
  printf '[openclow-smart-verify] WARN: %s\n' "$*" >&2
}

run_check() {
  local label="$1"
  shift
  printf '\n== %s ==\n' "$label"
  if "$@"; then
    return 0
  fi
  warn "Check failed: $label"
  FAILURES=$((FAILURES + 1))
  return 1
}

print_header() {
  printf 'OpenClow Smart runtime verification\n'
  printf 'Port: %s\n' "$PORT"
  printf 'Repo: %s\n' "$REPO_DIR"
  printf 'Time: %s\n' "$(date +"%Y-%m-%d %H:%M:%S %z")"
}

derive_pid() {
  local line
  line="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $2}' || true)"
  if [[ -n "$line" ]]; then
    GATEWAY_PID="$line"
  fi
}

main() {
  print_header

  run_check "lsof listen probe" lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
  derive_pid

  if [[ -n "$GATEWAY_PID" ]]; then
    run_check "ps gateway pid" ps -fp "$GATEWAY_PID"
  else
    warn "Could not derive gateway pid from lsof output"
    FAILURES=$((FAILURES + 1))
  fi

  run_check "openclaw --version" openclaw --version
  if [[ -f "$REPO_DIR/openclaw.mjs" ]]; then
    run_check "repo openclaw.mjs --version" node "$REPO_DIR/openclaw.mjs" --version
  else
    warn "Repo entrypoint not found: $REPO_DIR/openclaw.mjs"
    FAILURES=$((FAILURES + 1))
  fi
  run_check "openclaw health --json" openclaw health --json
  run_check "openclaw gateway call health --json" openclaw gateway call health --json
  run_check "openclaw status --all" openclaw status --all
  run_check "openclaw doctor --non-interactive" openclaw doctor --non-interactive
  run_check "openclaw channels status --probe" openclaw channels status --probe

  printf '\n'
  if [[ "$FAILURES" -eq 0 ]]; then
    printf 'Verification complete: PASS\n'
    exit 0
  fi

  printf 'Verification complete: FAIL (%s checks failed)\n' "$FAILURES"
  exit 1
}

main "$@"
