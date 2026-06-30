# Running Jenkins Analyzer Locally

A step-by-step guide to run the app on your own Mac. Use this for demos, or as
your day-to-day setup until the team officially deploys to a company-approved host.

> **Why run locally?** The hosted free tier (Render, 512 MB RAM) can crash on
> large uploads (e.g. a 36 MB zip with 400+ log files) because parsing holds a
> lot of text in memory at once. Your laptop has far more RAM, so it handles
> these files comfortably. Local is the most reliable option right now.

---

## 1. Prerequisites

You need two things installed:

| Tool | Version | Check | Install |
|------|---------|-------|---------|
| **Node.js** | 18 or newer (LTS fine) | `node -v` | [nodejs.org](https://nodejs.org) or `brew install node` |
| **Git** | any recent | `git --version` | comes with Xcode CLT, or `brew install git` |

> No API key is required to run the analyzer. Log parsing is **100% local** — no
> AI calls. An API key is only needed for the optional **"Get AI Fix
> Suggestions"** button, and that key is entered in the app's UI (AI Settings),
> not in any file. See [section 5](#5-optional-ai-fix-suggestions).

---

## 2. Get the code

Use **either** method — both give the same result.

**Option A — Git clone** (easiest to pull updates later):
```bash
git clone https://github.com/nirajmehta011/Jenkins-analyzer.git
cd Jenkins-analyzer
```

**Option B — Download ZIP** (no Git needed):
1. Go to https://github.com/nirajmehta011/Jenkins-analyzer
2. Click **Code ▸ Download ZIP** (use the `main` branch).
3. Unzip it, then `cd` into the extracted `Jenkins-analyzer` folder in your terminal.

Then, with either option, install dependencies:
```bash
npm run install:all      # installs root + backend + frontend dependencies
```

`install:all` runs `npm install` in all three folders (root, `backend/`,
`frontend/`). It can take a minute the first time.

> The ZIP does **not** include `node_modules` or a `.env` file — that's normal.
> `npm run install:all` creates `node_modules`, and no `.env` is required (log
> parsing is fully local; an API key, if you want AI fix suggestions, is entered
> in the UI — see [section 5](#5-optional-ai-fix-suggestions)).

---

## 3. Run it — pick ONE mode

### Mode A — Demo / single URL (recommended for showcasing)

Builds the app and serves everything from **one** address. Best for demos and for
team members who just want to *use* the tool.

```bash
npm run build      # compiles backend + frontend (do this once, or after pulling changes)
npm start          # starts the server
```

Then open **http://localhost:3001** — the full app (UI + API) runs there.

To stop: press `Ctrl + C` in the terminal.

### Mode B — Development / hot reload (for working on the code)

Runs frontend and backend separately with live reload on every file save.

```bash
npm run dev
```

- Frontend (what you open): **http://localhost:5173**
- Backend API: **http://localhost:3001** (the frontend talks to it automatically)

To stop: press `Ctrl + C`.

---

## 4. Using the app

1. Open the URL from your chosen mode above.
2. **Drag & drop** (or browse for) your Jenkins log — supports `.log`, `.txt`,
   `.zip`, `.gz`.
3. Pick project type / test framework, then click **Analyze Build Log**.
4. Watch the live progress; explore, filter, and export results (JSON / CSV /
   Markdown) when done.

The analysis (root cause, flaky detection, failure summary) works fully offline —
no internet or API key needed.

---

## 5. (Optional) AI fix suggestions

The **"Get AI Fix Suggestions"** button calls an LLM and needs an API key. You do
**not** put it in a file — enter it in the app:

1. Open the **AI Settings** panel in the UI.
2. Choose a provider (Anthropic, OpenAI, Gemini, Groq, OpenRouter, or Ollama).
3. Paste your API key. It's used only for that request and is not committed
   anywhere.

> **Team note:** keep API keys private — never paste a key into the repo or share
> it in chat. Each person uses their own.

---

## 6. Troubleshooting

**"Port 3001 (or 5173) already in use"**
Something is already running on that port. Free it:
```bash
lsof -ti:3001 | xargs kill -9    # repeat with 5173 if needed
```
Then start again.

**`npm run build` or `npm start` fails after pulling new changes**
Dependencies may have changed. Re-run:
```bash
npm run install:all
```

**Node version errors / weird syntax errors on startup**
Check `node -v` is 18+. If you manage multiple Node versions, switch with `nvm`:
```bash
nvm install 20 && nvm use 20
```

**The browser shows a blank page in Mode A**
You ran `npm start` without building first. Run `npm run build`, then `npm start`.

**Large file still feels slow**
That's normal for very large zips — parsing hundreds of files takes a few
seconds. As long as it completes, it's working. Local has plenty of RAM, so it
won't crash the way the free hosted tier does.

---

## Quick reference

```bash
# First time
git clone https://github.com/nirajmehta011/Jenkins-analyzer.git
cd Jenkins-analyzer
npm run install:all

# Demo / use it (one URL: http://localhost:3001)
npm run build && npm start

# Develop it (UI: http://localhost:5173)
npm run dev
```
