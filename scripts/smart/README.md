# OpenClow Smart Packaging (macOS + Windows)

This folder contains the dedicated packaging and install flow for:

- Repo: `git@github.com:alen1319/openclow-Smart-version.git`
- Target: stable source-based deployment to another Mac or Windows host

## 1) Push your candidate to dedicated repo

From this checkout:

```bash
git remote add smart git@github.com:alen1319/openclow-Smart-version.git
git push -u smart codex/stage6-candidate:main
```

If `smart` already exists:

```bash
git remote set-url smart git@github.com:alen1319/openclow-Smart-version.git
git push -u smart codex/stage6-candidate:main
```

## 2) Install on another Mac

Preferred (clone + build + daemon install + runtime smoke):

```bash
curl -fsSL https://raw.githubusercontent.com/alen1319/openclow-Smart-version/main/scripts/smart/install-openclow-smart-mac.sh | bash
```

SSH-based clone is default in the installer. If target host should use HTTPS:

```bash
SMART_REPO_URL=https://github.com/alen1319/openclow-Smart-version.git \
curl -fsSL https://raw.githubusercontent.com/alen1319/openclow-Smart-version/main/scripts/smart/install-openclow-smart-mac.sh | bash
```

## 3) Verify runtime on target Mac

```bash
bash ~/.openclow-smart/openclaw-full/scripts/smart/verify-openclow-smart-runtime.sh
```

This validates:

- listener and gateway PID consistency
- CLI/runtime version alignment
- health/probe/status/doctor/channel checks

## 4) Optional offline transfer bundle

Create a portable source bundle from local checkout:

```bash
bash scripts/smart/package-openclow-smart-mac.sh
```

Bundle output:

- `dist/smart-release/openclow-smart-<version>-<commit>.tar.gz`
- `dist/smart-release/openclow-smart-<version>-<commit>.sha256`

## 5) Install on Windows host (PowerShell)

Preferred (clone + build + daemon install + runtime smoke):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smart\install-openclow-smart-windows.ps1
```

Optional overrides:

- `-SmartRepoUrl`
- `-SmartRepoRef`
- `-SmartInstallDir`
- `-SkipBaselineChecks`
- `-SkipDaemonInstall`
- `-SkipRuntimeSmoke`

Runtime verification:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smart\verify-openclow-smart-runtime-windows.ps1
```

## 6) Windows offline transfer bundle

Create a Windows deployment zip from local checkout:

```bash
bash scripts/smart/package-openclow-smart-windows.sh
```

Bundle output:

- `dist/smart-release/openclow-smart-win-<version>-<commit>.zip`
- `dist/smart-release/openclow-smart-win-<version>-<commit>.sha256`
