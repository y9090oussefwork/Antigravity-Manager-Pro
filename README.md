# Antigravity Manager Pro

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

---

## Security & Privacy Notes

- All account data, OAuth tokens, and proxy settings stay **locally on your machine**.
- The local proxy binds to `127.0.0.1` by default and communicates directly with Google/Antigravity endpoints (or your configured upstream proxy).
- **Account Safety Tip**: Using the official Antigravity client (standard or isolated workspaces) carries the lowest account-restriction risk. If you use the local proxy gateway for external CLI tools, prefer secondary accounts and avoid excessive concurrent request bursts.

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

## License

Licensed under [CC-BY-NC-SA-4.0](LICENSE).
Original upstream project: [Draculabo/AntigravityManager](https://github.com/Draculabo/AntigravityManager).
