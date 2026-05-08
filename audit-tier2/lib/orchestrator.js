import { config as dotenvConfig } from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

dotenvConfig({ path: '.env.audit' });

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const GOOGLE_MODEL = process.env.GOOGLE_MODEL || 'gemini-2.5-pro';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const TARGET_URL = process.env.AUDIT_TARGET_URL || 'https://44shots.com';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUBRICS_DIR = path.join(REPO_ROOT, 'audit-tier2', 'rubrics');
const INPUTS_DIR = path.join(REPO_ROOT, 'audit-tier2', 'inputs');
const RAW_DIR = path.join(REPO_ROOT, 'audit-tier2', 'raw-responses');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { rubric: null, target: TARGET_URL };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rubric') out.rubric = args[++i];
    else if (args[i] === '--target') out.target = args[++i];
  }
  if (!out.rubric) {
    console.error('Usage: node orchestrator.js --rubric <name> [--target <url>]');
    process.exit(1);
  }
  return out;
}

async function captureEvidence(targetUrl) {
  console.log(`[capture] loading ${targetUrl}`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30_000 });
  const html = await page.content();
  const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
  await browser.close();
  await fs.mkdir(INPUTS_DIR, { recursive: true });
  const ts = Date.now();
  const htmlPath = path.join(INPUTS_DIR, `capture-${ts}.html`);
  const pngPath = path.join(INPUTS_DIR, `capture-${ts}.png`);
  await fs.writeFile(htmlPath, html);
  await fs.writeFile(pngPath, screenshot);
  console.log(`[capture] html=${htmlPath} (${html.length} chars)`);
  console.log(`[capture] png=${pngPath} (${screenshot.length} bytes)`);
  return { html, screenshot, htmlPath, pngPath };
}

async function judgeAnthropic(rubric, url, html, screenshot) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const userText = `URL: ${url}\n\nRENDERED HTML (truncated to 80k chars):\n${html.slice(0, 80_000)}`;
  const t0 = Date.now();
  const resp = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    system: rubric,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot.toString('base64') } },
        { type: 'text', text: userText }
      ]
    }]
  });
  const text = resp.content.map(c => c.type === 'text' ? c.text : '').join('');
  return { vendor: 'anthropic', model: ANTHROPIC_MODEL, latency_ms: Date.now() - t0, raw: text, usage: resp.usage };
}

async function judgeGoogle(rubric, url, html, screenshot) {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
  const userText = `URL: ${url}\n\nRENDERED HTML (truncated to 80k chars):\n${html.slice(0, 80_000)}`;
  const t0 = Date.now();
  const resp = await ai.models.generateContent({
    model: GOOGLE_MODEL,
    contents: [{
      role: 'user',
      parts: [
        { text: rubric },
        { inlineData: { mimeType: 'image/png', data: screenshot.toString('base64') } },
        { text: userText }
      ]
    }],
    config: { maxOutputTokens: 4096 }
  });
  const text = resp.text || '';
  return { vendor: 'google', model: GOOGLE_MODEL, latency_ms: Date.now() - t0, raw: text, usage: resp.usageMetadata };
}

async function judgeOpenAI(rubric, url, html, screenshot) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const userText = `URL: ${url}\n\nRENDERED HTML (truncated to 80k chars):\n${html.slice(0, 80_000)}`;
  const t0 = Date.now();
  const resp = await client.chat.completions.create({
    model: OPENAI_MODEL,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: rubric },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshot.toString('base64')}` } },
          { type: 'text', text: userText }
        ]
      }
    ]
  });
  const text = resp.choices[0]?.message?.content || '';
  return { vendor: 'openai', model: OPENAI_MODEL, latency_ms: Date.now() - t0, raw: text, usage: resp.usage };
}

async function runPanel(rubricName, targetUrl) {
  const rubricPath = path.join(RUBRICS_DIR, `${rubricName}.md`);
  const rubric = await fs.readFile(rubricPath, 'utf-8');
  const { html, screenshot } = await captureEvidence(targetUrl);
  console.log('[panel] dispatching to 3 vendors in parallel');
  const results = await Promise.allSettled([
    judgeAnthropic(rubric, targetUrl, html, screenshot),
    judgeGoogle(rubric, targetUrl, html, screenshot),
    judgeOpenAI(rubric, targetUrl, html, screenshot)
  ]);
  await fs.mkdir(RAW_DIR, { recursive: true });
  const ts = Date.now();
  const rawPath = path.join(RAW_DIR, `${rubricName}-${ts}.json`);
  const payload = results.map((r, i) => {
    const vendor = ['anthropic', 'google', 'openai'][i];
    if (r.status === 'fulfilled') return r.value;
    return { vendor, error: String(r.reason?.message || r.reason) };
  });
  await fs.writeFile(rawPath, JSON.stringify(payload, null, 2));
  console.log(`[panel] raw responses written to ${rawPath}`);
  for (const p of payload) {
    if (p.error) console.log(`[panel] ${p.vendor}: ERROR — ${p.error}`);
    else console.log(`[panel] ${p.vendor}: ${p.latency_ms}ms, ${p.raw.length} chars`);
  }
  return { rubricName, targetUrl, timestamp: ts, payload, rawPath };
}

const { rubric, target } = parseArgs();
runPanel(rubric, target).then(result => {
  console.log(`[orchestrator] complete. Raw: ${result.rawPath}`);
}).catch(err => {
  console.error('[orchestrator] FATAL:', err);
  process.exit(2);
});
