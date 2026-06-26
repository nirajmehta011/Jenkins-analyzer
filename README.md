# Jenkins Log Analyzer 🔬

An AI-powered web application that analyzes Jenkins build logs with surgical precision, identifying root causes, cascading failures, flaky tests, and providing actionable fix suggestions. Upload your CI/CD logs and get a comprehensive forensic analysis in seconds.

## Prerequisites

- **Node.js 18+** (LTS recommended)
- **Anthropic API Key** — get one at [console.anthropic.com](https://console.anthropic.com)

## Quick Start

```bash
# 1. Clone and install
git clone <your-repo-url>
cd jenkins-analyzer
npm run install:all

# 2. Configure backend
cp backend/.env.example backend/.env
# Edit backend/.env and add your ANTHROPIC_API_KEY

# 3. Start development servers
npm run dev
```

Frontend runs at **http://localhost:5173**, backend at **http://localhost:3001**.

## How to Use

1. **Upload** — Drag & drop your Jenkins console log (.log, .txt, .zip, .gz)
2. **Configure** — Select project type, test framework, and analysis options
3. **Analyze** — Click "Analyze Build Log" and watch real-time progress
4. **Explore** — Filter by status, category, severity; search test cases
5. **Export** — Download results as JSON, CSV, or Markdown report
6. **Compare** — Upload a previous analysis JSON to diff against

## Supported Log Formats

| Format | Description |
|--------|-------------|
| Jenkins Console Output | Raw console log from any Jenkins build |
| Maven Surefire Reports | Embedded XML test results (auto-detected) |
| pytest Output | Python test session output with markers |
| JUnit XML | Standard JUnit XML format in log or ZIP |
| ZIP Archives | Multi-file archives with mixed log types |
| .gz Files | Gzip compressed log files |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Frontend (React)                   │
│                                                     │
│  UploadZone → ConfigPanel → ProgressTracker         │
│                    ↓                                │
│  SummaryCards → FilterBar → CaseList → CaseCard     │
│  TrendChart → DiffView → ExportBar → History        │
│                                                     │
│  Vite dev server (:5173) ──proxy──→ /api            │
└────────────────────┬────────────────────────────────┘
                     │ SSE (Server-Sent Events)
┌────────────────────▼────────────────────────────────┐
│                  Backend (Express)                    │
│                                                     │
│  POST /api/analyze                                  │
│    1. Accept file (multer, ≤100 MB)                 │
│    2. Extract ZIP if needed (JSZip)                 │
│    3. Preprocess (strip ANSI, Maven noise)          │
│    4. Chunk by suite boundaries (80K chars)         │
│    5. Analyze each chunk → Claude claude-sonnet-4-6           │
│    6. Merge & deduplicate results                   │
│    7. Stream progress via SSE                       │
│                                                     │
│  GET /api/health                                    │
└─────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | **Required.** Your Anthropic API key |
| `PORT` | `3001` | Backend server port |
| `MAX_FILE_SIZE_MB` | `100` | Maximum upload file size |
| `CHUNK_SIZE_CHARS` | `80000` | Max characters per AI analysis chunk |
| `VITE_API_URL` | `http://localhost:3001` | Backend URL for frontend (dev proxy handles this) |

## How Large Files Are Handled

The analyzer uses an intelligent **chunking strategy** to handle logs of any size:

1. **Preprocessing** — Strips ANSI escape codes, Maven download noise, and collapses blank lines (often reducing log size by 30-50%)
2. **Suite-Boundary Splitting** — Chunks are split at natural boundaries (Surefire `Running` lines, pytest session starts) to keep test context intact
3. **60-Line Overlap** — Each chunk includes the last 60 lines of the previous chunk for context continuity
4. **Sequential Analysis** — Chunks are analyzed in order with accumulated context (seen suites, failure count) passed to each subsequent analysis
5. **Dedup & Merge** — Results are deduplicated by test name + suite, with the most complete entry preserved

This approach handles logs from 10 KB to 100 MB while maintaining analysis quality.

## Key Features

- **🔍 Root Cause Analysis** — Distinguishes symptoms from root causes; never reports `NullPointerException` as the cause
- **🔗 Cascading Failures** — Groups tests that fail from a shared root cause; "fix 1 → unblock N"
- **⚠ Flaky Detection** — Identifies intermittent failures (timeouts, race conditions, port conflicts)
- **📊 Category Breakdown** — Visual chart of failure categories with click-to-filter
- **📋 Diff Mode** — Compare current vs previous build to isolate new failures
- **💾 Export** — Download as JSON, CSV, or comprehensive Markdown report
- **📜 History** — Last 10 analyses saved locally for instant recall

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS v3 |
| Backend | Node.js + Express (TypeScript) |
| AI | Anthropic Claude claude-sonnet-4-6 |
| Charts | Recharts |
| File Processing | JSZip, multer |
| State | React hooks (useState, useReducer) |
| Storage | localStorage (history) |

## Scripts

```bash
npm run dev          # Start both frontend and backend
npm run build        # Build for production
npm run install:all  # Install all dependencies
```

## License

MIT
