import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, unlinkSync } from 'fs';

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

// --- Data extraction ---

function round(n) { return Math.round(n * 100) / 100; }

function toNumber(val) {
  const n = parseFloat(String(val).replace(/[$,%\s]/g, '').replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

// Returns per-column aggregates: { colName: { type, total?, avg?, last } }
function buildColumnSummary(rows) {
  if (!rows.length) return {};
  const headers = Object.keys(rows[0]);
  const summary = {};
  for (const col of headers) {
    const vals = rows.map(r => (r[col] ?? '').trim()).filter(v => v !== '');
    if (!vals.length) continue;
    const nums = vals.map(v => toNumber(v)).filter(n => n !== null);
    if (nums.length > vals.length * 0.5) {
      const sum = nums.reduce((a, b) => a + b, 0);
      summary[col] = {
        type: 'numeric',
        total: round(sum),
        avg: round(sum / nums.length),
        last: round(nums[nums.length - 1]),
      };
    } else {
      summary[col] = { type: 'text', last: vals[vals.length - 1] };
    }
  }
  return summary;
}

// Buckets column names into prompt sections by keyword match.
// Unmatched columns fall into paidMedia (most common catch-all).
function bucketColumns(headers, locationCol) {
  const patterns = {
    paidMedia:     /spend|budget|cost|lead|impression|(?<!call_)click|meta|facebook|google.?ad|adword|campaign|ad.?set|conversion|ads\b|\breach\b/i,
    local:         /gbp|google.?business|business.?profile|phone.?call|call_click|\bcall\b|direction_request|map|review|listing|search.?appear/i,
    organic:       /instagram|ig\b|organic|follower|reach|social|\bpost_|engagement|reel|story/i,
    crm:           /crm|pipeline|opportunit|booked|deal|revenue|close|prospect|contract|\bcontact_/i,
    topPerformers: /top|best|winner|performer|creative/i,
  };

  const buckets = { paidMedia: [], local: [], organic: [], crm: [], topPerformers: [] };

  for (const h of headers) {
    if (h === locationCol) continue;
    let placed = false;
    for (const [section, regex] of Object.entries(patterns)) {
      if (regex.test(h)) { buckets[section].push(h); placed = true; break; }
    }
    if (!placed) buckets.paidMedia.push(h); // unmatched → paid media
  }

  return buckets;
}

// Formats a list of columns from the summary into a readable string block.
function formatSection(cols, summary) {
  if (!cols.length) return 'No data available for this section.';
  const lines = cols.map(col => {
    const entry = summary[col];
    if (!entry) return null;
    if (entry.type === 'numeric') {
      return `${col}: ${entry.total} total (avg ${entry.avg} per period, latest ${entry.last})`;
    }
    return `${col}: ${entry.last}`;
  }).filter(Boolean);
  return lines.length ? lines.join('\n') : 'No data available for this section.';
}

// Top-level extraction. Returns { location, paidMedia, local, organic, crm, topPerformers }.
function extractClientData(rows) {
  const empty = 'No data available.';
  if (!rows.length) {
    return { location: 'not specified', paidMedia: empty, local: empty, organic: empty, crm: empty, topPerformers: empty };
  }

  const headers = Object.keys(rows[0]);
  const locationCol = headers.find(h => /^(location|city|state|address|region|market)$/i.test(h)) ?? null;
  const location = locationCol ? (rows[rows.length - 1][locationCol] || 'not specified') : 'not specified';

  const summary = buildColumnSummary(rows);
  const buckets = bucketColumns(headers, locationCol);

  return {
    location,
    paidMedia:     formatSection(buckets.paidMedia, summary),
    local:         formatSection(buckets.local, summary),
    organic:       formatSection(buckets.organic, summary),
    crm:           formatSection(buckets.crm, summary),
    topPerformers: formatSection(buckets.topPerformers, summary),
  };
}

// --- 28-day period label ---

function getPeriod() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 27); // 28 days inclusive
  const fmt = d => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

// --- Prompt builder ---

function buildUserPrompt(client, data, period) {
  return `CLIENT: ${client.clientName}
VERTICAL: ${client.vertical}
LOCATION: ${data.location}
PERIOD: Last 28 days (${period})

PAID MEDIA (last 28 days):
${data.paidMedia}

LOCAL PRESENCE (Google Business Profile, last 28 days):
${data.local}

ORGANIC AND SOCIAL (last 28 days):
${data.organic}

CRM PIPELINE (last 28 days):
${data.crm}

TOP PERFORMERS:
${data.topPerformers}

INSTRUCTIONS:
Use the web_search tool to research:
1. Current industry benchmarks for ${client.vertical} (cost per lead, conversion rate norms)
2. Competitor or category-level trends in ${client.vertical} this month

Then call the emit_report tool with the structured findings. Do not write the report as text — only call emit_report.

LENGTH RULES — STRICT, NON-NEGOTIABLE:
- verdict: ONE sentence, maximum 25 words. The headline takeaway.
- diagnosis: ONE sentence, maximum 30 words. The key insight with the most important number.
- signals[].headline: maximum 8 words. Must contain a number.
- signals[].detail: maximum 25 words. One sentence of judgment.
- market_context.benchmark.subheader: maximum 10 words.
- market_context.benchmark.body: maximum 40 words.
- market_context.seasonal.subheader: maximum 10 words.
- market_context.seasonal.body: maximum 40 words.
- market_context.competitor.subheader: maximum 10 words.
- market_context.competitor.body: maximum 40 words.
- recommendations[].title: maximum 12 words.
- recommendations[].detail: maximum 35 words.

WRITING RULES:
- Be ruthless. Cut every word that isn't load-bearing.
- One idea per field. Do not stack multiple insights into one body.
- Lead with the most important number or finding.
- Skip throat-clearing ("Multiple 2026 industry reports place...", "Industry research consistently points to..."). Just say the thing.
- No "however," "meanwhile," "on the bright side" — just the next sentence.
- Skip the "what to do about it" inside body fields — that lives in recommendations.

OTHER RULES:
- Never use marketing acronyms (no CPL, no CPM, no ROAS, no CTR, no CAC, no LTV). Spell out everything ("cost per lead", "return on ad spend", etc).
- Write for a small business owner. Plain English.
- All metrics are LAST 28 DAYS ONLY. Frame everything as "this period".
- Every number must come from the data provided. Never invent figures.
- Recommendations are suggestions, never commitments. Frame as "consider", "test", "worth exploring".
- Return EXACTLY 3 recommendations.
- Return between 3 and 5 signals.`;
}

// --- Tool definitions ---

const EMIT_REPORT_TOOL = {
  name: 'emit_report',
  description: 'Emit the structured weekly analyst report for this client.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string' },
      diagnosis: { type: 'string' },
      signals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            headline: { type: 'string' },
            detail: { type: 'string' },
          },
          required: ['headline', 'detail'],
        },
        minItems: 3,
        maxItems: 5,
      },
      market_context: {
        type: 'object',
        properties: {
          benchmark:  { type: 'object', properties: { label: { type: 'string' }, subheader: { type: 'string' }, body: { type: 'string' } }, required: ['label', 'subheader', 'body'] },
          seasonal:   { type: 'object', properties: { label: { type: 'string' }, subheader: { type: 'string' }, body: { type: 'string' } }, required: ['label', 'subheader', 'body'] },
          competitor: { type: 'object', properties: { label: { type: 'string' }, subheader: { type: 'string' }, body: { type: 'string' } }, required: ['label', 'subheader', 'body'] },
        },
        required: ['benchmark', 'seasonal', 'competitor'],
      },
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            number: { type: 'string' },
            title:  { type: 'string' },
            detail: { type: 'string' },
          },
          required: ['number', 'title', 'detail'],
        },
        minItems: 3,
        maxItems: 3,
      },
    },
    required: ['verdict', 'diagnosis', 'signals', 'market_context', 'recommendations'],
  },
};

// --- Response parsing ---

function extractToolUseInput(message) {
  const toolUse = message.content.find(b => b.type === 'tool_use' && b.name === 'emit_report');
  if (!toolUse) throw new Error('No emit_report tool_use block found in response');
  return toolUse.input;
}

// --- Per-client report ---

async function generateClientReport(client, anthropic, period) {
  process.stdout.write(`Processing ${client.slug}...`);

  const rows = await fetchSheet(client.sheetId, client.clientName);
  const data = extractClientData(rows);
  const userPrompt = buildUserPrompt(client, data, period);

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 8000,
    system: 'You are the senior analyst for Flow Company. Write extremely concise client briefings — short, scannable, one idea per field. Plain English. No marketing acronyms. If a sentence has more than 25 words, cut it. Brevity is the product.',
    tools: [{ type: 'web_search_20250305', name: 'web_search' }, EMIT_REPORT_TOOL],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const parsed = extractToolUseInput(message);

  const output = {
    client: client.slug,
    clientName: client.clientName,
    generatedAt: new Date().toISOString(),
    weekOf: period,
    verdict: parsed.verdict,
    diagnosis: parsed.diagnosis,
    signals: parsed.signals,
    market_context: parsed.market_context,
    recommendations: parsed.recommendations,
  };

  writeFileSync(`${client.slug}.json`, JSON.stringify(output, null, 2));
  console.log(` ✓ ${client.slug} written`);
  return true;
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
  const period = getPeriod();
  console.log(`Period: ${period}\n`);

  for (const client of CLIENTS) {
    try { unlinkSync(`${client.slug}.json`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }

  const failed = [];

  for (const client of CLIENTS) {
    try {
      await generateClientReport(client, anthropic, period);
    } catch (err) {
      console.log(` ✗ ${client.slug} failed: ${err.message}`);
      failed.push(client.slug);
    }
  }

  const successCount = CLIENTS.length - failed.length;
  console.log(`\nGenerated ${successCount}/5 reports successfully`);
  if (failed.length) console.log(`Failed: ${failed.join(', ')}`);

  if (failed.length === CLIENTS.length) process.exit(1);
}

main();
