# Jarvis all-in-one Telegram bot + free remote kernel compiler

## The design: use almost none of your PC

```text
Telegram
   │ HTTPS webhook
   ▼
Cloudflare Worker (free tier)
   ├── general / specialist messages ──► existing Jarvis 1.14.0 Worker
   └── kernel / Zygisk / KPM requests ──► GitHub Actions workflow_dispatch
                                             │
                                             ▼
                                      Temporary GitHub runner
                                      4 vCPU / 16 GB RAM / 14 GB SSD
                                             │
                                             ▼
                                      Build ZIP + checksum
                                             │
                                             ▼
                                  GitHub notification workflow
                                             │
                                             ▼
                                        Telegram
```

Your i3 3rd-gen / 12 GB / GT 710 PC is only needed once to extract the kit and push its files into your GitHub repository. It performs no compilation. After setup, the bot and builds continue while your PC is off.

## What is actually possible for free?

| Workload | Free route | Result |
|---|---|---|
| General Jarvis AI, research, study, coding, writing and specialist chat | Existing Jarvis Worker + Cloudflare webhook | Yes, subject to free model/API quotas |
| Many Android arm64 kernel builds | GitHub public Actions runner | Often, if source/toolchain/disk fit |
| Zygisk `.so` builds | GitHub public Actions runner + NDK r30 | Yes for projects matching the bundled Android.mk/CMake layout |
| APatch KPM builds | GitHub public Actions runner + AArch64 bare-metal GCC | Yes for KernelPatch-style Makefile projects |
| Script-only Magisk/KernelSU/APatch ZIPs | Existing Jarvis module builder UI | Yes, subject to that builder's project format |
| Full current AOSP/LineageOS ROM build | University lab / authorized self-hosted x86-64 Linux server | Not on the free hosted runner or your PC |

GitHub's standard public runner is documented as 4 vCPU, 16 GB RAM and 14 GB SSD. Standard runners are free and unlimited for public repositories, but individual jobs are capped at 6 hours. The small SSD is often the limiting factor for large kernel trees. A particular vendor kernel may need a source-specific build script/toolchain and may not fit.

Google's current AOSP baseline is 64-bit x86, at least 64 GB RAM, and 400 GB free disk. The free runner and your 12 GB PC are below that baseline. No swap file, reduced `-j`, or GPU tweak turns those machines into a reliable full AOSP builder.

## Part A — Create the all-in-one Telegram bot

### 1. Create your bot

1. Open Telegram and message `@BotFather`.
2. Send `/newbot`.
3. Choose a display name, e.g. `Jarvis Cloud Engineer`.
4. Choose a unique username ending in `bot`.
5. Save the token privately. Do not paste it into chat, commit it to GitHub, or share a screenshot containing it.
6. Message your new bot `/start` once.

Get your numeric Telegram user ID privately. You can retrieve it from a trusted ID bot, or from the `from.id` field in your own bot's `getUpdates` response before configuring the webhook. Use the numeric ID, not `@username`.

### 2. Create a public GitHub builder repository

The public status is required for the no-charge standard GitHub-hosted runner. Assume build logs and artifacts may be visible to repository readers. Do not use private code or private vendor blobs in this repository.

1. Sign in to GitHub and create a new repository named `jarvis-free-builder`.
2. Set visibility to **Public**. Initialize with a README if GitHub asks.
3. On your Windows PC, extract `Jarvis-Free-Builder-Kit-1.0.0.zip`.
4. Install GitHub Desktop (or Git for Windows) if you do not already have Git.
5. Clone `jarvis-free-builder` to your PC.
6. Copy **all contents** of the extracted kit folder into the cloned repository folder. Make sure the hidden `.github/workflows/` folder is copied too.
7. Commit with message `Add Jarvis remote build workflows` and push to `main`.
8. Open the repository's **Actions** tab and ensure Actions are enabled.
9. Under Settings → Actions → General, allow the workflows used by this repository. Do not enable workflows from forked pull requests with secrets.

The repository should now contain:

```text
.github/workflows/kernel-build.yml
.github/workflows/zygisk-build.yml
.github/workflows/kpm-build.yml
.github/workflows/aosp-self-hosted.yml
.github/workflows/notify-telegram.yml
cloudflare-gateway/worker.js
scripts/notify_telegram.py
```

### 3. Create a narrowly scoped GitHub token

The Cloudflare gateway needs permission to trigger your builder workflows and read build status.

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.
2. Generate a token with access to **Only select repositories** → `jarvis-free-builder`.
3. Repository permissions: **Actions: Read and write**. Metadata read is granted automatically.
4. Do not grant Contents write, Administration, Secrets or organization permissions.
5. Set an expiry and store the token as a Cloudflare Secret. Rotate it when it expires.

The gateway uses the official `workflow_dispatch` API. This token does not need access to your kernel source repository because the build workflow clones public HTTPS source URLs without credentials.

### 4. Add Telegram notification secrets to the builder repository

Open the builder repo → Settings → Secrets and variables → Actions → New repository secret.

Add:

- `TELEGRAM_BOT_TOKEN` = the token from BotFather.
- `TELEGRAM_OWNER_ID` = your numeric Telegram user ID.

These secrets are used only by the separate `notify-telegram.yml` workflow after a build finishes. They are not injected into the build workflows that execute kernel/third-party source code.

### 5. Deploy the Cloudflare Telegram gateway

This is a second, small Worker. It does not replace your existing Jarvis Worker.

1. Open Cloudflare Dashboard → Workers & Pages → Create → Worker.
2. Name it `jarvis-telegram-gateway` and deploy the starter Worker.
3. Open Edit Code / Quick Edit and replace the source with the contents of `cloudflare-gateway/worker.js` from this kit.
4. Deploy it. Its health URL should be `https://YOUR-GATEWAY.workers.dev/health`.
5. Open Settings → Variables and Secrets and add the following.

**Variables**

| Variable | Value |
|---|---|
| `TELEGRAM_OWNER_ID` | Your numeric Telegram user ID |
| `JARVIS_WORKER_URL` | Your existing Jarvis Worker URL, e.g. `https://your-jarvis.workers.dev` |
| `GITHUB_OWNER` | Your GitHub username or organization |
| `GITHUB_REPO` | `jarvis-free-builder` |
| `GITHUB_REF` | `main` |
| `AOSP_SELF_HOSTED_ENABLED` | Leave unset or `false` for now |

**Secrets**

| Secret | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather token |
| `TELEGRAM_WEBHOOK_SECRET` | Random 32+ character token using only letters, digits, `_` or `-` |
| `JARVIS_TELEGRAM_SECRET` | Shared secret described in Part B |
| `GITHUB_TOKEN` | Fine-grained GitHub token created above |

Do not put any of these values in the Worker source file.

### 6. Connect the gateway to your existing Jarvis AI

The existing Jarvis 1.14.0 Worker already implements `/api/bot/chat` and `/api/bot/reset`.

1. Open your **existing Jarvis Worker**, not the new gateway Worker.
2. In Settings → Variables and Secrets, add a Secret named `TELEGRAM_BOT_SECRET`.
3. Generate a long random value (at least 32 random bytes) and set the exact same value as the `JARVIS_TELEGRAM_SECRET` secret in the gateway Worker.
4. Set the existing Jarvis Worker's `TELEGRAM_OWNER_ID` variable to the same numeric Telegram ID.
5. Keep the existing D1 binding named `DB`, `APP_PASSWORD`, `AUTH_SECRET` and all model-provider secrets unchanged.
6. Deploy the existing Jarvis Worker if its source is not already v1.14.0 or newer with `/api/bot/chat`.

There is no D1 migration for this gateway. The Jarvis Worker continues to store Telegram conversation history and saved memories.

### 7. Point Telegram at the Cloudflare webhook

Before switching to webhook mode, stop any old `jarvis-telegram` long-polling service that uses this same BotFather token. Telegram does not allow `getUpdates` polling while a webhook is active.

On Windows PowerShell, run the supplied helper. It requests the BotFather token as a masked secure input:

```powershell
.\scripts\set-webhook.ps1
```

It asks for your BotFather token, gateway URL and webhook secret, then calls Telegram `setWebhook` with `allowed_updates=["message"]` and the matching secret header configuration.

Or manually call Telegram's `setWebhook` method with:

- `url=https://YOUR-GATEWAY.workers.dev/telegram`
- `secret_token=THE_SAME_TELEGRAM_WEBHOOK_SECRET`
- `allowed_updates=["message"]`

Then open the bot and send `/start`, `/help` and `/status`.

### 8. Add the Telegram menu

In `@BotFather`, send `/setcommands`, select your bot, and paste:

```text
start - Start Jarvis
help - Show bot commands
ask - Ask Jarvis
research - Research with Jarvis
task - Choose a specialist AI mode
code - Coding assistant
study - Study assistant
math - Math assistant
write - Writing assistant
think - Deep reasoning assistant
security - Security analysis assistant
data - Data analysis assistant
new - Reset Telegram conversation
kernelrepo - Build a public arm64 kernel
zygiskrepo - Compile a Zygisk native module
kpmrepo - Compile an APatch KPM
status - Show recent build runs
job - Inspect a GitHub Actions run
aosp - Submit to an authorized AOSP self-hosted runner
```


## Part B — Use Jarvis from Telegram

### General AI / specialist work

Send a plain message, or use any of these:

```text
/ask Explain this boot log.
/task coding Review this C++ function.
/task research Find recent upstream changes and cite sources.
/task study Explain virtual memory with examples.
/math Solve this numerical step by step.
/security Analyze this Android manifest.
/new
```

Supported task modes: general, reasoning, writing, research, math, study, coding, security, data, translation, summarization, planning, creative, health, legal, finance, travel, shopping and presentation.

All AI calls are forwarded to the existing Jarvis Worker. The gateway does not create a separate AI database or model account. Free model and search quotas still apply; it never silently turns a free request into a paid model route.

### Kernel build

```text
/kernelrepo https://github.com/OWNER/KERNEL.git BRANCH path/to/device_defconfig workspace-name
```

Example syntax only. Replace the URL, branch and defconfig with the exact ones documented by your kernel maintainer. For a Poco F7/Onyx source tree, inspect `arch/arm64/configs/` and the repository's README/build script first; do not guess a defconfig.

The generic workflow runs:

```bash
make O=out ARCH=arm64 LLVM=1 LLVM_IAS=1 <defconfig>
make O=out ARCH=arm64 LLVM=1 LLVM_IAS=1 -j2
```

It uses the runner's Clang/LLD and installs ARM cross tools. Some vendor trees require a pinned Clang version, a specific `build.sh`, Bazel/Kleaf, proprietary vendor modules, or a packaging script. Those must be added to the workflow for that repository. A compile error from an incompatible generic recipe is not proof that the source itself is broken.

### Zygisk native module

```text
/zygiskrepo https://github.com/OWNER/MODULE.git BRANCH module-name arm64-v8a
```

The repository must include `module.prop` and either `Android.mk` (root or `jni/`) or `CMakeLists.txt`. NDK r30 is downloaded and checksum-verified on the temporary runner. Native libraries are packaged into a ZIP. This does not build or install a manager module if the repository uses an unrelated build layout.

### APatch KPM

```text
/kpmrepo https://github.com/OWNER/KERNELPATCH-PROJECT.git BRANCH project-name kpms/my-kpm
```

The repository must contain the KernelPatch root and the selected KPM project's Makefile. The workflow installs the pinned AArch64 bare-metal GCC release, verifies its published checksum, and runs the KPM Makefile. It compiles only; it does not load, inject or install the KPM.

### Status and outputs

```text
/status
/job 1234567890
```

`/status` lists recent workflow run IDs. `/job` shows a specific run's status and URL. When a workflow finishes, the separate notification workflow sends the result and any ZIP artifact to Telegram. Artifacts larger than 44 MiB are split into ordered parts because Telegram's Bot API currently limits uploaded documents to 50 MB. Reassemble downloaded parts in numeric order.

## Part C — AOSP: the only honest free route

Your PC: 12 GB RAM, 3rd-generation i3, GT 710. GitHub public runner: 16 GB RAM and 14 GB SSD. Neither satisfies the current AOSP baseline (64 GB RAM and 400 GB free disk). Increasing swap may prevent an immediate OOM but does not create enough physical RAM, storage or CPU throughput to make full modern AOSP reliable.

The kit includes `.github/workflows/aosp-self-hosted.yml`, but the bot deliberately keeps it disabled by default. To use it later:

1. Get authorized access to a university Linux lab/HPC or a project maintainer's x86-64 build server with at least 64 GB RAM and 400 GB free disk.
2. Use a dedicated account/workspace and install the GitHub Actions self-hosted runner for this repository. Do not run untrusted pull-request code on a shared runner.
3. Add the runner label `aosp64` and confirm that the runner is online.
4. Only then set `AOSP_SELF_HOSTED_ENABLED=true` in the gateway Worker.
5. Use `/aosp <manifest-url> <branch> <lunch-target> [workspace] [goal]`.

The workflow itself refuses to start unless it detects 64 GiB RAM, 400 GiB free disk, `repo` and `git`. It will remain queued while the labelled self-hosted runner is offline.

If you cannot get access to that hardware free of charge, full modern AOSP builds are not realistically available under your stated constraints. Use upstream maintainer CI if the device/ROM project provides it, or focus on kernel, KPM, Zygisk and Android app builds through GitHub Actions.

## Part D — What about your own PC / Oracle Always Free?

### Your Windows PC

It does not need WSL2 or Ubuntu for this setup. Extracting the kit and pushing it to GitHub is enough. The PC can be shut down during all normal AI and remote build use.

If you later want a local kernel fallback, WSL2 Ubuntu can do small arm64 builds with `-j1` or `-j2`, but your 3rd-gen i3 will be slow and 12 GB RAM is tight. The GT 710 does not accelerate kernel compilation. Keep at least 100–150 GB free only if you choose that optional local route.

### Optional Oracle Always Free VM (not required)

Oracle's current official Always Free Ampere quota is 2 OCPU, 12 GB RAM and 200 GB total block-volume storage in the tenancy home region. It is ARM64. This is **not** a 128 GB machine and does not meet AOSP requirements; it can host a lightweight bot or modest kernel tasks. Oracle asks for a real credit/debit card for identity verification and may place a temporary authorization hold. Always Free resources remain free when kept within the published quota, but capacity may be unavailable in the home region. Do not upgrade to Pay As You Go or provision paid storage/compute if your budget is strictly zero.

The v1.14.0 `cloud-builder/install.sh` is x86-64-only. Do not run it unchanged on Oracle Ampere ARM64.

## Troubleshooting

- `401` on webhook: check `TELEGRAM_WEBHOOK_SECRET` matches the value passed to `setWebhook`.
- Jarvis says bot integration is not configured: check existing Jarvis Worker `TELEGRAM_BOT_SECRET` equals gateway `JARVIS_TELEGRAM_SECRET`, and owner IDs match.
- GitHub dispatch returns 404: check the builder repository is public, the workflow files are on the selected `GITHUB_REF`, Actions are enabled, and the fine-grained token includes Actions write on that repository.
- GitHub dispatch returns 401/403: replace the fine-grained token and check Actions read/write permission.
- Kernel build runs out of disk: use a smaller/shallow source tree, remove unused outputs/submodules, or build through a maintainer's CI. The free runner has only 14 GB SSD.
- Kernel build rejects defconfig: check the exact file under `arch/arm64/configs/` and whether this project requires a custom script or Bazel/Kleaf.
- Telegram artifact not received: open `/status`, inspect the workflow run, ensure `notify-telegram.yml` is present on default branch and the two Telegram Actions secrets are correct.
- More than 50 MB output: the notification workflow splits ZIPs into <=44 MiB chunks.
- Old bot stops receiving updates: make sure the v1.14 polling service is stopped before enabling webhook mode. Use `getWebhookInfo` to inspect the webhook.

## Security notes

- The Cloudflare gateway accepts only your configured numeric Telegram user ID in a private chat.
- The webhook uses Telegram's `secret_token` header and checks it before processing.
- Only three fixed workflow files can be dispatched by the bot; it has no arbitrary shell command.
- The GitHub token is scoped to one builder repository with Actions read/write only.
- Build workflows receive no Telegram token, Jarvis secret or GitHub PAT. The separate notification workflow receives Telegram credentials only after the build VM has finished; it downloads outputs but never executes them.
- Build workflows execute Makefiles/scripts from the source repositories you submit. Use only source you trust. Public runner logs and artifacts may be readable by others.
- No flash, bootloader unlock, module install, device reboot, KPM load or partition write is included.
