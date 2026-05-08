import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW_DIR = path.join(REPO_ROOT, 'audit-tier2', 'raw-responses');
const RESULTS_DIR = path.join(REPO_ROOT, 'audit-tier2', 'results');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { rawFile: null, commit: 'unknown' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--raw') out.rawFile = args[++i];
    else if (args[i] === '--commit') out.commit = args[++i];
  }
  if (!out.rawFile) {
    console.error('Usage: node synthesizer.js --raw <path-to-raw-json> [--commit <sha>]');
    process.exit(1);
  }
  return out;
}

function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

function normalizeJudgment(vendorBlock) {
  const vendor = vendorBlock.vendor;
  if (vendorBlock.error) {
    return { vendor, error: vendorBlock.error, judgment: null };
  }
  const parsed = extractJson(vendorBlock.raw);
  if (!parsed) {
    return { vendor, error: 'failed to parse JSON from response', judgment: null, raw_excerpt: (vendorBlock.raw || '').slice(0, 200) };
  }
  return {
    vendor,
    model: vendorBlock.model,
    latency_ms: vendorBlock.latency_ms,
    judgment: {
      verdict: parsed.verdict || 'unknown',
      score: typeof parsed.score === 'number' ? parsed.score : null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      notes: parsed.notes || ''
    }
  };
}

function classifyPanel(judgments) {
  const valid = judgments.filter(j => j.judgment);
  const verdicts = valid.map(j => j.judgment.verdict);
  const distinct = [...new Set(verdicts)];
  if (valid.length < 2) {
    return { panel_verdict: 'inconclusive', agreement: 'insufficient_responses', valid_count: valid.length };
  }
  if (distinct.length === 1) {
    return { panel_verdict: distinct[0], agreement: 'consensus', valid_count: valid.length };
  }
  const counts = {};
  for (const v of verdicts) counts[v] = (counts[v] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [topVerdict, topCount] = sorted[0];
  if (topCount >= 2) {
    const minority = sorted.slice(1).map(([v]) => v).join(',');
    return { panel_verdict: topVerdict, agreement: 'mild_disagreement', minority_verdict: minority, valid_count: valid.length };
  }
  return { panel_verdict: 'no_consensus', agreement: 'no_consensus', verdict_split: counts, valid_count: valid.length };
}

function aggregateFindings(judgments) {
  const all = [];
  for (const j of judgments) {
    if (!j.judgment) continue;
    for (const f of j.judgment.findings) {
      all.push({ ...f, vendor: j.vendor });
    }
  }
  const counts = { critical: 0, serious: 0, minor: 0 };
  for (const f of all) {
    if (counts[f.severity] !== undefined) counts[f.severity]++;
  }
  return { all_findings: all, severity_counts: counts };
}

async function synthesize(rawFile, commitSha) {
  const raw = JSON.parse(await fs.readFile(rawFile, 'utf-8'));
  const rubricName = path.basename(rawFile, '.json').split('-')[0];
  const judgments = raw.map(normalizeJudgment);
  const classification = classifyPanel(judgments);
  const aggregation = aggregateFindings(judgments);
  const result = {
    rubric: rubricName,
    commit: commitSha,
    timestamp: new Date().toISOString(),
    classification,
    aggregation,
    judgments
  };
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const shortCommit = commitSha.slice(0, 7);
  const ts = Date.now();
  const outPath = path.join(RESULTS_DIR, `${rubricName}-${shortCommit}-${ts}.json`);
  await fs.writeFile(outPath, JSON.stringify(result, null, 2));
  console.log(`[synthesizer] panel verdict: ${classification.panel_verdict} (${classification.agreement})`);
  console.log(`[synthesizer] valid responses: ${classification.valid_count}/3`);
  console.log(`[synthesizer] findings: ${aggregation.severity_counts.critical} critical, ${aggregation.severity_counts.serious} serious, ${aggregation.severity_counts.minor} minor`);
  for (const j of judgments) {
    if (j.error) console.log(`[synthesizer] ${j.vendor}: ERROR — ${j.error}`);
    else console.log(`[synthesizer] ${j.vendor}: ${j.judgment.verdict} (score=${j.judgment.score}, conf=${j.judgment.confidence}, ${j.judgment.findings.length} findings)`);
  }
  console.log(`[synthesizer] result: ${outPath}`);
  return { result, outPath };
}

const { rawFile, commit } = parseArgs();
synthesize(rawFile, commit).catch(err => {
  console.error('[synthesizer] FATAL:', err);
  process.exit(2);
});
