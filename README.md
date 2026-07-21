# Jenkins Log Analyzer 🔬

A local-first web application that analyzes Jenkins build logs with surgical precision — identifying root causes, cascading failures, and flaky tests entirely offline. Upload your CI/CD logs and get a forensic analysis in seconds, no AI or internet connection required. An optional, user-triggered AI step can generate actionable fix suggestions on top of that analysis.

For a step-by-step guide to running this on your own machine, see [LOCAL_SETUP.md](LOCAL_SETUP.md).

## Prerequisites

- **Node.js 18+** (LTS recommended)
- Nothing else. No API key, no account, no internet connection needed for log analysis itself.

## Quick Start

```bash
# 1. Clone and install
git clone <your-repo-url>
cd jenkins-analyzer
npm run install:all

# 2. Start development servers
npm run dev
```

Frontend runs at **http://localhost:5173**, backend at **http://localhost:3001**.

## How to Use

1. **Upload** — Drag & drop your Jenkins console log (.log, .txt, .zip, .gz)
2. **Configure** — Select project type and test framework (used to tailor optional AI fix suggestions)
3. **Analyze** — Click "Analyze Build Log" and watch real-time progress; parsing happens locally, in seconds
4. **Explore** — Filter by status, category, severity; search test cases
5. **(Optional) Get AI Fix Suggestions** — Enter an API key for any supported provider to get actionable fix suggestions for the failures found
6. **Re-run in Jenkins** — Check off failed cases and click "Re-run in Jenkins" to open a pre-filled build form for your Jenkins job in a new tab (configure your Jenkins base URL + job path once; see below)
7. **Export** — Download results as JSON, CSV, or Markdown report
8. **Compare** — Upload a previous analysis JSON to diff against

## Jenkins Re-run Setup

To use the "Re-run in Jenkins" button, click **Configure Jenkins** (shown in the floating action bar once you select at least one failed case) and enter:

| Field | Description | Example |
|-------|-------------|---------|
| Jenkins Base URL | The root URL of your Jenkins instance, no trailing slash | `https://jenkins.mycompany.com` |
| Job Path | The full job path segment **exactly as it appears in your job's own Jenkins URL**, including the leading `job/` | `job/digital-ui-automation` |
| Test ID Parameter Name | The build parameter your job uses to accept a comma-separated list of test IDs — job-specific, defaults to `MULTIPLE_GROUPS` | `MULTIPLE_GROUPS` |

For a job nested in folders, Jenkins repeats `job/` per folder level — enter it the same way, e.g. `job/team-folder/job/digital-ui-automation`.

Selected test IDs are extracted by taking the last `/`-separated segment of each test's name (e.g. `"New CC - E2E ... / NewCC-DQE-T170"` → `NewCC-DQE-T170`), joined into a comma-separated list. Clicking **Copy IDs + Open Jenkins** copies that list to your clipboard and opens the job's build form in a new tab — it does **not** trigger the build automatically, you still click Build yourself. Jenkins' manual parameter-confirmation form doesn't read values from the URL query string (that's only honored by a different endpoint, `/buildWithParameters`, which skips the confirmation step entirely and starts the build immediately — deliberately not used here), so paste the copied IDs into the configured parameter field (default `MULTIPLE_GROUPS`, change it in the config panel if your job names it differently) before clicking Build. Config is saved to `localStorage`, same as the GitHub/Jira ticket-creation settings.

## Jira / GitHub Ticket Creation Setup

From an expanded failed case, click **Create Ticket** to get a pre-filled title/description plus one-click actions: **Open Pre-filled GitHub Issue** (reliably prefilled via GitHub's own URL query params) and **Copy + Open Jira**. Jira does not have a single "create issue" URL that reliably works across editions (Cloud vs. self-hosted Server/Data Center) and versions, so rather than guess one, the default behavior copies the description to your clipboard and opens your project page (`{jiraBaseUrl}/browse/{PROJECT_KEY}` — a stable link across virtually every Jira version), one click from Jira's own **Create** button. If you know your instance's actual working create-issue URL (find it by clicking Create in your own Jira UI and copying the resulting address), paste it into the optional **Custom Create-Issue URL** field in the same settings panel — it supports a `{PROJECT_KEY}` placeholder if needed.

## Supported Log Formats

| Format | Description |
|--------|-------------|
| Jenkins Console Output | Raw console log from any Jenkins build |
| Maven Surefire Output | Both plain-text (`Tests run: N, Failures: N`, `<<< FAILURE!`) and embedded XML |
| pytest Output | Python test session output (`FAILED`/`PASSED` markers) |
| Jest | `●` failure markers and suite summaries |
| Playwright | Numbered failure blocks and timeout traces |
| Go test | `--- FAIL:` / `--- PASS:` output |
| Cypress | `✗` failure markers |
| JUnit XML | Standard JUnit/Surefire XML embedded in a log or ZIP |
| Custom/generic reporters | Standalone `PASS` / `FAIL <name>` verdict lines and numbered execution-step traces (`12) Page.click(...) > expect(x).toBe(y)`) — common in hand-rolled WebdriverIO/Selenium wrapper frameworks |
| ZIP Archives | Multi-file archives, including Jenkins' one-log-per-test-case export format |
| .gz Files | Gzip compressed log files |

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Frontend (React)                       │
│                                                             │
│  UploadZone → ConfigPanel → ProgressTracker                │
│                    ↓                                        │
│  SummaryCards → FilterBar → CaseList → CaseCard             │
│  TrendChart → DiffView → ExportBar → History                │
│  CaseCard (select) → JenkinsActionBar → JenkinsConfigPanel   │
│                                                             │
│  Vite dev server (:5173) ──proxy──→ /api                    │
└────────────────────┬────────────────────────────────────────┘
                      │ SSE (Server-Sent Events)
┌────────────────────▼────────────────────────────────────────┐
│                    Backend (Express)                          │
│                                                                │
│  POST /api/analyze  — LOCAL-FIRST, zero AI calls              │
│    1. Accept file (multer, ≤100 MB), stream to disk           │
│    2. Extract ZIP if needed (JSZip, with zip-bomb size guard) │
│    3. Preprocess (strip ANSI, Maven download noise)           │
│    4. Parse with framework-aware regex/heuristics             │
│       (localParser.ts — root cause, severity, category,       │
│       cascading-failure grouping, flaky detection)            │
│    5. Stream progress + final result via SSE                  │
│                                                                │
│  POST /api/analyze/fix-suggestions  — OPTIONAL, on-demand      │
│    Batches failed cases (15/batch) into an LLM call for        │
│    actionable fix suggestions. User supplies their own         │
│    API key; not required to use the analyzer at all.           │
│                                                                │
│  GET /api/health                                               │
└────────────────────────────────────────────────────────────────┘
```

**Why local-first?** Regex/heuristic parsing tailored to each test framework's
actual output format is both faster and more reliable than sending every log
line to an LLM — no API cost, no rate limits, no network dependency, and
results are reproducible. The optional AI step is reserved for the one place
an LLM adds real value: turning a diagnosed failure into a concrete,
actionable fix suggestion.

## How Large Files Are Handled

1. **Streamed uploads** — Files are streamed to a temp file on disk (not buffered fully in memory) during the HTTP upload itself.
2. **Bounded accumulation during ZIP processing** — Each entry is decompressed, classified, and either kept (failed cases) or discarded (passed cases) as the archive is processed. Only failed-case content is retained; a small (~50KB) bounded sample of early files feeds build-tool/JDK/duration detection, so memory use scales with failure count, not archive size — a 35MB archive with a handful of failures uses far less memory than one where most tests fail.
3. **Preprocessing** — Strips ANSI escape codes, Maven download noise, and collapses blank lines.
4. **Zip-bomb guard** — ZIP entries are checked against both a per-file and an aggregate uncompressed-size limit before and after decompression, sized for a constrained ~512MB-1GB hosting instance by default (see `MAX_ZIP_ENTRY_UNCOMPRESSED_MB` / `MAX_ZIP_TOTAL_UNCOMPRESSED_MB` below) — raise them via env var on a larger-RAM deployment.
5. **Per-file parsing** — For ZIP archives following Jenkins' one-log-per-test-case export convention, each file is parsed independently and classified as passed/failed based on what the parser actually finds — not a brittle keyword guess.
6. **Optional: skip non-matching files entirely** — If you already know which specific test cases failed, paste them into "Failed Test Cases List" and check "Skip files not matching this list" (only shown once that field has content). Files whose name doesn't correspond to anything in the list are never opened or decompressed at all — the single biggest lever for keeping memory low on a large archive on constrained hosting. Off by default; trades away content-based matching for files that don't match by name, so an imprecise list can miss a failure — use it deliberately, not as the default.

This approach handles logs from 10 KB to 100 MB without ever calling an AI model. On a memory-constrained deployment (e.g. Render's free/Starter tier, ~512MB RAM), also see "Deploying on Low-Memory Hosts" below.

## Key Features

- **🔍 Root Cause Analysis** — Distinguishes symptoms from root causes using framework-aware exception/stack-trace parsing; prefers the first failing attempt (Main Run) over the last when retries fail for unrelated reasons
- **🧾 Structured Log Evidence** — Surfaces what QE actually needs at a glance: the 1-2 execution steps immediately before the failure, an Expected vs Received diff, the page URL, and the failing step's duration — without opening the raw log
- **⚙ Hook-Failure Attribution** — `beforeAll`/`beforeEach`/`afterAll`/`afterEach` failures are flagged as CRITICAL setup issues distinct from regular test failures, since they can silently block every other test in a suite
- **👤 Debug Context** — Extracts the test-account email and labeled artifact links (screenshots, HTML diffs, CI log links) straight from the log body
- **🔗 Cascading Failures** — Groups tests that fail from a shared root cause (matching exception type + stack frame, or identical error message scoped to the same suite); "fix 1 → unblock N"
- **⚠ Flaky Detection** — Based on whether retry attempts actually produced different results, not a blind keyword scan of the whole file — a test failing identically every time is never mislabeled flaky
- **📊 Category Breakdown** — Visual chart of failure categories with click-to-filter
- **📋 Diff Mode** — Compare current vs previous build to isolate new failures
- **🤖 Optional AI Fix Suggestions** — Batched, on-demand LLM calls for actionable fixes; never required, never automatic
- **🚀 Re-run in Jenkins** — Check off failed cases and open a pre-filled Jenkins parameterized-build form in a new tab, ready for a human to click Build; never triggers a build automatically
- **💾 Export** — Download as JSON, CSV, or comprehensive Markdown report, including all of the above evidence fields
- **📜 History** — Last 10 analyses saved locally for instant recall

## Environment Variables

None are required to run the analyzer — log parsing is 100% local. `MAX_ZIP_*` defaults are sized for a constrained ~512MB-1GB hosting instance; raise them if you're on a larger-RAM deployment. The `ANTHROPIC_API_KEY`/etc. vars are only relevant if you want AI fix suggestions to fall back to a server-side key instead of one entered in the UI:

| Variable | Default | Description |
|----------|---------|--------------|
| `PORT` | `3001` | Backend server port |
| `MAX_FILE_SIZE_MB` | `100` | Maximum upload file size (compressed) |
| `MAX_ZIP_ENTRY_UNCOMPRESSED_MB` | `25` | Max decompressed size for a single ZIP entry |
| `MAX_ZIP_TOTAL_UNCOMPRESSED_MB` | `150` | Max total decompressed size across a ZIP archive |
| `NODE_OPTIONS` | — | Not analyzer-specific, but worth setting on low-RAM hosts — see below |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY` | — | Optional server-side fallback key for AI fix suggestions if none is supplied in the UI |

## Deploying on Low-Memory Hosts (e.g. Render Free/Starter)

The backend doesn't set a Node heap-size ceiling by default, so on a memory-constrained instance (Render's free/Starter tiers are commonly ~512MB RAM), an oversized request can be killed by the host's OS before the app ever gets a chance to return a clean error — the connection just dies mid-analysis with no error message. Setting `NODE_OPTIONS=--max-old-space-size=<N>` (in MB, comfortably below your instance's actual RAM — e.g. `400` on a 512MB instance) as an environment variable in your hosting dashboard turns that into a catchable, loggable "JavaScript heap out of memory" error instead of a silent kill. It doesn't by itself reduce memory use — pair it with:

- The `MAX_ZIP_*` defaults above (already sized for this scenario; lower them further if you're on an even smaller instance).
- The "Skip files not matching this list" option (see "How Large Files Are Handled") when you already know which specific tests failed — it avoids ever decompressing the files you don't care about, which is the biggest lever available for a large archive on constrained hosting.
- If you're consistently hitting the ceiling even with the above, the underlying fix is more RAM — either a bigger plan on your current host, or a host that lets you configure per-instance memory more flexibly for a spiky/occasional workload like this (Fly.io, Railway, or Google Cloud Run are reasonable alternatives to evaluate).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + TypeScript |
| Styling | Tailwind CSS v3 |
| Backend | Node.js + Express (TypeScript) |
| Local parsing | Hand-written regex/heuristic engine (`localParser.ts`) — zero AI calls |
| Optional AI | Anthropic, OpenAI, Gemini, Groq, OpenRouter, or Ollama (user's choice, user's key) |
| Testing | Vitest, with fixture logs per test framework (including real-world regression fixtures) |
| Charts | Recharts |
| File Processing | JSZip, multer |
| State | React hooks (useState, useReducer) |
| Storage | localStorage (history) |

## Scripts

```bash
npm run dev          # Start both frontend and backend
npm run build        # Build for production
npm run install:all  # Install all dependencies

cd backend
npm test             # Run the backend test suite (Vitest)
```

## License

MIT
