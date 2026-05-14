import { test, expect } from '@playwright/test';

const BASE_URL = process.env.AUDIT_BASE_URL || 'https://44shots.com';

const SECRET_PATTERNS = [
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/ },
  // Tightened from /[A-Za-z0-9/+=]{40}/ which fired on 40-char comment
  // dividers ("=" x40), button-list strings ("GOAL+MISS+...+FACEOFF"), and
  // vendor namespace URLs ("com/office/2006/...") with no AWS connection.
  // Real AWS Secret Access Keys are 40 chars in strict Base64 alphabet
  // (no "=" padding since 30 raw bytes encode to exactly 40 chars) and
  // in practice always appear with a keyword anchor like
  // aws_secret_access_key=, AWS_SECRET_ACCESS_KEY:, etc.
  { name: 'AWS Secret Key', regex: /aws[_\s-]?secret[_\s-]?(?:access[_\s-]?)?key\s*[:=]\s*["']?([A-Za-z0-9/+]{40})\b/i },
  { name: 'GitHub Token', regex: /gh[pousr]_[A-Za-z0-9]{36,255}/ },
  { name: 'Stripe Live Key', regex: /sk_live_[A-Za-z0-9]{24,}/ },
  { name: 'Stripe Test Key', regex: /sk_test_[A-Za-z0-9]{24,}/ },
  { name: 'OpenAI Key', regex: /sk-[A-Za-z0-9]{32,}/ },
  { name: 'Anthropic Key', regex: /sk-ant-[A-Za-z0-9-_]{32,}/ },
  { name: 'Google API Key', regex: /AIza[0-9A-Za-z\-_]{35}/ },
  { name: 'Supabase Service Role', regex: /service_role.{0,20}eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/ },
  { name: 'Generic JWT (suspicious context)', regex: /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["']?eyJ/ }
];

test.describe('Security audit', () => {

  test('no exposed secrets in client bundle', async ({ page }) => {
    const responses: string[] = [];

    page.on('response', async (response) => {
      const ct = response.headers()['content-type'] || '';
      if (ct.includes('javascript') || ct.includes('html') || ct.includes('json') || ct.includes('css')) {
        try {
          const body = await response.text();
          responses.push(body);
        } catch (e) {
        }
      }
    });

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    const allText = responses.join('\n');
    const findings: string[] = [];

    for (const pattern of SECRET_PATTERNS) {
      const matches = allText.match(pattern.regex);
      if (matches) {
        findings.push(`${pattern.name}: ${matches[0].substring(0, 20)}...`);
      }
    }

    if (findings.length > 0) {
      console.log('\n=== EXPOSED SECRETS DETECTED ===');
      findings.forEach(f => console.log(`  ${f}`));
    }

    expect(findings).toEqual([]);
  });

  test('security headers present on homepage', async ({ page }) => {
    const response = await page.goto(BASE_URL);
    expect(response).not.toBeNull();

    const headers = response!.headers();

    const required: Record<string, (v: string | undefined) => boolean> = {
      'strict-transport-security': v => !!v && v.includes('max-age='),
      'x-content-type-options': v => v === 'nosniff',
      'x-frame-options': v => !!v && (v.toLowerCase() === 'deny' || v.toLowerCase() === 'sameorigin'),
      'referrer-policy': v => !!v && v.length > 0,
    };

    const missing: string[] = [];
    for (const [name, check] of Object.entries(required)) {
      if (!check(headers[name])) {
        missing.push(`${name}: "${headers[name] || 'MISSING'}"`);
      }
    }

    if (missing.length > 0) {
      console.log('\n=== MISSING/MISCONFIGURED SECURITY HEADERS ===');
      missing.forEach(m => console.log(`  ${m}`));
    }

    expect(missing).toEqual([]);
  });

  test('no mixed content (http resources on https page)', async ({ page }) => {
    const mixedContent: string[] = [];

    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith('http://') && !url.startsWith('http://localhost')) {
        mixedContent.push(url);
      }
    });

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    if (mixedContent.length > 0) {
      console.log('\n=== MIXED CONTENT DETECTED ===');
      mixedContent.forEach(u => console.log(`  ${u}`));
    }

    expect(mixedContent).toEqual([]);
  });

  test('Sentry DSN is correctly configured (not placeholder)', async ({ page }) => {
    const sentryRequests: string[] = [];

    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('sentry.io') || url.includes('ingest.sentry')) {
        sentryRequests.push(url);
      }
    });

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    const html = await page.content();
    const hasSentryInit = html.includes('Sentry.init') || html.includes('sentry-cdn') || html.includes('@sentry');
    const hasPlaceholder = html.match(/dsn:\s*["'](your[-_]?dsn|YOUR_DSN|REPLACE_ME|TODO|EXAMPLE)/i);

    expect(hasSentryInit, 'Sentry should be initialized in client').toBe(true);
    expect(hasPlaceholder, 'Sentry DSN should not be a placeholder').toBeNull();
  });
});
