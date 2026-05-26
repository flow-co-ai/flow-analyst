import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'fs';

const CLIENTS = [
  {
    slug: 'billy-doe',
    clientName: 'Billy Doe Meats',
    vertical: 'ecommerce / DTC meat brand',
    sheetId: '1HhCyVAfZdHTQSi91UQ9KVFpzn9gWSU5BdbtWUwblWzY',
  },
  {
    slug: 'hvac',
    clientName: 'HVAC',
    vertical: 'local home services',
    sheetId: '1pskpNsyTX36VWTRy1HeGTAjimcQx8j4YOPM5-q9RBiE',
  },
  {
    slug: 'jcl',
    clientName: 'Justice Consumer Law',
    vertical: 'consumer law firm',
    sheetId: '1SN1Z9XMLGoXvSbvxtGlRJPdw1wJL_Ltwq8LvE_iwPv0',
  },
  {
    slug: 'liferun',
    clientName: 'Liferun',
    vertical: 'medical / wellness',
    sheetId: '1Rssk7l4shWDxhCJtE2dCWNL5MlzA-rw1sokUlNmrv84',
  },
  {
    slug: 'vous-physique',
    clientName: 'Vous Physique',
    vertical: 'fitness studio',
    sheetId: '1jrMfHkDQHjcySGKzg3-wrKQSAMqvUHTZ42r60HIoWCM',
  },
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

async function fetchSheet(sheetId, clientName) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=Sheet1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const rows = parseCSV(text);
  const cols = Object.keys(rows[0] ?? {}).join(', ');
  console.log(`  [${clientName}] ${rows.length} rows | columns: ${cols}`);
  return rows;
}

// --- Data summarization ---

function toNumber(val) {
  const n = parseFloat(String(val).replace(/[$,%\s]/g, '').replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function round(n) { return Math.round(n * 100) / 100; }

function summarizeRows(rows) {
  if (!rows.length) return { note: 'No data available' };

  const headers = Object.keys(rows[0]);

  const numericCols = headers.filter(h => {
    const hits = rows.filter(r => toNumber(r[h]) !== null).length;
    return hits > rows.length * 0.5;
  });

  const summary = { rowCount: rows.length, columns: headers };

  for (const col of numericCols) {
    const vals = rows.map(r => toNumber(r[col])).filter(v => v !== null);
    if (!vals.length) continue;
    const sum = vals.reduce((a, b) => a + b, 0);
    summary[`total_${col}`] = round(sum);
    summary[`avg_${col}`]   = round(sum / vals.length);
    summary[`min_${col}`]   = round(Math.min(...vals));
    summary[`max_${col}`]   = round(Math.max(...vals));
  }

  // Week-over-week: if there's a date-like column, compare last row vs second-to-last
  const dateCol = headers.find(h => /date|week|period/i.test(h));
  if (dateCol && rows.length >= 2) {
    const prev = rows[rows.length - 2];
    const curr = rows[rows.length - 1];
    const wow = {};
    for (const col of numericCols) {
      const p = toNumber(prev[col]);
      const c = toNumber(curr[col]);
      if (p !== null && c !== null && p !== 0) {
        wow[col] = { previous: p, current: c, changePct: round(((c - p) / Math.abs(p)) * 100) };
      }
    }
    if (Object.keys(wow).length) summary.weekOverWeek = wow;
  }

  summary.mostRecentRows = rows.slice(-5);
  summary.oldestRow = rows[0];

  return summary;
}

// --- Week label ---

function getWeekOf() {
  const now = new Date();
  const dow = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dow + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = d => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

// --- Per-client report ---

async function generateClientReport(client, anthropic, weekOf) {
  console.log(`\n--- ${client.clientName} (${client.slug}) ---`);

  const rows = await fetchSheet(client.sheetId, client.clientName);
  const summary = summarizeRows(rows);
  const dataPayload = JSON.stringify(summary, null, 2);
  console.log(`  Payload: ${dataPayload.length} chars → calling Anthropic...`);

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4000,
    system: `You are a senior marketing analyst at Flow Company writing a weekly performance brief for one specific client. The client is ${client.clientName}, a ${client.vertical} business. Analyze only this client's paid media performance. Be specific, use real numbers from the data provided, flag what's working and what's not, and end with 3 prioritized recommendations tailored to this client's vertical. Write in clear plain English, not jargon. Format with markdown headers.`,
    messages: [
      {
        role: 'user',
        content:
          `Here is ${client.clientName}'s paid media data for the week of ${weekOf}:\n\n` +
          dataPayload +
          `\n\nPlease produce the weekly analyst brief.`,
      },
    ],
  });

  const content = message.content[0].text;
  console.log(`  Response: ${content.length} chars`);

  const output = {
    client: client.slug,
    clientName: client.clientName,
    generatedAt: new Date().toISOString(),
    weekOf,
    content,
  };

  writeFileSync(`${client.slug}.json`, JSON.stringify(output, null, 2));
  console.log(`  Written: ${client.slug}.json`);
}

// --- Main ---

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY is not set. Add it as a GitHub secret.');
    process.exit(1);
  }

  console.log('=== Flow Analyst — Weekly Per-Client Report Generator ===');
  console.log(`Started: ${new Date().toISOString()}`);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const weekOf = getWeekOf();
  console.log(`Week of: ${weekOf}\n`);

  const failed = [];

  for (const client of CLIENTS) {
    try {
      await generateClientReport(client, anthropic, weekOf);
    } catch (err) {
      console.error(`ERROR [${client.slug}]: ${err.message}`);
      failed.push(client.slug);
    }
  }

  const successCount = CLIENTS.length - failed.length;
  console.log(`\n=== Generated ${successCount}/${CLIENTS.length} reports successfully ===`);
  if (failed.length) {
    console.log(`Failed clients: ${failed.join(', ')}`);
  }

  if (failed.length === CLIENTS.length) {
    console.error('All reports failed. Exiting with code 1.');
    process.exit(1);
  }
}

main();
