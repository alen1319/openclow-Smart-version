# OpenClow Smart runtime verification for Windows hosts.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\smart\verify-openclow-smart-runtime-windows.ps1

[CmdletBinding()]
param(
    [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $InstallDir = "$env:USERPROFILE\.openclow-smart\openclaw-full"
}

function Log-Step([string]$Message) {
    Write-Host "[openclow-smart] $Message"
}

function Ensure-Checkout {
    if (-not (Test-Path $InstallDir)) {
        throw "[openclow-smart] install dir not found: $InstallDir"
    }
    if (-not (Test-Path (Join-Path $InstallDir "openclaw.mjs"))) {
        throw "[openclow-smart] openclaw.mjs missing under: $InstallDir"
    }
}

function Run-Check([string]$Name, [string[]]$Args) {
    Log-Step "Running $Name"
    & node @Args
}

function Main {
    Ensure-Checkout
    Push-Location $InstallDir
    try {
        Run-Check "--version" @("openclaw.mjs", "--version")
        Run-Check "status --all" @("openclaw.mjs", "status", "--all")
        Run-Check "health --json" @("openclaw.mjs", "health", "--json")
        Run-Check "channels status --probe --json" @("openclaw.mjs", "channels", "status", "--probe", "--json")
    } finally {
        Pop-Location
    }
    Log-Step "Runtime verification passed."
}

Main
