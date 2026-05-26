# Flow Analyst — Weekly Report Worker

This repo is a headless worker with one job: every Monday morning it fetches marketing data from five client Google Sheets, sends it to the Anthropic API for analysis, and commits the result as `analyst.json` to this repo. A separate dashboard reads that JSON file.

There is no frontend here — just a script and a scheduled GitHub Action.

---

## Where the dashboard fetches the report

```
https://raw.githubusercontent.com/USERNAME/flow-analyst/main/analyst.json
```

Replace `USERNAME` with your actual GitHub username after you push this repo.

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
