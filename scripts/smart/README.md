# OpenClow Smart Packaging (macOS)

This folder contains the dedicated packaging and install flow for:

- Repo: `git@github.com:alen1319/openclow-Smart-version.git`
- Target: stable source-based deployment to another Mac

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
