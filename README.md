# Jarvis Free Remote Builder Kit 1.0.0

A hardware-light add-on for the existing Jarvis 1.14.0 Cloudflare Worker.

- Telegram updates arrive at a Cloudflare Worker webhook. No always-on PC, VPS, WSL, Python daemon or local agent is required.
- General/specialist chat is forwarded to the existing Jarvis Worker `/api/bot/chat` endpoint.
- Kernel, Zygisk NDK and APatch KPM jobs are dispatched to GitHub Actions public runners.
- A full AOSP workflow is included only for a trusted, separately provisioned self-hosted Linux x86-64 runner that meets Google's current 64 GB RAM / 400 GB free-disk baseline. It is disabled in the bot by default.

## Important limits

GitHub's free standard public-repository Linux runner is currently 4 vCPU, 16 GB RAM and 14 GB SSD, with unlimited standard-runner usage for public repositories and a 6-hour maximum job duration. It is suitable for many small/medium kernel builds, Zygisk libraries and KPMs, but disk, toolchain and source-specific build requirements may still make a particular kernel fail.

It is not an AOSP build machine. Google documents 64 GB RAM and 400 GB free disk for current AOSP builds. Do not try to work around that by running full AOSP on a 12 GB i3.

Because the builder repository is public, workflow files, logs and artifacts may be visible to people who can read the repository. Use public source trees only. Never put API keys, Telegram tokens, private vendor blobs or private code in this repository or its build logs.

## Quick start

Follow `SETUP-GUIDE.md`. You need:

1. Existing Jarvis 1.14.0 Worker deployed and its D1 binding/provider settings preserved.
2. One Telegram bot from `@BotFather` and your numeric Telegram user ID.
3. One public GitHub repository containing these kit files.
4. A fine-grained GitHub token limited to that repository with Actions read/write.
5. One separate Cloudflare Worker for the Telegram webhook.

No compilation software is installed on your Windows PC. Windows is used only to extract and push the workflow files once. The PC can be turned off during builds.

## Files

- `cloudflare-gateway/worker.js`: webhook gateway and Jarvis chat bridge.
- `.github/workflows/kernel-build.yml`: generic arm64 Kbuild workflow.
- `.github/workflows/zygisk-build.yml`: Android NDK r30 native module workflow.
- `.github/workflows/kpm-build.yml`: APatch/KernelPatch KPM workflow.
- `.github/workflows/aosp-self-hosted.yml`: optional AOSP workflow for a properly sized self-hosted machine.
- `.github/workflows/notify-telegram.yml`: sends build result and artifacts back to your bot.
- `scripts/notify_telegram.py`: artifact delivery helper.
- `scripts/set-webhook.ps1`: Windows PowerShell helper to configure Telegram webhook.
- `tests.mjs`: offline gateway tests.

## Offline validation

```bash
node --check cloudflare-gateway/worker.js
node --test tests.mjs
```

The tests do not deploy to Cloudflare, access Telegram, trigger GitHub Actions, or prove that a specific device kernel's source-specific build procedure is correct.
