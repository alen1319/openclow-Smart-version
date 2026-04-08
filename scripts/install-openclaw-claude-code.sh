#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${OPENCLAW_REPO_URL:-https://github.com/openclaw/openclaw.git}"
OPENCLAW_REF="${OPENCLAW_REF:-main}"
OPENCLAW_PNPM_VERSION="${OPENCLAW_PNPM_VERSION:-10.32.1}"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-$HOME/.openclaw/workspace}"
INSTALL_ROOT="${OPENCLAW_INSTALL_ROOT:-$HOME/.local/src}"
NODE_DEFAULT_MAJOR="${OPENCLAW_NODE_MAJOR:-24}"
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=14

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

REPO_DIR=""
USE_LOCAL_CHECKOUT=0
SKIP_LINK=0
RUN_ONBOARD=0
SKIP_UI_BUILD=0
AUTO_INSTALL_NODE=1
PNPM_HOME_CREATED=0

usage() {
  cat <<'EOF'
Install OpenClaw from source and bootstrap a Claude Code style workspace.

Usage:
  bash scripts/install-openclaw-claude-code.sh [options]

Options:
  --repo-dir <dir>       Source checkout to use or create.
  --workspace <dir>      Workspace path for `openclaw setup`.
  --repo-url <url>       Git repository to clone. Default: upstream OpenClaw repo.
  --ref <ref>            Git ref to clone when a checkout does not exist. Default: main.
  --local-checkout       Use the current repository checkout instead of cloning.
  --skip-link            Skip `pnpm link --global`.
  --skip-ui-build        Skip `pnpm ui:build`.
  --onboard              Run `openclaw onboard --workspace-template claude-code` after build.
  --no-auto-node         Do not auto-install or switch Node when the version is too old.
  --help                 Show this help text.

Environment overrides:
  OPENCLAW_REPO_URL
  OPENCLAW_REF
  OPENCLAW_PNPM_VERSION
  OPENCLAW_WORKSPACE_DIR
  OPENCLAW_INSTALL_ROOT
  PNPM_HOME
EOF
}

log() {
  printf '[openclaw-claude] %s\n' "$*"
}

fail() {
  printf '[openclaw-claude] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "Missing required command: $cmd"
}

detect_os() {
  case "$(uname -s 2>/dev/null || true)" in
    Darwin) echo "macos" ;;
    Linux) echo "linux" ;;
    *) echo "unknown" ;;
  esac
}

refresh_shell_cache() {
  hash -r 2>/dev/null || true
}

default_pnpm_home() {
  case "$(detect_os)" in
    macos) printf '%s\n' "$HOME/Library/pnpm" ;;
    *) printf '%s\n' "$HOME/.local/share/pnpm" ;;
  esac
}

node_is_supported() {
  command -v node >/dev/null 2>&1 || return 1
  node -e "
    const [major, minor] = process.versions.node.split('.').map(Number);
    process.exit(major > ${NODE_MIN_MAJOR} || (major === ${NODE_MIN_MAJOR} && minor >= ${NODE_MIN_MINOR}) ? 0 : 1);
  "
}

activate_brew_node() {
  require_command brew

  local brew_prefix
  brew_prefix="$(brew --prefix "node@${NODE_DEFAULT_MAJOR}" 2>/dev/null || true)"
  [[ -n "$brew_prefix" ]] || return 1
  [[ -x "$brew_prefix/bin/node" ]] || return 1

  export PATH="$brew_prefix/bin:$PATH"
  refresh_shell_cache
  return 0
}

install_node_with_brew() {
  require_command brew
  log "Installing node@${NODE_DEFAULT_MAJOR} with Homebrew"
  brew install "node@${NODE_DEFAULT_MAJOR}"
  activate_brew_node || true
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

  if [[ $AUTO_INSTALL_NODE -eq 0 ]]; then
    fail "Node ${current_version} found, but OpenClaw requires Node >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}.0. Install Node ${NODE_DEFAULT_MAJOR} or newer and rerun."
  fi

  local os
  os="$(detect_os)"

  if [[ "$os" == "macos" ]] && command -v brew >/dev/null 2>&1; then
    log "Node ${current_version} is too old, switching to Homebrew node@${NODE_DEFAULT_MAJOR}"
    install_node_with_brew
    if node_is_supported; then
      log "Using Node $(node -p 'process.versions.node')"
      return
    fi
    fail "Installed node@${NODE_DEFAULT_MAJOR}, but this shell still does not see Node >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}.0. Try: export PATH=\"$(brew --prefix "node@${NODE_DEFAULT_MAJOR}")/bin:\$PATH\""
  fi

  fail "Node ${current_version} found, but OpenClaw requires Node >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}.0. Auto-install is only wired for macOS+Homebrew in this script."
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repo-dir)
        [[ $# -ge 2 ]] || fail "--repo-dir requires a value"
        REPO_DIR="$2"
        shift 2
        ;;
      --workspace)
        [[ $# -ge 2 ]] || fail "--workspace requires a value"
        WORKSPACE_DIR="$2"
        shift 2
        ;;
      --repo-url)
        [[ $# -ge 2 ]] || fail "--repo-url requires a value"
        REPO_URL="$2"
        shift 2
        ;;
      --ref)
        [[ $# -ge 2 ]] || fail "--ref requires a value"
        OPENCLAW_REF="$2"
        shift 2
        ;;
      --local-checkout)
        USE_LOCAL_CHECKOUT=1
        shift
        ;;
      --skip-link)
        SKIP_LINK=1
        shift
        ;;
      --skip-ui-build)
        SKIP_UI_BUILD=1
        shift
        ;;
      --onboard)
        RUN_ONBOARD=1
        shift
        ;;
      --no-auto-node)
        AUTO_INSTALL_NODE=0
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        fail "Unknown argument: $1"
        ;;
    esac
  done
}

check_node_version() {
  ensure_supported_node
}

prepare_pnpm_home() {
  if [[ -z "${PNPM_HOME:-}" ]]; then
    PNPM_HOME="$(default_pnpm_home)"
    export PNPM_HOME
  fi

  mkdir -p "$PNPM_HOME"
  case ":$PATH:" in
    *":$PNPM_HOME:"*) ;;
    *)
      export PATH="$PNPM_HOME:$PATH"
      PNPM_HOME_CREATED=1
      ;;
  esac
  refresh_shell_cache
}

prepare_pnpm() {
  require_command corepack
  prepare_pnpm_home
  corepack enable >/dev/null 2>&1 || true
  corepack prepare "pnpm@${OPENCLAW_PNPM_VERSION}" --activate >/dev/null
  require_command pnpm
  log "Using pnpm $(pnpm --version)"
  log "Using PNPM_HOME $PNPM_HOME"
}

ensure_repo_dir() {
  if [[ -n "$REPO_DIR" ]]; then
    REPO_DIR="${REPO_DIR/#\~/$HOME}"
  elif [[ $USE_LOCAL_CHECKOUT -eq 1 ]]; then
    REPO_DIR="$SCRIPT_REPO_ROOT"
  elif [[ -f "$SCRIPT_REPO_ROOT/openclaw.mjs" && -f "$SCRIPT_REPO_ROOT/package.json" ]]; then
    REPO_DIR="$SCRIPT_REPO_ROOT"
  else
    REPO_DIR="${INSTALL_ROOT%/}/openclaw-claude-code"
  fi

  if [[ -f "$REPO_DIR/openclaw.mjs" && -f "$REPO_DIR/package.json" ]]; then
    log "Using existing checkout at $REPO_DIR"
    return
  fi

  require_command git
  mkdir -p "$(dirname "$REPO_DIR")"
  log "Cloning $REPO_URL#$OPENCLAW_REF into $REPO_DIR"
  git clone --depth 1 --branch "$OPENCLAW_REF" "$REPO_URL" "$REPO_DIR"
}

build_openclaw() {
  log "Installing dependencies"
  (
    cd "$REPO_DIR"
    pnpm install --frozen-lockfile
    if [[ $SKIP_UI_BUILD -eq 0 ]]; then
      log "Building UI bundle"
      pnpm ui:build
    fi
    log "Building OpenClaw"
    pnpm build
  )
}

link_cli() {
  if [[ $SKIP_LINK -eq 1 ]]; then
    log "Skipping global link"
    return
  fi

  log "Linking openclaw CLI globally"
  if (
    cd "$REPO_DIR"
    pnpm link --global
  ); then
    return
  fi

  log "pnpm global bin dir was not ready, retrying after PNPM_HOME bootstrap"
  prepare_pnpm_home
  (
    cd "$REPO_DIR"
    pnpm link --global
  ) || fail "Could not link openclaw globally. Current PNPM_HOME is $PNPM_HOME. Add it to PATH and retry."
}

bootstrap_workspace() {
  local cli=(node "$REPO_DIR/openclaw.mjs")

  if [[ $RUN_ONBOARD -eq 1 ]]; then
    log "Running onboarding with Claude Code workspace preset"
    "${cli[@]}" onboard --workspace "$WORKSPACE_DIR" --workspace-template claude-code
    return
  fi

  log "Running setup with Claude Code workspace preset"
  "${cli[@]}" setup --workspace "$WORKSPACE_DIR" --workspace-template claude-code
}

print_next_steps() {
  local global_bin
  global_bin="$(pnpm bin -g 2>/dev/null || true)"

  log "Install complete"
  printf '\n'
  printf 'Workspace: %s\n' "$WORKSPACE_DIR"
  printf 'Source:    %s\n' "$REPO_DIR"
  if [[ $SKIP_LINK -eq 0 ]]; then
    printf 'CLI check: openclaw --version\n'
    if [[ -n "$global_bin" ]]; then
      printf 'If `openclaw` is not found, add this to PATH: %s\n' "$global_bin"
    fi
    if [[ -n "${PNPM_HOME:-}" ]]; then
      printf 'pnpm home: %s\n' "$PNPM_HOME"
      printf 'Shell fix: export PNPM_HOME="%s"; export PATH="$PNPM_HOME:$PATH"\n' "$PNPM_HOME"
    fi
  else
    printf 'Run without linking: node %s/openclaw.mjs --version\n' "$REPO_DIR"
  fi
  printf 'Bootstrap again later: node %s/openclaw.mjs setup --workspace %s --workspace-template claude-code\n' "$REPO_DIR" "$WORKSPACE_DIR"
}

main() {
  parse_args "$@"
  check_node_version
  prepare_pnpm
  ensure_repo_dir
  build_openclaw
  link_cli
  bootstrap_workspace
  print_next_steps
}

main "$@"
