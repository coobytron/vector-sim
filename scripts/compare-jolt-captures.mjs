/**
 * Compares P14b Jolt captures from different devices into one table.
 *
 *   node scripts/compare-jolt-captures.mjs benchmark-results/p14b-jolt-*.json
 *
 * Each input is a report downloaded from the `?spike=jolt` route. The output is
 * markdown, ready to paste into #37 alongside the adopt/reject call.
 *
 * The D011 baselines this is waiting on are a MacBook Pro M1 Max on Safari 26.x
 * and an iPhone 16 Pro on Mobile Safari; the container capture is included for
 * contrast, not as evidence about devices.
 */
import { readFileSync } from 'node:fs';

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('usage: node scripts/compare-jolt-captures.mjs <capture.json> [...]');
  process.exit(1);
}

/** Condenses a user-agent string into something readable in a table cell. */
function describeDevice(userAgent) {
  const device = /iPhone/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent)
      ? 'iPad'
      : /Macintosh/.test(userAgent)
        ? 'Mac'
        : /Linux/.test(userAgent)
          ? 'Linux'
          : 'Unknown';
  const engine = /CriOS/.test(userAgent)
    ? 'Chrome iOS'
    : /HeadlessChrome/.test(userAgent)
      ? 'Headless Chromium'
      : /Chrome/.test(userAgent)
        ? 'Chrome'
        : /Version\/[\d.]+ Safari/.test(userAgent)
          ? 'Safari'
          : 'Unknown';
  const version = /Version\/([\d.]+)/.exec(userAgent)?.[1] ?? '';
  return `${device} · ${engine}${version ? ` ${version}` : ''}`;
}

const reports = paths.map((path) => ({ path, report: JSON.parse(readFileSync(path, 'utf8')) }));

const rows = [];
let anyOverBudget = false;
let anyNonRepeatable = false;

for (const { path, report } of reports) {
  for (const tier of report.tiers) {
    const overBudget = tier.totalFrameMs.p95 > tier.budgetMs;
    anyOverBudget ||= overBudget;
    rows.push({
      device: describeDevice(report.userAgent),
      tier: tier.tier,
      coldInitMs: report.coldInitMs,
      transferKb:
        report.transferredWasmBytes === null
          ? '—'
          : (report.transferredWasmBytes / 1024).toFixed(0),
      physicsP95: tier.physicsStepMs.p95.toFixed(3),
      queryP95: tier.queryMs.p95.toFixed(3),
      totalP95: tier.totalFrameMs.p95.toFixed(3),
      budget: tier.budgetMs.toFixed(2),
      verdict: overBudget ? '**over budget**' : 'within budget',
      path,
    });
  }
  anyNonRepeatable ||= report.repeatRunsIdentical !== true;
}

console.log('| Device | Tier | Cold init (ms) | WASM (KB) | Physics p95 | Query p95 | Total p95 | Budget | Verdict |');
console.log('|---|---|---:|---:|---:|---:|---:|---:|---|');
for (const row of rows) {
  console.log(
    `| ${row.device} | ${row.tier} | ${row.coldInitMs} | ${row.transferKb} | ${row.physicsP95} | ${row.queryP95} | ${row.totalP95} | ${row.budget} | ${row.verdict} |`,
  );
}

console.log('\n### Determinism');
for (const { path, report } of reports) {
  const hashes = [...new Set(report.repeatRunHashes)];
  console.log(
    `- ${describeDevice(report.userAgent)}: ${report.repeatRunsIdentical ? 'identical' : 'DIVERGED'} — ${hashes.join(', ')}  \`${path}\``,
  );
}

const allHashes = new Set(reports.flatMap(({ report }) => report.repeatRunHashes));
console.log(
  allHashes.size === 1
    ? `\nAll devices agree on \`${[...allHashes][0]}\` — cross-platform state hashes match.`
    : `\n**State hashes differ across devices** (${[...allHashes].join(', ')}). Replay across machines cannot be claimed; normalize or accept per-device hashes.`,
);

const missingBaselines = ['iPhone', 'Mac'].filter(
  (needle) => !reports.some(({ report }) => new RegExp(needle).test(report.userAgent)),
);

let verdict;
if (anyOverBudget || anyNonRepeatable) {
  verdict =
    'At least one capture is over budget or non-repeatable — re-check against the #37 kill criteria before adopting.';
} else if (missingBaselines.length > 0) {
  verdict = `Every capture present is within budget and repeatable, but the gate stays **open**: no capture from ${missingBaselines.join(' or ')}. Container and desktop-class numbers say nothing about the D011 devices.`;
} else {
  verdict =
    'Every capture is within its tier budget and repeatable, and both D011 baselines are present. This closes the device gate left open by #40.';
}
console.log(`\n### Suggested verdict\n\n${verdict}`);
