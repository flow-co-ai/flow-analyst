# Flow Analyst — Weekly Report Worker

This repo is a headless worker with one job: every Monday morning it fetches marketing data from five client Google Sheets, sends each client's data to the Anthropic API for individual analysis, and commits five per-client JSON files to this repo. A separate dashboard reads those JSON files.

There is no frontend here — just a script and a scheduled GitHub Action.

---

## Per-client report URLs

Each client gets its own JSON file at the repo root. Replace `flow-co-ai` with your actual GitHub org/username after you push this repo.

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

Each file has this shape:

```json
{
  "client": "billy-doe",
  "clientName": "Billy Doe Meats",
  "generatedAt": "2026-05-26T12:00:00Z",
  "weekOf": "May 25, 2026 – May 31, 2026",
  "content": "...full markdown analyst output..."
}
```

---

## How to manually trigger the workflow

1. Go to your repo on GitHub.
2. Click the **Actions** tab at the top.
3. In the left sidebar, click **Weekly Analyst**.
4. Click the **Run workflow** button (top-right of the table).
5. Leave the branch as `main` and click the green **Run workflow** button.

The workflow will appear in the list within a few seconds. Click it to watch the live logs.

---

## How to add the ANTHROPIC_API_KEY secret

1. Go to your repo on GitHub.
2. Click **Settings** → **Secrets and variables** → **Actions**.
3. Click **New repository secret**.
4. Name: `ANTHROPIC_API_KEY`
5. Value: your Anthropic API key (starts with `sk-ant-...`).
6. Click **Add secret**.

The workflow reads this secret automatically — you never paste the key into code.

---

## Schedule

Runs automatically every **Monday at 6am CST / 7am CDT** (12:00 UTC).
