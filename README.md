# Flow Analyst — Weekly Report Worker

This repo is a headless worker with one job: every Monday morning it fetches marketing data from five client Google Sheets, calls the Anthropic API (with native web search enabled), and commits five structured JSON files to this repo. The dashboard reads those files directly — no Netlify Function needed.

There is no frontend here — just a script and a scheduled GitHub Action.

---

## Per-client report URLs

Replace `flow-co-ai` with your actual GitHub org/username.

```
https://raw.githubusercontent.com/flow-co-ai/flow-analyst/refs/heads/main/billy-doe.json
https://raw.githubusercontent.com/flow-co-ai/flow-analyst/refs/heads/main/hvac.json
https://raw.githubusercontent.com/flow-co-ai/flow-analyst/refs/heads/main/jcl.json
https://raw.githubusercontent.com/flow-co-ai/flow-analyst/refs/heads/main/liferun.json
https://raw.githubusercontent.com/flow-co-ai/flow-analyst/refs/heads/main/vous-physique.json
```

| Slug | Client Name |
|---|---|
| `billy-doe` | Billy Doe Meats |
| `hvac` | HVAC |
| `jcl` | Justice Consumer Law |
| `liferun` | Liferun |
| `vous-physique` | Vous Physique |

---

## Output file shape

Each `<slug>.json` file matches the shape `renderAnalystContent()` in the dashboard expects:

```json
{
  "client": "billy-doe",
  "clientName": "Billy Doe Meats",
  "generatedAt": "2026-05-26T12:00:00Z",
  "weekOf": "April 28, 2026 – May 25, 2026",
  "verdict": "One sentence. Specific numbers. What happened this period.",
  "diagnosis": "One sentence. Best vs worst channel. Top campaign named.",
  "signals": [
    { "headline": "Short headline with a real number", "detail": "One sentence of judgment." }
  ],
  "market_context": {
    "benchmark":  { "label": "INDUSTRY BENCHMARK", "subheader": "...", "body": "..." },
    "seasonal":   { "label": "SEASONAL READ",       "subheader": "...", "body": "..." },
    "competitor": { "label": "COMPETITOR SIGNAL",   "subheader": "...", "body": "..." }
  },
  "recommendations": [
    { "number": "01", "title": "...", "detail": "..." },
    { "number": "02", "title": "...", "detail": "..." },
    { "number": "03", "title": "...", "detail": "..." }
  ]
}
```

`signals` contains 3–5 items. `recommendations` always contains exactly 3.

---

## How to manually trigger the workflow

1. Go to your repo on GitHub.
2. Click the **Actions** tab.
3. In the left sidebar, click **Weekly Analyst**.
4. Click **Run workflow** → leave branch as `main` → click the green **Run workflow** button.

---

## How to add the ANTHROPIC_API_KEY secret

1. Go to **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**.
3. Name: `ANTHROPIC_API_KEY` / Value: your key (`sk-ant-...`).
4. Click **Add secret**.

Web search is handled natively by the Anthropic API — no additional secrets or vendors needed.

---

## Schedule

Runs automatically every **Monday at 6am CST / 7am CDT** (12:00 UTC).
