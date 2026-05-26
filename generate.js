import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'fs';

const SHEETS = [
  { name: 'Billy Doe Meats',    id: '1HhCyVAfZdHTQSi91UQ9KVFpzn9gWSU5BdbtWUwblWzY' },
  { name: 'HVAC',               id: '1pskpNsyTX36VWTRy1HeGTAjimcQx8j4YOPM5-q9RBiE' },
  { name: 'Justice Consumer Law', id: '1SN1Z9XMLGoXvSbvxtGlRJPdw1wJL_Ltwq8LvE_iwPv0' },
  { name: 'Liferun',            id: '1Rssk7l4shWDxhCJtE2dCWNL5MlzA-rw1sokUlNmrv84' },
  { name: 'Vous Physique',      id: '1jrMfHkDQHjcySGKzg3-wrKQSAMqvUHTZ42r60HIoWCM' },
];

// --- CSV parsing ---

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? '').trim().replace(/^"|"$/g, ''); });
    return row;
  });
}

// --- Sheet fetching ---

async function fetchSheet(sheet) {
  const url = `https://docs.google.com/spreadsheets/d/${sheet.id}/gviz/tq?tqx=out:csv&sheet=Sheet1`;
  console.log(`  Fetching: ${sheet.name}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${sheet.name}`);
  const text = await res.text();
  const rows = parseCSV(text);
  const cols = Object.keys(rows[0] ?? {}).join(', ');
  console.log(`    → ${rows.length} rows | columns: ${cols}`);
  return rows;
}

// --- Data summarization ---

function toNumber(val) {
  const n = parseFloat(String(val).replace(/[$,%\s]/g, '').replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function summarizeSheet(name, rows) {
  if (!rows.length) return { client: name, note: 'No data available' };

  const headers = Object.keys(rows[0]);

  // Detect numeric columns (>50% of rows parse as a number)
  const numericCols = headers.filter(h => {
    const hits = rows.filter(r => toNumber(r[h]) !== null).length;
    return hits > rows.length * 0.5;
  });

  const summary = { client: name, rowCount: rows.length, columns: headers };

  for (const col of numericCols) {
    const vals = rows.map(r => toNumber(r[col])).filter(v => v !== null);
    if (!vals.length) continue;
    const sum = vals.reduce((a, b) => a + b, 0);
    summary[`total_${col}`]  = round(sum);
    summary[`avg_${col}`]    = round(sum / vals.length);
    summary[`min_${col}`]    = round(Math.min(...vals));
    summary[`max_${col}`]    = round(Math.max(...vals));
  }

  // Keep the 5 most recent rows and the very first row as context
  summary.mostRecentRows = rows.slice(-5);
  summary.oldestRow = rows[0];

  return summary;
}

function round(n) { return Math.round(n * 100) / 100; }

// --- Week label ---

function getWeekOf() {
  const now = new Date();
  const dow = now.getDay(); // 0 = Sunday
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dow + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = d => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

// --- Main ---

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY is not set. Add it as a GitHub secret.');
    process.exit(1);
  }

  console.log('=== Flow Analyst — Weekly Report Generator ===');
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Step 1: Fetch all sheets
  console.log('Step 1/4 — Fetching Google Sheets...');
  const allData = {};
  for (const sheet of SHEETS) {
    try {
      allData[sheet.name] = await fetchSheet(sheet);
    } catch (err) {
      console.error(`ERROR fetching "${sheet.name}": ${err.message}`);
      process.exit(1);
    }
  }

  // Step 2: Summarize each sheet into a compact payload
  console.log('\nStep 2/4 — Summarizing data...');
  const summaries = SHEETS.map(s => summarizeSheet(s.name, allData[s.name]));
  const dataPayload = JSON.stringify(summaries, null, 2);
  console.log(`  Payload size: ${dataPayload.length} characters`);

  // Step 3: Call the Anthropic API
  console.log('\nStep 3/4 — Calling Anthropic API (claude-opus-4-7)...');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const weekOf = getWeekOf();

  let message;
  try {
    message = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4000,
      system:
        'You are a senior marketing analyst at Flow Company. Analyze cross-client paid media performance and produce a weekly insights brief. Be specific, use real numbers, flag what\'s working and what\'s not, and end with 3 prioritized recommendations. Write in clear plain English, not jargon. Format with markdown headers.',
      messages: [
        {
          role: 'user',
          content:
            `Here is this week's aggregated marketing data across all Flow Company clients for the week of ${weekOf}:\n\n` +
            dataPayload +
            `\n\nPlease produce the weekly analyst brief. Aggregate across all clients — include total spend, total leads, average ROAS where available, notable movements, and any anomalies. End with exactly 3 prioritized recommendations.`,
        },
      ],
    });
  } catch (err) {
    console.error(`ERROR calling Anthropic API: ${err.message}`);
    process.exit(1);
  }

  const content = message.content[0].text;
  console.log(`  Response received: ${content.length} characters`);

  // Step 4: Write analyst.json
  console.log('\nStep 4/4 — Writing analyst.json...');
  const output = {
    generatedAt: new Date().toISOString(),
    weekOf,
    content,
  };

  try {
    writeFileSync('analyst.json', JSON.stringify(output, null, 2));
    console.log('  analyst.json written successfully.');
  } catch (err) {
    console.error(`ERROR writing analyst.json: ${err.message}`);
    process.exit(1);
  }

  console.log('\n=== Done ===');
}

main();
