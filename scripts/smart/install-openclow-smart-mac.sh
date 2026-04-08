#!/usr/bin/env bash
set -euo pipefail

# OpenClow Smart Version installer for macOS hosts.
#
# Default install source:
#   git@github.com:alen1319/openclow-Smart-version.git
#
# Optional overrides:
#   SMART_REPO_URL
#   SMART_REPO_REF
#   SMART_INSTALL_DIR
#   SMART_WORKSPACE_DIR
#   SMART_PNPM_VERSION
#   SMART_GATEWAY_PORT
#   SMART_RUNTIME
#   SMART_RUN_BASELINE_CHECKS=0|1
#   SMART_BOOTSTRAP_WORKSPACE=0|1
#   SMART_INSTALL_DAEMON=0|1

SMART_REPO_URL="${SMART_REPO_URL:-git@github.com:alen1319/openclow-Smart-version.git}"
SMART_REPO_REF="${SMART_REPO_REF:-main}"
SMART_INSTALL_DIR="${SMART_INSTALL_DIR:-$HOME/.openclow-smart/openclaw-full}"
SMART_WORKSPACE_DIR="${SMART_WORKSPACE_DIR:-$HOME/.openclaw/workspace}"
SMART_PNPM_VERSION="${SMART_PNPM_VERSION:-10.32.1}"
SMART_GATEWAY_PORT="${SMART_GATEWAY_PORT:-18789}"
SMART_RUNTIME="${SMART_RUNTIME:-node}"
SMART_RUN_BASELINE_CHECKS="${SMART_RUN_BASELINE_CHECKS:-1}"
SMART_BOOTSTRAP_WORKSPACE="${SMART_BOOTSTRAP_WORKSPACE:-0}"
SMART_INSTALL_DAEMON="${SMART_INSTALL_DAEMON:-1}"

NODE_TARGET_MAJOR="${SMART_NODE_TARGET_MAJOR:-24}"
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=14

log() {
  printf '[openclow-smart] %s\n' "$*"
}

warn() {
  printf '[openclow-smart] WARN: %s\n' "$*" >&2
}

fail() {
  printf '[openclow-smart] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "Missing required command: $cmd"
}

refresh_shell_cache() {
  hash -r 2>/dev/null || true
}

default_pnpm_home() {
  case "$(uname -s 2>/dev/null || true)" in
    Darwin) printf '%s\n' "$HOME/Library/pnpm" ;;
    *) printf '%s\n' "$HOME/.local/share/pnpm" ;;
  esac
}

ensure_pnpm_home() {
  if [[ -z "${PNPM_HOME:-}" ]]; then
    PNPM_HOME="$(default_pnpm_home)"
    export PNPM_HOME
  fi
  mkdir -p "$PNPM_HOME"
  case ":$PATH:" in
    *":$PNPM_HOME:"*) ;;
    *) export PATH="$PNPM_HOME:$PATH" ;;
  esac
  refresh_shell_cache
}

node_is_supported() {
  command -v node >/dev/null 2>&1 || return 1
  node -e "
    const [major, minor] = process.versions.node.split('.').map(Number);
    process.exit(major > ${NODE_MIN_MAJOR} || (major === ${NODE_MIN_MAJOR} && minor >= ${NODE_MIN_MINOR}) ? 0 : 1);
  "
}

use_brew_node() {
  require_command brew
  local prefix
  prefix="$(brew --prefix "node@${NODE_TARGET_MAJOR}" 2>/dev/null || true)"
  [[ -n "$prefix" ]] || return 1
  [[ -x "$prefix/bin/node" ]] || return 1
  export PATH="$prefix/bin:$PATH"
  refresh_shell_cache
  return 0
}

ensure_supported_node() {
  if node_is_supported; then
    log "Using Node $(node -p 'process.versions.node')"
    return
  fi

  local current_version="missing"
  if command -v node >/dev/null 2>&1; then
    current_version="$(node -p 'process.versions.node')"
  fi

  if [[ "$(uname -s 2>/dev/null || true)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    log "Node ${current_version} is unsupported, installing node@${NODE_TARGET_MAJOR} with Homebrew"
    brew install "node@${NODE_TARGET_MAJOR}"
    use_brew_node || true
    if node_is_supported; then
      log "Using Node $(node -p 'process.versions.node')"
      return
    fi
    fail "Node install completed but current shell still does not see Node >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}.0"
  fi

  fail "Node ${current_version} found. OpenClow Smart requires Node >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}.0"
}

prepare_pnpm() {
  require_command corepack
  ensure_pnpm_home
  corepack enable >/dev/null 2>&1 || true
  corepack prepare "pnpm@${SMART_PNPM_VERSION}" --activate >/dev/null
  require_command pnpm
  log "Using pnpm $(pnpm --version)"
}

prepare_checkout() {
  mkdir -p "$(dirname "$SMART_INSTALL_DIR")"
  if [[ -d "$SMART_INSTALL_DIR/.git" ]]; then
    log "Updating existing checkout at $SMART_INSTALL_DIR"
    git -C "$SMART_INSTALL_DIR" fetch --tags origin
    git -C "$SMART_INSTALL_DIR" checkout "$SMART_REPO_REF"
    if git -C "$SMART_INSTALL_DIR" rev-parse --verify "origin/$SMART_REPO_REF" >/dev/null 2>&1; then
      git -C "$SMART_INSTALL_DIR" reset --hard "origin/$SMART_REPO_REF"
    fi
    return
  fi

  if [[ -d "$SMART_INSTALL_DIR" ]]; then
    fail "Install directory exists but is not a git checkout: $SMART_INSTALL_DIR"
  fi

  log "Cloning $SMART_REPO_URL#$SMART_REPO_REF into $SMART_INSTALL_DIR"
  git clone --branch "$SMART_REPO_REF" "$SMART_REPO_URL" "$SMART_INSTALL_DIR"
}

build_smart_runtime() {
  log "Installing dependencies"
  (
    cd "$SMART_INSTALL_DIR"
    pnpm install --frozen-lockfile
    if [[ "$SMART_RUN_BASELINE_CHECKS" == "1" ]]; then
      log "Checking baseline artifacts"
      pnpm check:base-config-schema
      pnpm config:docs:check
    fi
    log "Building runtime"
    pnpm build
    pnpm build:strict-smoke
  )
}

link_cli() {
  log "Linking openclaw CLI globally"
  if (
    cd "$SMART_INSTALL_DIR"
    pnpm link --global
  ); then
    return
  fi

  warn "pnpm link --global failed on first try, retrying after PNPM_HOME refresh"
  ensure_pnpm_home
  (
    cd "$SMART_INSTALL_DIR"
    pnpm link --global
  ) || fail "Could not link openclaw globally. Ensure PNPM_HOME is on PATH."
}

install_gateway_daemon() {
  if [[ "$SMART_INSTALL_DAEMON" != "1" ]]; then
    log "Skipping daemon install (SMART_INSTALL_DAEMON=$SMART_INSTALL_DAEMON)"
    return
  fi

  log "Installing gateway daemon"
  (
    cd "$SMART_INSTALL_DIR"
    node openclaw.mjs gateway install --force --runtime "$SMART_RUNTIME" --port "$SMART_GATEWAY_PORT"
    node openclaw.mjs gateway restart
  )
}

bootstrap_workspace() {
  if [[ "$SMART_BOOTSTRAP_WORKSPACE" != "1" ]]; then
    log "Skipping workspace bootstrap (SMART_BOOTSTRAP_WORKSPACE=$SMART_BOOTSTRAP_WORKSPACE)"
    return
  fi

  log "Bootstrapping workspace at $SMART_WORKSPACE_DIR"
  (
    cd "$SMART_INSTALL_DIR"
    node openclaw.mjs setup --workspace "$SMART_WORKSPACE_DIR" --workspace-template claude-code
  )
}

runtime_smoke() {
  log "Running runtime smoke checks"
  (
    cd "$SMART_INSTALL_DIR"
    node openclaw.mjs --version
    node openclaw.mjs status --all
    node openclaw.mjs health --json
    node openclaw.mjs channels status --probe --json
  )
}

print_next_steps() {
  local global_bin
  global_bin="$(pnpm bin -g 2>/dev/null || true)"

  printf '\n'
  printf 'OpenClow Smart install complete.\n'
  printf 'Repo:      %s\n' "$SMART_INSTALL_DIR"
  printf 'Branch:    %s\n' "$SMART_REPO_REF"
  printf 'Gateway:   ws://127.0.0.1:%s\n' "$SMART_GATEWAY_PORT"
  printf 'CLI check: openclaw --version\n'
  if [[ -n "$global_bin" ]]; then
    printf 'pnpm bin:  %s\n' "$global_bin"
  fi
  if [[ -n "${PNPM_HOME:-}" ]]; then
    printf 'PNPM_HOME: %s\n' "$PNPM_HOME"
    printf 'PATH fix:  export PNPM_HOME="%s"; export PATH="$PNPM_HOME:$PATH"\n' "$PNPM_HOME"
  fi
}

main() {
  require_command git
  ensure_supported_node
  prepare_pnpm
  prepare_checkout
  build_smart_runtime
  link_cli
  install_gateway_daemon
  bootstrap_workspace
  runtime_smoke
  print_next_steps
}

main "$@"
