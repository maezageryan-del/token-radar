// Launch Radar model — everything is fitted at runtime from the snapshot.
// No per-protocol values are hardcoded; the only constants are the stated
// reading, netting and gas parameters below.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Curve {
  intercept: number;
  slope: number;
}

export interface TestResult {
  median_miss: number;
  within2_pct: number;
  n: number;
}

export interface FarmStep {
  text: string;
  minutes: number;
}

export interface NetResult {
  pool_usd: number;
  drop_usd: number;
  fees_usd: number;
  opportunity_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  verdict: string;
}

export const MODEL_VERSION = 'launch-radar-7';
export const STANDARD_CAPITAL = 2500;
export const USER_SHARE = 0.10;
export const CAUTIOUS_SHARE = 0.05;
export const FARMED_SHARE = 0.25;
export const TYPICAL_POSITION = 250;
export const YIELD_PCT = 0.05;
export const RAMP_USD = 4.60;
export const GROWTH_RATE = 0.0035;
export const MATURITY_BASE = 0.82;
export const MATURITY_SPAN = 0.28;
export const MATURITY_DAYS = 1095;
export const UNKNOWN_AGE_DAYS = 365;

const GAS_USD: Record<string, number> = {
  'Ethereum': 12,
  'BNB Chain': 1.2,
  'Binance': 1.2,
  'Solana': 0.4,
  'Base': 0.8,
  'Arbitrum': 0.9,
  'Avalanche': 0.7,
  'Polygon': 0.5,
  'Tron': 1.0,
  'Sui': 0.5,
};
export const DEFAULT_GAS_USD = 2.0;

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function isPreToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

// Why a protocol is not a stand-alone comparable/board candidate, or null when it is.
export function setAsideReason(p: Protocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) {
    if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 'bridge';
    if (p.category === 'CEX') return 'exchange custody';
    return 'liquid staking or restaking';
  }
  if (/\s+(?:[Vv]\d+(?:\.\d+)?|\d+\.\d+)$/.test(p.name)) return 'versioned release';
  if (/\b(?:wrapped|staked|staking)\b/i.test(p.name)) return 'wrapped-or-staked name';
  for (const ex of EXCHANGE_PREFIXES) {
    if (p.name === ex || p.name.startsWith(ex + ' ')) return 'exchange custody';
  }
  return null;
}

export function isStandalone(p: Protocol): boolean {
  return setAsideReason(p) === null;
}

export function selectComps(protocols: Protocol[]): Protocol[] {
  return protocols.filter(
    (p) => !isPreToken(p) && (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0 && isStandalone(p),
  );
}

export function ageDays(p: Protocol, asOfMs: number): number {
  if (p.listed_at === null) return UNKNOWN_AGE_DAYS;
  const listed = Date.parse(p.listed_at + 'T00:00:00Z');
  if (Number.isNaN(listed)) return UNKNOWN_AGE_DAYS;
  return Math.round((asOfMs - listed) / 86400000);
}

export function fitCurve(comps: Protocol[]): Curve {
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  const n = comps.length;
  for (const p of comps) {
    const x = Math.log10(p.tvl_usd);
    const y = Math.log10(p.mcap_usd as number);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;
  return { intercept, slope };
}

export function curveValue(curve: Curve, tvl: number): number {
  return Math.pow(10, curve.intercept + curve.slope * Math.log10(tvl));
}

export function growthMult(change7d: number | null): number {
  const c = Math.max(-50, Math.min(100, change7d ?? 0));
  return 1 + c * GROWTH_RATE;
}

export function maturityMult(age: number): number {
  return MATURITY_BASE + MATURITY_SPAN * (Math.min(age, MATURITY_DAYS) / MATURITY_DAYS);
}

// Per-category median of actual mcap over the plain curve reading, for
// categories with at least 6 comps, clamped to [1/2.2, 2.2]. Measured and
// reported; the blind tests say it earns nothing, so it is never applied.
export function categoryFactors(comps: Protocol[], curve: Curve): Record<string, number> {
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    if (p.category === null) continue;
    const ratio = (p.mcap_usd as number) / curveValue(curve, p.tvl_usd);
    const arr = byCat.get(p.category);
    if (arr) arr.push(ratio);
    else byCat.set(p.category, [ratio]);
  }
  const out: Record<string, number> = {};
  const cats = [...byCat.keys()].sort();
  for (const cat of cats) {
    const arr = (byCat.get(cat) as number[]).slice().sort((a, b) => a - b);
    if (arr.length >= 6) {
      const med = medianSorted(arr);
      out[cat] = Math.max(1 / 2.2, Math.min(2.2, med));
    }
  }
  return out;
}

export interface ReadingParts {
  curve_value: number;
  growth_mult: number;
  maturity_mult: number;
  implied: number;
}

export function reading(
  p: Protocol,
  curve: Curve,
  asOfMs: number,
  useGrowth: boolean,
  useMaturity: boolean,
  factors: Record<string, number> | null,
): ReadingParts {
  const cv = curveValue(curve, p.tvl_usd);
  const g = useGrowth ? growthMult(p.change_7d) : 1;
  const age = ageDays(p, asOfMs);
  const m = useMaturity ? maturityMult(age) : 1;
  let v = cv * g * m;
  if (factors !== null && p.category !== null) v *= factors[p.category] ?? 1;
  return {
    curve_value: cv,
    growth_mult: g,
    maturity_mult: m,
    implied: Math.max(1, Math.round(v)),
  };
}

// Stable slug hash (polynomial, Java-style) — deterministic across runs and
// machines; used for every fold/split assignment.
export function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (Math.imul(h, 31) + slug.charCodeAt(i)) >>> 0;
  return h;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function medianSorted(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx] as number;
}

function missOf(pred: number, actual: number): number {
  return Math.max(pred / actual, actual / pred);
}

export function summarize(preds: Array<[number, number]>): TestResult {
  const misses = preds.map(([pr, ac]) => missOf(pr, ac)).sort((a, b) => a - b);
  const within = preds.filter(([pr, ac]) => missOf(pr, ac) <= 2).length;
  return {
    median_miss: round3(medianSorted(misses)),
    within2_pct: round1((within / preds.length) * 100),
    n: preds.length,
  };
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
export function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
export function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function foldPreds(
  comps: Protocol[],
  k: number,
  asOfMs: number,
  mode: 'full' | 'noGrowth' | 'noMaturity' | 'withCategory' | 'baseline',
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let f = 0; f < k; f++) {
    const train = comps.filter((p) => slugHash(p.slug) % k !== f);
    const test = comps.filter((p) => slugHash(p.slug) % k === f);
    if (mode === 'baseline') {
      const ratios = train.map((p) => (p.mcap_usd as number) / p.tvl_usd).sort((a, b) => a - b);
      const mult = medianSorted(ratios);
      for (const p of test) out.push([mult * p.tvl_usd, p.mcap_usd as number]);
      continue;
    }
    const curve = fitCurve(train);
    const factors = mode === 'withCategory' ? categoryFactors(train, curve) : null;
    for (const p of test) {
      const r = reading(p, curve, asOfMs, mode !== 'noGrowth', mode !== 'noMaturity', factors);
      out.push([r.implied, p.mcap_usd as number]);
    }
  }
  return out;
}

export interface Validation {
  blind: TestResult;
  cross_validation: TestResult;
  time_split: TestResult;
  walk_forward: TestResult;
  baseline: TestResult;
  ablation: {
    full: TestResult;
    growth_off: TestResult;
    maturity_off: TestResult;
    category_on: TestResult;
  };
  band_half_log10: number;
  band_holds_pct: number;
}

export function runValidation(comps: Protocol[], asOfMs: number): Validation {
  // (a) blind two-fold: each half priced by a curve fitted on the other half.
  const halfA = comps.filter((p) => slugHash(p.slug) % 2 === 0);
  const halfB = comps.filter((p) => slugHash(p.slug) % 2 === 1);
  const curveA = fitCurve(halfA);
  const curveB = fitCurve(halfB);
  const blindPreds: Array<[number, number]> = [];
  for (const p of halfA) blindPreds.push([reading(p, curveB, asOfMs, true, true, null).implied, p.mcap_usd as number]);
  for (const p of halfB) blindPreds.push([reading(p, curveA, asOfMs, true, true, null).implied, p.mcap_usd as number]);

  // (b) 5-fold cross-validation of the full reading; pooled preds also set the band.
  const cvPreds = foldPreds(comps, 5, asOfMs, 'full');
  const absLog = cvPreds.map(([pr, ac]) => Math.abs(Math.log10(pr / ac))).sort((a, b) => a - b);
  const half = quantileSorted(absLog, 0.75);
  const holds = absLog.filter((x) => x <= half).length;

  // (c) time split: fit on the older half by listed_at, price the newer half.
  const dated = comps
    .filter((p) => p.listed_at !== null)
    .slice()
    .sort((a, b) => (a.listed_at as string) < (b.listed_at as string) ? -1 : a.listed_at === b.listed_at ? (a.slug < b.slug ? -1 : 1) : 1);
  const cut = Math.floor(dated.length / 2);
  const timeCurve = fitCurve(dated.slice(0, cut));
  const timePreds = dated
    .slice(cut)
    .map((p) => [reading(p, timeCurve, asOfMs, true, true, null).implied, p.mcap_usd as number] as [number, number]);

  // (d) walk-forward: expanding windows over dated comps, five test slices of ~15%.
  const slice = Math.max(1, Math.floor(dated.length * 0.15));
  let start = dated.length - 5 * slice;
  if (start < 5) start = Math.max(1, Math.floor(dated.length * 0.25));
  const wfPreds: Array<[number, number]> = [];
  for (let w = 0; w < 5; w++) {
    const train = dated.slice(0, start + w * slice);
    const test = dated.slice(start + w * slice, start + (w + 1) * slice);
    if (test.length === 0 || train.length < 3) continue;
    const c = fitCurve(train);
    for (const p of test) wfPreds.push([reading(p, c, asOfMs, true, true, null).implied, p.mcap_usd as number]);
  }

  return {
    blind: summarize(blindPreds),
    cross_validation: summarize(cvPreds),
    time_split: summarize(timePreds),
    walk_forward: summarize(wfPreds),
    baseline: summarize(foldPreds(comps, 5, asOfMs, 'baseline')),
    ablation: {
      full: summarize(cvPreds),
      growth_off: summarize(foldPreds(comps, 5, asOfMs, 'noGrowth')),
      maturity_off: summarize(foldPreds(comps, 5, asOfMs, 'noMaturity')),
      category_on: summarize(foldPreds(comps, 5, asOfMs, 'withCategory')),
    },
    band_half_log10: round4(half),
    band_holds_pct: round1((holds / absLog.length) * 100),
  };
}

export function cheapestGas(chains: string[]): { chain: string; gas: number } {
  let bestChain = chains[0] ?? 'Ethereum';
  let bestGas = Number.POSITIVE_INFINITY;
  for (const ch of chains) {
    const g = GAS_USD[ch] ?? DEFAULT_GAS_USD;
    if (g < bestGas) {
      bestGas = g;
      bestChain = ch;
    }
  }
  if (!Number.isFinite(bestGas)) bestGas = DEFAULT_GAS_USD;
  return { chain: bestChain, gas: bestGas };
}

export function holdDaysFor(age: number): number {
  return Math.max(90, Math.min(730, 730 - Math.floor(age / 2)));
}

// The single netting function used for the board, the cautious scenario, the
// sensitivity matrix, the bootstrap verdicts and the dashboard recompute.
export function netFor(
  implied: number,
  tvl: number,
  capital: number,
  share: number,
  gas: number,
  nSteps: number,
  holdDays: number,
  hours: number,
): NetResult {
  const pool = share * implied;
  const farmed = FARMED_SHARE * tvl;
  const wallets = farmed / TYPICAL_POSITION;
  const drop = pool * (0.5 / wallets + 0.5 * (capital / farmed));
  const fees = nSteps * gas + RAMP_USD;
  const opportunity = capital * YIELD_PCT * (holdDays / 365);
  const net = drop - fees - opportunity;
  return {
    pool_usd: round2(pool),
    drop_usd: round2(drop),
    fees_usd: round2(fees),
    opportunity_usd: round2(opportunity),
    net_usd: round2(net),
    net_per_hour_usd: round2(net / hours),
    verdict: net >= 25 ? 'FARM' : net > 0 ? 'THIN' : 'SKIP',
  };
}

const CATEGORY_ACTIONS: Record<string, string[]> = {
  Dexs: [
    'Swap both directions in the main pool: trade half the position into the paired asset, then trade it back over two sessions so the volume is real use, not a wash loop.',
    'Add the remaining position as concentrated liquidity in the busiest fee tier and leave it in range; screenshot the position so the receipt token is provable later.',
  ],
  Lending: [
    'Supply the full position to the main lending market, then borrow about 40% against it and re-supply the borrowed asset once — one loop only, health factor kept above 2.0.',
  ],
  CDP: [
    'Open a vault, deposit the position as collateral at under 50% of the liquidation ratio, and mint a small amount of the stablecoin so the vault shows real use.',
  ],
  RWA: [
    'Subscribe to the vault or asset with the full position and complete the allowlist or attestation step the issuer asks for; keep the subscription receipt.',
  ],
  Derivatives: [
    'Post the position as margin and run hedged trades: open a small long and an offsetting short on different venues so the account shows volume without directional risk.',
  ],
  Yield: [
    'Deposit the full position into the main vault and keep the vault share token in the same wallet; do not route it through a second aggregator.',
  ],
  'Yield Aggregator': [
    'Deposit the full position into the highest-TVL vault and keep the vault share token in the same wallet for the whole hold.',
  ],
};

function money(x: number): string {
  return '$' + x.toFixed(2);
}

export function farmSteps(p: Protocol, gas: number, gasChain: string, holdDays: number): FarmStep[] {
  const cat = p.category ?? 'protocol';
  const weeks = Math.max(1, Math.round(holdDays / 7));
  const steps: FarmStep[] = [];
  steps.push({
    text: `Check eligibility on the ${p.name} app and any points page: confirm one wallet can join without KYC, a referral gate or a minimum above the plan. Cost about ${money(gas)} in fees. Time 15 minutes.`,
    minutes: 15,
  });
  steps.push({
    text: `Fund the wallet on ${gasChain}, the cheapest chain ${p.name} lists: bridge or withdraw the plan capital there and keep a small gas buffer in the native token. Cost about ${money(gas + RAMP_USD / 2)} in fees. Time 20 minutes.`,
    minutes: 20,
  });
  const actions = CATEGORY_ACTIONS[p.category ?? ''] ?? [
    `Deposit the position into the core ${cat} product of ${p.name} and use it once the way a normal user would — one real deposit and one real interaction, no looping.`,
  ];
  for (const a of actions) {
    steps.push({ text: `${a} Cost about ${money(gas * 2)} in fees. Time 30 minutes.`, minutes: 30 });
  }
  steps.push({
    text: `Keep every receipt or share token in the funding wallet and record the transaction hashes; moving receipt tokens to a fresh wallet is the most common way a drop is lost. Cost about ${money(gas)} in fees. Time 10 minutes.`,
    minutes: 10,
  });
  steps.push({
    text: `Repeat one small real action each week for the ${weeks}-week hold — a swap, a supply top-up or a claim — so the wallet reads as an active user, not a one-day farm. Cost about ${money(gas)} in fees per week. Time 10 minutes a week.`,
    minutes: weeks * 10,
  });
  steps.push({
    text: `Review the position on a fixed date ${holdDays} days out: check the ${p.name} announcements, any snapshot or points-freeze notice, and this radar's updated TVL before adding or removing capital. Cost about ${money(0)} in fees. Time 30 minutes.`,
    minutes: 30,
  });
  steps.push({
    text: `Exit rule: if ${p.name} TVL falls more than 35% from the entry reading, or a token launches to a different wallet set, withdraw within a week instead of waiting for the full hold. Cost about ${money(gas * 2)} in fees. Time 25 minutes.`,
    minutes: 25,
  });
  steps.push({
    text: `Keep a dated log of every step — date, action, hash, fee paid — in one file; if a drop is disputed or a claim window opens, the log is the proof of use. Cost about ${money(0)} in fees. Time 20 minutes.`,
    minutes: 20,
  });
  return steps;
}

export function nearestComps(p: Protocol, comps: Protocol[], k: number): Array<{ name: string; slug: string; tvl_usd: number; mcap_usd: number }> {
  const target = Math.log10(p.tvl_usd);
  return comps
    .map((c) => ({ c, d: Math.abs(Math.log10(c.tvl_usd) - target) }))
    .sort((a, b) => a.d - b.d || (a.c.slug < b.c.slug ? -1 : 1))
    .slice(0, k)
    .map(({ c }) => ({ name: c.name, slug: c.slug, tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd as number }));
}
