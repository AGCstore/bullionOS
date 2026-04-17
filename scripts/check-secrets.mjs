#!/usr/bin/env node
// Pre-commit secret scanner. Run by .githooks/pre-commit on every commit.
// Zero dependencies — uses only Node + `git` CLI so it runs on fresh clones.
//
// Detects common credential shapes against staged file diffs. Tuned for LOW
// false positives (won't flag ordinary code); any pattern it finds should be
// investigated. Exits 1 on any match, blocking the commit.

import { execSync } from 'node:child_process';

// Regex catalog. Each entry: [name, pattern, optional validator].
// Prefer long, structurally distinctive patterns over short keywords to
// minimize noise on ordinary strings.
const RULES = [
  ['AWS Access Key ID',         /\bAKIA[0-9A-Z]{16}\b/g],
  ['AWS Secret Access Key',     /\b(?:aws_secret|AWS_SECRET|secret[_-]?access[_-]?key)["'\s:=]+[A-Za-z0-9/+=]{40}\b/g],
  ['GitHub PAT (classic)',      /\bghp_[A-Za-z0-9]{36,}\b/g],
  ['GitHub fine-grained PAT',   /\bgithub_pat_[A-Za-z0-9_]{82,}\b/g],
  ['GitHub OAuth token',        /\bgho_[A-Za-z0-9]{36,}\b/g],
  ['GitHub app token',          /\bghs_[A-Za-z0-9]{36,}\b/g],
  ['Slack token',               /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['Stripe live key',           /\bsk_live_[A-Za-z0-9]{24,}\b/g],
  ['Stripe test key',           /\bsk_test_[A-Za-z0-9]{24,}\b/g],
  ['Twilio Account SID',        /\bAC[a-f0-9]{32}\b/g],
  ['Twilio Auth Token shape',   /\b[a-f0-9]{32}\b(?=.*twilio)/gi],
  ['Google API key',            /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['SendGrid API key',          /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g],
  ['Mailgun key',               /\bkey-[a-f0-9]{32}\b/g],
  ['PEM private key',           /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----/g],
  ['JWT (likely real)',         /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  // UPS / FedEx-style: 48+ char mixed-case alnum that looks like a credential.
  // Only matches when clearly marked as a secret, to avoid false positives on hashes.
  ['Generic long secret',       /\b(?:client[_-]?secret|api[_-]?secret|auth[_-]?token|password)["'\s:=]+[A-Za-z0-9]{32,}\b/gi],
];

// Files we never want to scan (binary blobs, lockfiles, vendored code).
const SKIP_PATTERNS = [
  /^pnpm-lock\.yaml$/,
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^\.git\//,
  /node_modules\//,
  /\.(png|jpg|jpeg|gif|webp|pdf|ico|woff2?|ttf)$/i,
  /\/uploads\//,
];

// Explicit exceptions for known-safe literals in the repo (e.g. dev fixtures).
const ALLOWED_HASHES = new Set([
  // bcrypt dummy hash used for timing-safe login compare
  '$2b$12$invalidsaltinvalidsaltinvalid.DummyHashForTimingOnly',
]);

function getStagedFiles() {
  const out = execSync('git diff --cached --name-only --diff-filter=ACM', {
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

function getStagedContent(file) {
  try {
    return execSync(`git show ":${file}"`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return '';
  }
}

function scan() {
  const files = getStagedFiles().filter((f) => !SKIP_PATTERNS.some((p) => p.test(f)));
  const findings = [];

  for (const file of files) {
    const content = getStagedContent(file);
    for (const [name, pattern] of RULES) {
      for (const match of content.matchAll(pattern)) {
        const snippet = match[0];
        if (ALLOWED_HASHES.has(snippet)) continue;
        // Mask the middle of the match so the hook output doesn't leak it
        // further (terminal scrollback, CI logs).
        const masked =
          snippet.length > 20
            ? `${snippet.slice(0, 6)}…${snippet.slice(-4)} (${snippet.length} chars)`
            : snippet;
        // Find approximate line number
        const idx = content.indexOf(snippet);
        const line = content.slice(0, idx).split('\n').length;
        findings.push({ file, line, name, masked });
      }
    }
  }

  if (findings.length === 0) {
    process.exit(0);
  }

  console.error('\n❌ Potential secret(s) detected in staged files:\n');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.name}]  ${f.masked}`);
  }
  console.error('\nIf this is a false positive, add the exact literal to ALLOWED_HASHES');
  console.error('in scripts/check-secrets.mjs, or bypass with:  git commit --no-verify\n');
  process.exit(1);
}

scan();
