# OpenClow Smart Version installer for Windows hosts.
#
# Optional overrides (parameters or environment variables):
#   SMART_REPO_URL
#   SMART_REPO_REF
#   SMART_INSTALL_DIR
#   SMART_WORKSPACE_DIR
#   SMART_PNPM_VERSION
#   SMART_GATEWAY_PORT
#   SMART_RUNTIME
#   SMART_NODE_TARGET_MAJOR
#
# Example:
#   powershell -ExecutionPolicy Bypass -File .\scripts\smart\install-openclow-smart-windows.ps1

[CmdletBinding()]
param(
    [string]$SmartRepoUrl = "",
    [string]$SmartRepoRef = "",
    [string]$SmartInstallDir = "",
    [string]$SmartWorkspaceDir = "",
    [string]$SmartPnpmVersion = "",
    [int]$SmartGatewayPort = 0,
    [string]$SmartRuntime = "",
    [int]$SmartNodeTargetMajor = 0,
    [switch]$SkipBaselineChecks,
    [switch]$SkipDaemonInstall,
    [switch]$EnableWorkspaceBootstrap,
    [switch]$SkipRuntimeSmoke
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($SmartRepoUrl)) {
    $SmartRepoUrl = if ($env:SMART_REPO_URL) { $env:SMART_REPO_URL } else { "https://github.com/alen1319/openclow-Smart-version.git" }
}
if ([string]::IsNullOrWhiteSpace($SmartRepoRef)) {
    $SmartRepoRef = if ($env:SMART_REPO_REF) { $env:SMART_REPO_REF } else { "main" }
}
if ([string]::IsNullOrWhiteSpace($SmartInstallDir)) {
    $SmartInstallDir = if ($env:SMART_INSTALL_DIR) { $env:SMART_INSTALL_DIR } else { "$env:USERPROFILE\.openclow-smart\openclaw-full" }
}
if ([string]::IsNullOrWhiteSpace($SmartWorkspaceDir)) {
    $SmartWorkspaceDir = if ($env:SMART_WORKSPACE_DIR) { $env:SMART_WORKSPACE_DIR } else { "$env:USERPROFILE\.openclaw\workspace" }
}
if ([string]::IsNullOrWhiteSpace($SmartPnpmVersion)) {
    $SmartPnpmVersion = if ($env:SMART_PNPM_VERSION) { $env:SMART_PNPM_VERSION } else { "10.32.1" }
}
if ($SmartGatewayPort -le 0) {
    $SmartGatewayPort = if ($env:SMART_GATEWAY_PORT) { [int]$env:SMART_GATEWAY_PORT } else { 18789 }
}
if ([string]::IsNullOrWhiteSpace($SmartRuntime)) {
    $SmartRuntime = if ($env:SMART_RUNTIME) { $env:SMART_RUNTIME } else { "node" }
}
if ($SmartNodeTargetMajor -le 0) {
    $SmartNodeTargetMajor = if ($env:SMART_NODE_TARGET_MAJOR) { [int]$env:SMART_NODE_TARGET_MAJOR } else { 24 }
}

$NodeMinMajor = 22
$NodeMinMinor = 14

function Log-Info([string]$Message) {
    Write-Host "[openclow-smart] $Message"
}

function Log-Warn([string]$Message) {
    Write-Warning "[openclow-smart] $Message"
}

function Fail-Install([string]$Message) {
    throw "[openclow-smart] $Message"
}

function Command-Exists([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ensure-ExecutionPolicy {
    $policy = Get-ExecutionPolicy
    if ($policy -eq "Restricted" -or $policy -eq "AllSigned") {
        Log-Info "PowerShell execution policy is $policy; setting process scope to RemoteSigned."
        Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process -Force
    }
}

function Get-NodeVersionObject {
    if (-not (Command-Exists "node")) {
        return $null
    }
    try {
        $v = (& node -p "process.versions.node").Trim()
        $parts = $v.Split(".")
        if ($parts.Length -lt 2) {
            return $null
        }
        return [PSCustomObject]@{
            Raw = $v
            Major = [int]$parts[0]
            Minor = [int]$parts[1]
        }
    } catch {
        return $null
    }
}

function Node-IsSupported {
    $v = Get-NodeVersionObject
    if ($null -eq $v) {
        return $false
    }
    return ($v.Major -gt $NodeMinMajor) -or ($v.Major -eq $NodeMinMajor -and $v.Minor -ge $NodeMinMinor)
}

function Install-Node {
    if (Command-Exists "winget") {
        Log-Info "Installing Node.js via winget (OpenJS.NodeJS.LTS)"
        & winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements | Out-Null
        return
    }
    if (Command-Exists "choco") {
        Log-Info "Installing Node.js via chocolatey"
        & choco install nodejs-lts -y | Out-Null
        return
    }
    if (Command-Exists "scoop") {
        Log-Info "Installing Node.js via scoop"
        & scoop install nodejs-lts | Out-Null
        return
    }
    Fail-Install "Cannot install Node.js automatically. Please install Node $SmartNodeTargetMajor manually."
}

function Ensure-Node {
    if (Node-IsSupported) {
        $v = Get-NodeVersionObject
        Log-Info "Using Node $($v.Raw)"
        return
    }
    Log-Info "Node is missing or unsupported; attempting install."
    Install-Node
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    if (-not (Node-IsSupported)) {
        Fail-Install "Node install finished but Node version is still below $NodeMinMajor.$NodeMinMinor."
    }
    $v = Get-NodeVersionObject
    Log-Info "Using Node $($v.Raw)"
}

function Ensure-Git {
    if (Command-Exists "git") {
        return
    }
    if (Command-Exists "winget") {
        Log-Info "Installing Git via winget."
        & winget install Git.Git --accept-package-agreements --accept-source-agreements | Out-Null
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    } else {
        Fail-Install "Git is required. Install Git for Windows: https://git-scm.com/download/win"
    }
    if (-not (Command-Exists "git")) {
        Fail-Install "Git installation failed."
    }
}

function Ensure-Pnpm {
    if (-not (Command-Exists "corepack")) {
        Fail-Install "Missing corepack. Ensure Node installation is complete."
    }
    & corepack enable
    & corepack prepare "pnpm@$SmartPnpmVersion" --activate
    if (-not (Command-Exists "pnpm")) {
        Fail-Install "pnpm is unavailable after corepack activation."
    }
    $pnpmVersion = (& pnpm --version).Trim()
    Log-Info "Using pnpm $pnpmVersion"
}

function Prepare-Checkout {
    $parent = Split-Path -Parent $SmartInstallDir
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    if (Test-Path (Join-Path $SmartInstallDir ".git")) {
        Log-Info "Updating existing checkout: $SmartInstallDir"
        Push-Location $SmartInstallDir
        try {
            & git fetch --tags origin
            & git checkout $SmartRepoRef
            $hasRemoteRef = (& git rev-parse --verify "origin/$SmartRepoRef" 2>$null) -ne $null
            if ($hasRemoteRef) {
                & git reset --hard "origin/$SmartRepoRef"
            }
        } finally {
            Pop-Location
        }
        return
    }
    if (Test-Path $SmartInstallDir) {
        Fail-Install "Install directory exists but is not a git checkout: $SmartInstallDir"
    }
    Log-Info "Cloning $SmartRepoUrl#$SmartRepoRef to $SmartInstallDir"
    & git clone --branch $SmartRepoRef $SmartRepoUrl $SmartInstallDir
}

function Build-SmartRuntime {
    Push-Location $SmartInstallDir
    try {
        Log-Info "Installing dependencies"
        & pnpm install --frozen-lockfile
        if (-not $SkipBaselineChecks) {
            Log-Info "Running baseline checks"
            & pnpm check:base-config-schema
            & pnpm config:docs:check
        }
        Log-Info "Building runtime"
        & pnpm build
        & pnpm build:strict-smoke
    } finally {
        Pop-Location
    }
}

function Link-CLI {
    Push-Location $SmartInstallDir
    try {
        Log-Info "Linking openclaw CLI globally"
        & pnpm link --global
    } finally {
        Pop-Location
    }
}

function Install-GatewayDaemon {
    if ($SkipDaemonInstall) {
        Log-Info "Skipping daemon install."
        return
    }
    Push-Location $SmartInstallDir
    try {
        Log-Info "Installing and restarting gateway daemon"
        & node openclaw.mjs gateway install --force --runtime $SmartRuntime --port $SmartGatewayPort
        & node openclaw.mjs gateway restart
    } finally {
        Pop-Location
    }
}

function Bootstrap-Workspace {
    if (-not $EnableWorkspaceBootstrap) {
        return
    }
    Push-Location $SmartInstallDir
    try {
        Log-Info "Bootstrapping workspace at $SmartWorkspaceDir"
        & node openclaw.mjs setup --workspace $SmartWorkspaceDir --workspace-template claude-code
    } finally {
        Pop-Location
    }
}

function Runtime-Smoke {
    if ($SkipRuntimeSmoke) {
        Log-Info "Skipping runtime smoke checks."
        return
    }
    Push-Location $SmartInstallDir
    try {
        Log-Info "Running runtime smoke checks"
        & node openclaw.mjs --version
        & node openclaw.mjs status --all
        & node openclaw.mjs health --json
        & node openclaw.mjs channels status --probe --json
    } finally {
        Pop-Location
    }
}

function Print-Summary {
    Write-Host ""
    Write-Host "OpenClow Smart install complete."
    Write-Host "Repo:      $SmartInstallDir"
    Write-Host "Branch:    $SmartRepoRef"
    Write-Host "Gateway:   ws://127.0.0.1:$SmartGatewayPort"
    Write-Host "CLI check: openclaw --version"
    Write-Host "Verify:    powershell -ExecutionPolicy Bypass -File `"$SmartInstallDir\scripts\smart\verify-openclow-smart-runtime-windows.ps1`""
}

function Main {
    Ensure-ExecutionPolicy
    Ensure-Node
    Ensure-Git
    Ensure-Pnpm
    Prepare-Checkout
    Build-SmartRuntime
    Link-CLI
    Install-GatewayDaemon
    Bootstrap-Workspace
    Runtime-Smoke
    Print-Summary
}

Main
