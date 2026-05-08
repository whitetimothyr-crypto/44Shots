# Audit — Known Issues

## Tier 1

### AWS Secret Key regex false positive
- **File:** audit-tests/security.spec.ts
- **Symptom:** matches 40-char strings of mixed dividers + padding (e.g. "==================== abc12345...")
- **Root cause:** regex pattern matches base64-padding-like sequences that appear in bundled code
- **Status:** deferred. Real exposed-key scanning still works; this rule needs a structural floor (require alphanumeric start) or replacement with a more specific AWS key heuristic.
- **Workaround for now:** when this test fails, manually inspect the matched string. If it starts with "=" or contains divider patterns, it's a false positive.

### Missing security headers (real finding)
- **Symptom:** x-content-type-options, x-frame-options, referrer-policy missing on 44shots.com
- **Root cause:** vercel.json has no headers block
- **Status:** deferred. Real production gap, separate fix.
