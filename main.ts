// Launch Radar — token-radar-01 entry point.
// Reads the sealed snapshot, fits the model in lib/model.ts, and writes
// board.json, dashboard/ (+ data.js), screenshots/ and dossier.json to the
// output directory. Deterministic: seeded RNG only, no wall clock.

import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import {
  MODEL_VERSION,
  STANDARD_CAPITAL,
  USER_SHARE,
  CAUTIOUS_SHARE,
  ageDays,
  categoryFactors,
  cheapestGas,
  farmSteps,
  fitCurve,
  holdDaysFor,
  isPreToken,
  mulberry32,
  nearestComps,
  netFor,
  quantileSorted,
  reading,
  round1,
  round2,
  round4,
  runValidation,
  selectComps,
  setAsideReason,
} from './lib/model.ts';
import type { Protocol, Snapshot } from './lib/model.ts';

const root = dirname(fileURLToPath(import.meta.url));

function parseArgs(): { input: string; output: string } {
  const args = process.argv.slice(2);
  let input = '/input/snapshot.json';
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) input = args[++i] as string;
    else if (args[i] === '--output' && args[i + 1]) output = args[++i] as string;
  }
  if (existsSync(input) && statSync(input).isDirectory()) input = join(input, 'snapshot.json');
  return { input, output };
}

const { input, output } = parseArgs();
const snap = JSON.parse(readFileSync(input, 'utf8')) as Snapshot;
const asOfMs = Date.parse(snap.as_of + 'T00:00:00Z');
const watchlist = new Set(snap.watchlist);

const comps = selectComps(snap.protocols);
const curve = fitCurve(comps);
const factors = categoryFactors(comps, curve);
const validation = runValidation(comps, asOfMs);
const bandMult = Math.pow(10, validation.band_half_log10);

// ---- universe accounting: every protocol lands in exactly one bucket ----
const BUCKETS = ['ranked', 'live-token', 'bridge', 'liquid staking or restaking', 'exchange custody', 'versioned release', 'wrapped-or-staked name', 'no positive TVL'];
const accounting: Record<string, number> = {};
for (const b of BUCKETS) accounting[b] = 0;
const rankable: Protocol[] = [];
for (const p of snap.protocols) {
  if (!isPreToken(p)) {
    accounting['live-token'] = (accounting['live-token'] ?? 0) + 1;
    continue;
  }
  if (p.tvl_usd <= 0) {
    accounting['no positive TVL'] = (accounting['no positive TVL'] ?? 0) + 1;
    continue;
  }
  const reason = setAsideReason(p);
  if (reason !== null) {
    accounting[reason] = (accounting[reason] ?? 0) + 1;
    continue;
  }
  accounting['ranked'] = (accounting['ranked'] ?? 0) + 1;
  rankable.push(p);
}

// ---- board rows before ranking ----
interface Draft {
  p: Protocol;
  implied: number;
  curveValue: number;
  growth: number;
  maturity: number;
  age: number;
  gas: number;
  gasChain: string;
  holdDays: number;
  hours: number;
  nSteps: number;
  stepTexts: string[];
  stepMinutes: number[];
  base: ReturnType<typeof netFor>;
  cautiousNet: number;
}

const drafts: Draft[] = rankable.map((p) => {
  const r = reading(p, curve, asOfMs, true, true, null);
  const age = ageDays(p, asOfMs);
  const { chain, gas } = cheapestGas(p.chains);
  const hold = holdDaysFor(age);
  const steps = farmSteps(p, gas, chain, hold);
  const hours = steps.reduce((s, x) => s + x.minutes, 0) / 60;
  const base = netFor(r.implied, p.tvl_usd, STANDARD_CAPITAL, USER_SHARE, gas, steps.length, hold, hours);
  const cautious = netFor(r.implied, p.tvl_usd, STANDARD_CAPITAL, CAUTIOUS_SHARE, gas, steps.length, hold, hours);
  return {
    p,
    implied: r.implied,
    curveValue: Math.round(r.curve_value),
    growth: round4(r.growth_mult),
    maturity: round4(r.maturity_mult),
    age,
    gas,
    gasChain: chain,
    holdDays: hold,
    hours: round2(hours),
    nSteps: steps.length,
    stepTexts: steps.map((s) => s.text),
    stepMinutes: steps.map((s) => s.minutes),
    base,
    cautiousNet: cautious.net_usd,
  };
});
drafts.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));

// ---- bootstrap: 200 seeded refits -> rank ranges and verdict stability ----
const rng = mulberry32(987654321);
const rankSamples = new Map<string, number[]>();
const stableCount = new Map<string, number>();
for (const d of drafts) {
  rankSamples.set(d.p.slug, []);
  stableCount.set(d.p.slug, 0);
}
const DRAWS = 200;
for (let draw = 0; draw < DRAWS; draw++) {
  const sample: Protocol[] = [];
  for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rng() * comps.length)] as Protocol);
  const c = fitCurve(sample);
  const vals = drafts.map((d) => ({ slug: d.p.slug, v: reading(d.p, c, asOfMs, true, true, null).implied, d }));
  const sorted = vals.slice().sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : 1));
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i] as (typeof vals)[number];
    (rankSamples.get(row.slug) as number[]).push(i + 1);
    const n = netFor(row.v, row.d.p.tvl_usd, STANDARD_CAPITAL, USER_SHARE, row.d.gas, row.d.nSteps, row.d.holdDays, row.d.hours);
    if (n.verdict === row.d.base.verdict) stableCount.set(row.slug, (stableCount.get(row.slug) ?? 0) + 1);
  }
}

// ---- final rows ----
const rows = drafts.map((d, i) => {
  const ranks = (rankSamples.get(d.p.slug) as number[]).slice().sort((a, b) => a - b);
  const sensitivity: Record<string, Record<string, { net_usd: number; verdict: string }>> = {};
  for (const share of [0.035, 0.07, 0.14]) {
    const byCap: Record<string, { net_usd: number; verdict: string }> = {};
    for (const cap of [1000, 2500, 10000]) {
      const n = netFor(d.implied, d.p.tvl_usd, cap, share, d.gas, d.nSteps, d.holdDays, d.hours);
      byCap[String(cap)] = { net_usd: n.net_usd, verdict: n.verdict };
    }
    sensitivity[String(share)] = byCap;
  }
  return {
    slug: d.p.slug,
    name: d.p.name,
    rank: i + 1,
    implied_value_usd: d.implied,
    farm_steps: d.stepTexts,
    category: d.p.category,
    chains: d.p.chains,
    tvl_usd: d.p.tvl_usd,
    change_7d: d.p.change_7d,
    age_days: d.age,
    watchlist: watchlist.has(d.p.slug),
    band_low_usd: Math.max(1, Math.round(d.implied / bandMult)),
    band_high_usd: Math.round(d.implied * bandMult),
    rank_low: quantileSorted(ranks, 0.10),
    rank_high: quantileSorted(ranks, 0.90),
    verdict_stability_pct: round1(((stableCount.get(d.p.slug) ?? 0) / DRAWS) * 100),
    verdict: d.base.verdict,
    net_usd: d.base.net_usd,
    net_per_hour_usd: d.base.net_per_hour_usd,
    capital_usd: STANDARD_CAPITAL,
    fees_usd: d.base.fees_usd,
    hours: d.hours,
    hold_days: d.holdDays,
    curve_value_usd: d.curveValue,
    growth_mult: d.growth,
    maturity_mult: d.maturity,
    // carried fields: the dashboard recomputes nets at other plan sizes from these
    gas_usd: d.gas,
    gas_chain: d.gasChain,
    n_steps: d.nSteps,
    step_minutes: d.stepMinutes,
    pool_usd: d.base.pool_usd,
    drop_usd: d.base.drop_usd,
    opportunity_usd: d.base.opportunity_usd,
    cautious_net_usd: d.cautiousNet,
    nearest_comps: nearestComps(d.p, comps, 3),
    sensitivity,
  };
});

// ---- basket: greedy by net per dollar over FARM rows, $10,000 total ----
const farmRows = rows.filter((r) => r.verdict === 'FARM').slice().sort((a, b) => b.net_usd / b.capital_usd - a.net_usd / a.capital_usd || a.rank - b.rank);
const basketRows: Array<{ slug: string; name: string; capital_usd: number; net_usd: number; hours: number }> = [];
let remaining = 10000;
for (const r of farmRows) {
  if (remaining <= 0) break;
  const cap = Math.min(STANDARD_CAPITAL, remaining);
  const n = netFor(r.implied_value_usd, r.tvl_usd, cap, USER_SHARE, r.gas_usd, r.n_steps, r.hold_days, r.hours);
  basketRows.push({ slug: r.slug, name: r.name, capital_usd: cap, net_usd: n.net_usd, hours: r.hours });
  remaining -= cap;
}
const basket = {
  budget_usd: 10000,
  rows: basketRows,
  total_capital_usd: basketRows.reduce((s, r) => s + r.capital_usd, 0),
  total_net_usd: round2(basketRows.reduce((s, r) => s + r.net_usd, 0)),
  total_hours: round2(basketRows.reduce((s, r) => s + r.hours, 0)),
};

const totalImplied = rows.reduce((s, r) => s + r.implied_value_usd, 0);
const bestNph = rows.reduce((m, r) => Math.max(m, r.net_per_hour_usd), 0);
const verdictCounts = { FARM: 0, THIN: 0, SKIP: 0 };
for (const r of rows) verdictCounts[r.verdict as 'FARM' | 'THIN' | 'SKIP']++;

const modelBlock = {
  version: MODEL_VERSION,
  intercept: round4(curve.intercept),
  slope: round4(curve.slope),
  comps: comps.length,
  growth_rate: 0.0035,
  growth_clamp: [-50, 100],
  maturity_base: 0.82,
  maturity_span: 0.28,
  maturity_days: 1095,
  unknown_age_days: 365,
  user_share: USER_SHARE,
  cautious_share: CAUTIOUS_SHARE,
  farmed_share: 0.25,
  typical_position_usd: 250,
  yield_pct: 0.05,
  ramp_usd: 4.6,
  standard_capital_usd: STANDARD_CAPITAL,
  band_half_log10: validation.band_half_log10,
  category_factors: Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, round4(v)])),
};

const testsBlock = {
  blind: validation.blind,
  cross_validation: validation.cross_validation,
  time_split: validation.time_split,
  walk_forward: validation.walk_forward,
  baseline: validation.baseline,
  band_holds_pct: validation.band_holds_pct,
};

const data = {
  as_of: snap.as_of,
  floor_usd: snap.floor_usd,
  model: modelBlock,
  stats: {
    ranked: rows.length,
    watchlist_covered: rows.filter((r) => r.watchlist).length,
    total_implied_usd: totalImplied,
    best_net_per_hour_usd: bestNph,
    verdicts: verdictCounts,
    protocols_read: snap.protocols.length,
  },
  tests: testsBlock,
  ablation: validation.ablation,
  accounting,
  rows,
  basket,
};

// ---- write outputs ----
mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'board.json'), JSON.stringify({ as_of: snap.as_of, model: MODEL_VERSION, count: rows.length, rows }, null, 1) + '\n');
cpSync(join(root, 'dashboard'), join(output, 'dashboard'), { recursive: true });
writeFileSync(join(output, 'dashboard', 'data.js'), 'window.__RADAR__ = ' + JSON.stringify(data) + ';\n');
const shotsSrc = join(root, 'screenshots');
if (existsSync(shotsSrc)) cpSync(shotsSrc, join(output, 'screenshots'), { recursive: true });
mkdirSync(join(output, 'screenshots'), { recursive: true });
writeFileSync(join(output, 'dossier.json'), buildDossier(output, { text_max_bytes: 65536 }));

console.log(`comps=${comps.length} ranked=${rows.length} watchlist=${data.stats.watchlist_covered}/${snap.watchlist.length}`);
console.log(`curve intercept=${modelBlock.intercept} slope=${modelBlock.slope}`);
console.log(`blind x${validation.blind.median_miss} (${validation.blind.within2_pct}% within x2, n=${validation.blind.n})`);
console.log(`cv x${validation.cross_validation.median_miss} (${validation.cross_validation.within2_pct}% within x2, n=${validation.cross_validation.n})`);
console.log(`time x${validation.time_split.median_miss} (${validation.time_split.within2_pct}% within x2, n=${validation.time_split.n})`);
console.log(`walk x${validation.walk_forward.median_miss} (${validation.walk_forward.within2_pct}% within x2, n=${validation.walk_forward.n})`);
console.log(`baseline x${validation.baseline.median_miss} (${validation.baseline.within2_pct}% within x2, n=${validation.baseline.n})`);
console.log(`ablation full x${validation.ablation.full.median_miss} / growth-off x${validation.ablation.growth_off.median_miss} / maturity-off x${validation.ablation.maturity_off.median_miss} / category-on x${validation.ablation.category_on.median_miss}`);
console.log(`band half-log10=${validation.band_half_log10} holds=${validation.band_holds_pct}% verdicts FARM=${verdictCounts.FARM} THIN=${verdictCounts.THIN} SKIP=${verdictCounts.SKIP}`);
console.log(`total implied=$${totalImplied} best net/hour=$${bestNph} basket net=$${basket.total_net_usd} on $${basket.total_capital_usd}`);
