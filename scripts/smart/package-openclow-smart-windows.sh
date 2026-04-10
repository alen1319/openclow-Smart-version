#!/usr/bin/env bash
set -euo pipefail

# Build a portable OpenClow Smart source bundle for Windows deployment.
#
# Output:
#   dist/smart-release/openclow-smart-win-<version>-<commit>.zip
#   dist/smart-release/openclow-smart-win-<version>-<commit>.sha256
#
# Optional overrides:
#   SMART_BUNDLE_OUT_DIR
#   SMART_BUNDLE_NAME
#   SMART_BUNDLE_RUN_CHECKS=0|1

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="${SMART_BUNDLE_OUT_DIR:-$ROOT_DIR/dist/smart-release}"
RUN_CHECKS="${SMART_BUNDLE_RUN_CHECKS:-1}"

VERSION="$(cd "$ROOT_DIR" && node -p "require('./package.json').version")"
COMMIT="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
DIRTY=""
if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
  DIRTY="-dirty"
fi

BUNDLE_NAME="${SMART_BUNDLE_NAME:-openclow-smart-win-${VERSION}-${COMMIT}${DIRTY}}"
ARCHIVE_PATH="$OUT_DIR/${BUNDLE_NAME}.zip"
SHA_PATH="$OUT_DIR/${BUNDLE_NAME}.sha256"

log() {
  printf '[openclow-smart] %s\n' "$*"
}

fail() {
  printf '[openclow-smart] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "Missing required command: $cmd"
}

preflight() {
  if [[ "$RUN_CHECKS" != "1" ]]; then
    log "Skipping preflight checks (SMART_BUNDLE_RUN_CHECKS=$RUN_CHECKS)"
    return
  fi

  log "Running preflight checks before packaging"
  (
    cd "$ROOT_DIR"
    pnpm check:base-config-schema
    pnpm config:docs:check
    pnpm build
    pnpm build:strict-smoke
  )
}

create_archive() {
  mkdir -p "$OUT_DIR"
  rm -f "$ARCHIVE_PATH" "$SHA_PATH"

  local tmp_dir stage_dir
  tmp_dir="$(mktemp -d)"
  stage_dir="$tmp_dir/openclow-smart-version"

  log "Staging source snapshot"
  mkdir -p "$stage_dir"
  rsync -a \
    --exclude '.git/' \
    --exclude 'node_modules/' \
    --exclude '.openclaw/' \
    --exclude '.pnpm-store/' \
    --exclude 'dist/' \
    --exclude '.DS_Store' \
    "$ROOT_DIR/" "$stage_dir/"

  log "Writing bundle metadata"
  cat >"$stage_dir/SMART_BUNDLE_INFO.txt" <<EOF
bundleName=${BUNDLE_NAME}
version=${VERSION}
commit=${COMMIT}
dirty=${DIRTY:-clean}
createdAtUtc=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
targetPlatform=windows
recommendedInstallScript=scripts/smart/install-openclow-smart-windows.ps1
recommendedVerifyScript=scripts/smart/verify-openclow-smart-runtime-windows.ps1
EOF

  log "Creating archive $ARCHIVE_PATH"
  (
    cd "$tmp_dir"
    zip -qr "$ARCHIVE_PATH" "openclow-smart-version"
  )

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$ARCHIVE_PATH" >"$SHA_PATH"
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$ARCHIVE_PATH" >"$SHA_PATH"
  else
    fail "Missing checksum tool (shasum or sha256sum)"
  fi

  rm -rf "$tmp_dir"
}

print_summary() {
  printf '\n'
  printf 'Windows bundle created:\n'
  printf '  %s\n' "$ARCHIVE_PATH"
  printf '  %s\n' "$SHA_PATH"
  printf '\n'
  printf 'Deploy on Windows host (PowerShell):\n'
  printf '  1) Expand-Archive %s -DestinationPath .\n' "$(basename "$ARCHIVE_PATH")"
  printf '  2) cd .\\openclow-smart-version\n'
  printf '  3) powershell -ExecutionPolicy Bypass -File .\\scripts\\smart\\install-openclow-smart-windows.ps1\n'
  printf '  4) powershell -ExecutionPolicy Bypass -File .\\scripts\\smart\\verify-openclow-smart-runtime-windows.ps1\n'
}

main() {
  require_command node
  require_command pnpm
  require_command git
  require_command rsync
  require_command zip
  preflight
  create_archive
  print_summary
}

main "$@"
