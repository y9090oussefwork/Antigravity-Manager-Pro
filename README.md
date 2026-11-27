# Antigravity Manager Pro

[**Download for Windows**](https://github.com/y9090oussefwork/Antigravity-Manager-Pro/releases/latest) · [Website and switching guide](https://y9090oussefwork.github.io/Antigravity-Manager-Pro/) · [التحميل والشرح بالعربي](https://y9090oussefwork.github.io/Antigravity-Manager-Pro/ar/)

**Antigravity Manager Pro** is an open-source desktop application (Electron + React + NestJS/Fastify) for managing Google accounts across Antigravity clients (`Classic`, `Antigravity IDE`, and `agy` CLI), monitoring model quotas in real time, running isolated per-project workspaces, and connecting AI coding tools through a local API gateway.

> **Open-Source Fork & Attribution:**
> Antigravity Manager Pro is an enhanced open-source edition maintained by [y9090oussefwork](https://github.com/y9090oussefwork), forked from the original [Draculabo/AntigravityManager](https://github.com/Draculabo/AntigravityManager) project under the **CC-BY-NC-SA-4.0** license.
> Auto-updates, release notes, and bug reports in this edition are configured to use [`y9090oussefwork/Antigravity-Manager-Pro`](https://github.com/y9090oussefwork/Antigravity-Manager-Pro) so your customizations, Arabic RTL support, and fixes are never overwritten by upstream releases.

---

## Key Features

- **Multi-Account Management & Fast Switching**
  - Add, import, export, and switch Google accounts across Antigravity clients.
  - **Interactive Process Conflict Dialog**: When multiple Antigravity windows/processes are open during an account switch, Antigravity Manager Pro displays the running processes (with PID and isolated profile path) so you can close individual windows, close all of them, and retry switching without raw errors.
  - **Auto-Switch (`Auto-Switch`)**: Optionally monitors the active account and switches to the best healthy account when quota is depleted or rate-limited.
- **Real-Time Quota Monitoring & Usage Summary**
  - View detailed 5-hour and weekly quota breakdowns per model.
  - **Usage Summary Toggle (`ملخص اللمت`)**: Switch on a clean, compact Antigravity-style summary view (grouped by `Gemini Models`, `Claude and GPT models`, `Gemini 4 Argon`, etc.) without altering the detailed view.
  - **Instant Account Search**: Filter accounts immediately by email, display name, or subscription tier.
- **Isolated Project Workspaces (`Workspaces`)**
  - Bind specific Google accounts to specific project folders in isolated `userDataDir` profiles so multiple projects and accounts can run side-by-side.
  - Reassign a workspace to another account at any time (close and relaunch the workspace IDE to apply the new account).
- **Local Proxy Gateway (`127.0.0.1`)**
  - Built-in local OpenAI/Anthropic-compatible gateway for tools like Claude Code, Codex, and OpenCode, with model routing, health checks, and traffic diagnostics.
- **Full Egyptian Arabic (`ar-EG`) & RTL Support**
  - Complete Egyptian Arabic localization with automatic RTL layout direction, plus English, French, Portuguese (BR), Chinese, Japanese, Russian, Turkish, and Vietnamese.
- **Independent GitHub Releases Auto-Update**
  - Configured to check and download Windows NSIS updates directly from [`y9090oussefwork/Antigravity-Manager-Pro`](https://github.com/y9090oussefwork/Antigravity-Manager-Pro/releases/latest).

---

## Installation (Windows)

1. Download the latest Windows installer (`Antigravity.Manager.Pro-<version>-windows-x64-nsis.exe`) from the [Releases](https://github.com/y9090oussefwork/Antigravity-Manager-Pro/releases/latest) page.
2. Run the installer. Your existing accounts, workspaces, and settings in `%APPDATA%` are preserved across upgrades.
3. Launch **Antigravity Manager Pro** from the Start Menu or Desktop shortcut.

### Use the installed CLI

Desktop packages include the standalone CLI and its Node.js runtime. Start with `--help` to list the available commands.

On Windows, open PowerShell in the folder containing `antigravity-manager.exe`:

```powershell
& .\resources\standalone\node\node.exe .\resources\standalone\cli\main.cjs --help
```

On macOS, use the app bundle in `/Applications`:

```bash
cd '/Applications/Antigravity Manager.app/Contents/Resources/standalone'
./node/node ./cli/main.cjs --help
```

On Linux, open a terminal in the folder containing the packaged desktop executable. For an AppImage, use its mounted or extracted contents.

```bash
./resources/standalone/node/node ./resources/standalone/cli/main.cjs --help
```

---

## Security & Privacy Notes

- All account data, OAuth tokens, and proxy settings stay **locally on your machine**.
- The local proxy binds to `127.0.0.1` by default and communicates directly with Google/Antigravity endpoints (or your configured upstream proxy).
- **Account Safety Tip**: Using the official Antigravity client (standard or isolated workspaces) carries the lowest account-restriction risk. If you use the local proxy gateway for external CLI tools, prefer secondary accounts and avoid excessive concurrent request bursts.

---

### Add accounts and switch clients

1. Open Manager and select **Add Account**. Sign in with Google, paste account credentials, or scan this device and review the accounts to import.
2. Refresh quota and inspect the available models, remaining quota and reset times. Model access depends on the account and upstream service. Gemini and Claude entries describe models available through those Google accounts.
3. Select the intended Antigravity client target: **Antigravity (Classic)**, **Antigravity IDE** or **agy CLI**. Save work in a desktop client before switching; switching can close and relaunch it.
4. Switch to the selected account, then verify the signed-in identity in the official client. Complete any official first-use setup or terms confirmation shown there.
5. Enable automatic switching if desired. Client switching and account selection for proxy requests have separate policies.

See the [account and quota guide](docs/modules/cloud-account/overview.md) for automatic switching, quota windows and optional weekly warmup.

### Connect a coding tool or API client

1. Add a usable Google account and refresh its quota.
2. Open **API Proxy**, review the [data and account risks](#data-and-account-risks), and confirm the warning when starting the service for the first time.
3. Choose your client on the **API Proxy** page, select an available model and review the settings before applying them. For manual setup, use the gateway address and API key shown in Manager.
4. Reopen the configured tool and send a small request. Confirm the request and result in **Traffic Monitor**; saved configuration alone does not establish that the connection works.

Tool configuration changes local client settings. Read the [configuration and recovery guide](docs/modules/proxy-gateway/agent-tools.md) for backup, removal and restoration behavior.

---

## Features Overview

| Area                              | What Manager provides                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Google account pool**           | Browser authorization, local account discovery, account status, batch actions and JSON import/export                     |
| **Quota views**                   | Five-hour, weekly or combined views; model visibility controls, sorting and manual or periodic refresh                   |
| **Client account switching**      | Manual switching for Classic, IDE and agy CLI, with optional automatic switching based on account quota and rate limits  |
| **Local API gateway**             | OpenAI Chat Completions and Responses, Anthropic Messages and native Gemini interfaces, with model routing and streaming |
| **Coding tool setup**             | Configure local gateway connections for supported clients, with settings backup and recovery                           |
| **Model Playground**              | Interactive prompt testing, dual-model comparison, multi-account parallel testing and benchmarks with TTFT and speed metrics |
| **Backups and identity profiles** | Local account snapshots and restoration, plus optional client identity-profile management                                |
| **Diagnostics**                   | Traffic inspection, error details, diagnostic references for supported operations and a user-reviewed GitHub report flow |
| **Desktop controls**              | System tray, quota notifications, appearance settings, compact account layouts, RTL support and 9 languages (incl. `ar-EG`) |

> [!NOTE]
>
> - Protocol compatibility depends on the requested feature, model and upstream behavior. See the [gateway reference](docs/modules/proxy-gateway/README.md) for supported paths and limitations.
> - Weekly warmup is optional and off by default. It sends real model requests and can consume quota or AI credits. See its [behavior and limits](docs/modules/cloud-account/overview.md#weekly-warmup) before enabling it.

---

## Data and account risks

> [!WARNING]
> Cloud-account OAuth tokens are stored as **plaintext JSON in the local SQLite database**. Anyone who can read that database can read the tokens. Full account exports and backups can also contain tokens and proxy credentials. Protect the profile directory and backups, and never attach them to public issues.

Other credential stores retain their own OS keyring or encrypted-storage policies. See [security and data boundaries](docs/security.md) for the full policy, migration behavior and diagnostic privacy.

> [!WARNING]
> Reverse-proxy use can violate provider terms and lead to account restrictions or suspension. Use only accounts you can afford to lose. Manager does not guarantee account safety, model availability or uninterrupted access.

The first desktop proxy start requires acknowledgment of the risk warning. Cancelling or closing that dialog leaves the service stopped. Protect the proxy API key and review network access before allowing other devices to connect.

---

## Development & Building from Source

### Prerequisites

- **Node.js** `24.x` (see `.nvmrc`)
- **pnpm** `10.34.6` (`corepack enable`)

### Commands

```bash
# Install dependencies
pnpm install

# Start in development mode
pnpm start

# Type-check & unit tests
pnpm run type-check
pnpm test

# Package & build Windows x64 NSIS installer
pnpm run package
pnpm run make:nsis x64
```

The built Windows installer and update metadata (`latest.yml`, `.blockmap`) are generated in `out/make/nsis/x64/`.

---

## نظرة سريعة بالعربي

**Antigravity Manager Pro** هو برنامج سطح مكتب مفتوح المصدر لإدارة حسابات Google الخاصة بـ **Antigravity**، مع متابعة استهلاك الموديلات لحظيًا، وتشغيل مشاريع معزولة لكل حساب، وبروكسي محلي (`127.0.0.1`) لربط أدوات البرمجة بالذكاء الاصطناعي.

### أهم المميزات في نسخة Pro
- دعم كامل للغة **العربية المصرية (`ar-EG`)** واتجاه **RTL**.
- **خيار ملخص اللمت (`Usage Summary`)**: عرض مختصر ومرتب للمت زي نافذة Usage في Antigravity بدون تغيير العرض التفصيلي.
- **بحث فوري داخل البرنامج** بالإيميل أو الاسم أو الباقة.
- **دايلوق تفاعلي عند تعارض العمليات المفتوحة** وقت تبديل الحساب (يعرض كل النوافذ/العمليات المفتوحة مع إمكانية قفلها واحدة واحدة أو قفل الكل وإعادة التبديل).
- **إصلاح التصدير على جذر القرص** (مثل `D:\` مباشرة).
- **ربط التحديثات التلقائية واليدوية** بمستودع `y9090oussefwork/Antigravity-Manager-Pro` مباشرة.

---

## Contributors

- [y9090oussefwork](https://github.com/y9090oussefwork) maintains Antigravity Manager Pro.
- ChatGPT and Gemini assisted with development.

If the app helps you, star the repository using **Star** at the top of this page. To follow releases, choose **Watch → Custom → Releases**.

## License

Licensed under [CC-BY-NC-SA-4.0](LICENSE).
Original upstream project: [Draculabo/AntigravityManager](https://github.com/Draculabo/AntigravityManager).
