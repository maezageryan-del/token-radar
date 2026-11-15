// Launch Radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The idea, in one paragraph. The snapshot's tokenised protocols are the only honest guide to what
// a launch is worth: they are what the market actually paid for TVL like this. So the model first
// fits a size curve to them — log10(market cap) against log10(TVL), least squares, with a per-
// category correction — then reads every pre-token protocol's implied value off that curve, adjusted
// for its seven-day TVL growth and for how long it has run with no token. The fit is tested blind:
// the comps are split in two by slug, each half is priced by a curve fitted on the other half alone,
// and the dashboard states the median miss. No protocol name is ever special-cased; one function
// scores every row, and the page recomputes each row from the same figures so code and board agree.
//
// The board ranks every rankable pre-token protocol (198 on this snapshot), not a capped sample:
// the whole watchlist first by value, then the early protocols below the floor — the radar exists
// to find those early. Wrapped, staked and bridged products of tokens that already trade, exchange
// books and versioned pools of other protocols are set aside: they are not launches waiting to
// happen. Protocols whose token already trades are shown apart, at the market's own values.
//
// Each row also carries a farm plan whose last step does the maths out loud: what the plan costs
// all-in (gas on the protocol's own chain, plus the yield forgone on the capital while it is held)
// against the farmer's modelled slice if the protocol issues at its implied value — a stated share
// of the launch value going to users, divided by the airdrop-motivated share of TVL. The verdict
// (farm, thin or skip) is that subtraction, nothing else.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a wrapped or staked product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Categories that are never a launch of their own: exchange books and wrapped/bridged products. */
const NOT_A_LAUNCH = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Exchange names a wrapped product may begin with (the watchlist rule's own list). */
const EXCHANGE_HEADS = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a protocol is one the board may rank: it records no token, and it is not an exchange
 * book, a versioned pool, or a wrapped, staked or bridged product of a token that already trades.
 * The same exclusions the house's watchlist rule states, applied to the whole pre-token universe,
 * so the early rows below the floor are held to the watchlist's own standard.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && NOT_A_LAUNCH.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_HEADS.some((head) => p.name.startsWith(head))) return false;
  return true;
}

/** The model's constants, as the dashboard states them and the reader may challenge them. */
export interface ModelConstants {
  /** Per cent of a launch's implied value the model supposes goes to the protocol's users. */
  user_share_pct: number;
  /** The share of a protocol's TVL the model supposes is airdrop-motivated capital. */
  farmed_share: number;
  /** Of the user allocation, the share split evenly among qualifying wallets (the breadth half). */
  breadth_share: number;
  /** The position size the model supposes a typical farming wallet runs, for the wallet count. */
  typical_position_usd: number;
  /** Stablecoin yield forgone while farm capital is held, per cent a year. */
  yield_apr_pct: number;
  /** How hard seven-day TVL growth moves the implied value: multiplier points per growth point. */
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  /** The maturity curve: a brand-new protocol is read at maturity_floor of its curve value. */
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Category corrections are clamped to this band either way, so one thin category cannot rule. */
  category_clamp: number;
  /** A category needs at least this many tokenised peers before its correction is trusted. */
  category_min_peers: number;
}

export const MODEL: ModelConstants = {
  user_share_pct: 10,
  farmed_share: 0.25,
  breadth_share: 0.5,
  typical_position_usd: 250,
  yield_apr_pct: 5,
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.82,
  maturity_range: 0.28,
  maturity_days: 1095,
  unknown_age_days: 365,
  category_clamp: 2.2,
  category_min_peers: 6,
};

/** The model's version label: the dashboard names it and the board's rows carry it. */
export const MODEL_VERSION = 'launch-radar-2';

/**
 * Categories whose TVL is other people's assets in transit — staked or restaked for the
 * underlying chain — so the token prices a fee sliver, not the TVL. They stay off the comps set
 * (they would teach the curve that TVL is nearly worthless) but a pre-token one is still a
 * launch candidate, so the board's own exclusion list above does not name them.
 */
const PASS_THROUGH = new Set(['Restaking', 'Staking Pool']);

/**
 * A tokenised protocol the curve learns from: it trades, so its market cap is a fact. Exchange
 * tokens and bridged or wrapped assets are left out — the one prices a company, the other merely
 * tracks an underlying — pass-through staking books are left out as above, and a comp needs a
 * positive TVL and market cap to sit on a log scale.
 */
export function isComp(p: SnapshotProtocol): boolean {
  if (isPreToken(p)) return false;
  if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return false;
  if (p.category !== null && NOT_A_LAUNCH.has(p.category)) return false;
  if (p.category !== null && PASS_THROUGH.has(p.category)) return false;
  return true;
}

/** A fitted size curve: log10(market cap) = intercept + slope x log10(TVL), plus category factors. */
export interface SizeCurve {
  intercept: number;
  slope: number;
  /** Category -> multiplier on the curve's value, from the median miss of that category's comps. */
  category_factors: Record<string, number>;
  comps: number;
  /** The median market-cap-to-TVL ratio across the comps, for the reader's orientation. */
  median_ratio: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Least squares of log10(mcap) on log10(tvl) over the given comps. */
function fitLine(comps: SnapshotProtocol[]): { intercept: number; slope: number } {
  const n = comps.length;
  let mx = 0;
  let my = 0;
  for (const p of comps) {
    mx += Math.log10(p.tvl_usd);
    my += Math.log10(p.mcap_usd!);
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  for (const p of comps) {
    const dx = Math.log10(p.tvl_usd) - mx;
    sxy += dx * (Math.log10(p.mcap_usd!) - my);
    sxx += dx * dx;
  }
  const slope = sxx > 0 ? sxy / sxx : 1;
  return { intercept: my - slope * mx, slope };
}

/** The curve's raw value for a TVL, before the category correction. */
function curveValue(curve: { intercept: number; slope: number }, tvl: number): number {
  return Math.pow(10, curve.intercept + curve.slope * Math.log10(Math.max(1, tvl)));
}

/**
 * Fit the size curve to the snapshot's tokenised protocols. The category factor of a category is
 * the median ratio of its comps' real market caps to the plain curve's reading, clamped; a
 * category with too few peers keeps a factor of 1, so thin evidence moves nothing.
 */
export function fitCurve(comps: SnapshotProtocol[], model: ModelConstants = MODEL): SizeCurve {
  const line = fitLine(comps);
  const byCategory = new Map<string, number[]>();
  for (const p of comps) {
    const key = p.category ?? 'Uncategorised';
    const ratio = p.mcap_usd! / curveValue(line, p.tvl_usd);
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const factors: Record<string, number> = {};
  for (const [key, ratios] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (ratios.length < model.category_min_peers) continue;
    const sorted = [...ratios].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    factors[key] = round4(clamp(median, 1 / model.category_clamp, model.category_clamp));
  }
  const ratios = comps.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  return {
    intercept: round4(line.intercept),
    slope: round4(line.slope),
    category_factors: factors,
    comps: comps.length,
    median_ratio: round4(ratios[Math.floor(ratios.length / 2)]!),
  };
}

/** The blind test's verdict: how far the curve's blind readings land from real market caps. */
export interface BlindTest {
  tested: number;
  /** Median miss as a multiple: half the blind readings land within this factor of the truth. */
  median_multiple: number;
  /** The share of blind readings within a factor of two of the real market cap, in per cent. */
  within_2x_pct: number;
}

/**
 * Test the curve blind. The comps are split in two by the parity of their slug's character sum —
 * a split nothing about their value can influence — each half is priced by a curve fitted on the
 * other half alone, and the misses are gathered. This is the honesty check the dashboard quotes:
 * the same machinery that prices protocols with no token is first made to price tokens whose real
 * value it was not allowed to see.
 */
export function blindTest(comps: SnapshotProtocol[], model: ModelConstants = MODEL): BlindTest {
  const halves: [SnapshotProtocol[], SnapshotProtocol[]] = [[], []];
  for (const p of comps) {
    let sum = 0;
    for (let i = 0; i < p.slug.length; i++) sum += p.slug.charCodeAt(i);
    halves[sum % 2].push(p);
  }
  const misses: number[] = [];
  let within = 0;
  for (const side of [0, 1] as const) {
    const fitOn = halves[1 - side];
    const testOn = halves[side];
    if (fitOn.length < 10 || testOn.length === 0) continue;
    const curve = fitCurve(fitOn, model);
    for (const p of testOn) {
      const predicted = curveValue(curve, p.tvl_usd) * (curve.category_factors[p.category ?? 'Uncategorised'] ?? 1);
      const multiple = Math.max(predicted, p.mcap_usd!) / Math.min(predicted, p.mcap_usd!);
      misses.push(multiple);
      if (multiple <= 2) within++;
    }
  }
  misses.sort((a, b) => a - b);
  return {
    tested: misses.length,
    median_multiple: misses.length > 0 ? Math.round(misses[Math.floor(misses.length / 2)]! * 100) / 100 : 0,
    within_2x_pct: misses.length > 0 ? Math.round((within / misses.length) * 1000) / 10 : 0,
  };
}

/** One protocol's reading: the curve value and every adjustment that turns it into an implied value. */
export interface Reading {
  implied: number;
  curve_value: number;
  category_factor: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age: number | null;
}

/**
 * Read one pre-token protocol's implied value off the curve: the curve's value for its TVL and
 * category, moved by its seven-day growth (a rising protocol is worth more than a shrinking one of
 * the same size) and by its maturity (a protocol that has run for years with no token has proved
 * it can hold value; a new one is read at a discount until it has).
 */
export function impliedValue(p: SnapshotProtocol, asOf: string, curve: SizeCurve, model: ModelConstants = MODEL): Reading {
  const age = ageDays(asOf, p.listed_at);
  const base = curveValue(curve, p.tvl_usd);
  const categoryFactor = curve.category_factors[p.category ?? 'Uncategorised'] ?? 1;
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(base * categoryFactor * growthMult * maturityMult));
  return {
    implied,
    curve_value: Math.round(base),
    category_factor: categoryFactor,
    growth_pct: growthPct,
    growth_multiplier: round4(growthMult),
    maturity_multiplier: round4(maturityMult),
    age,
  };
}

/** What one transaction costs on a chain, in dollars: the model's stated gas table. */
const GAS_USD: Record<string, number> = {
  Ethereum: 14, Tron: 1.2, Solana: 0.6, Binance: 1.5, BNB: 1.5, Base: 1.1, Arbitrum: 1.1,
  Optimism: 1.1, Polygon: 0.8, Avalanche: 1.4, Fantom: 0.7, Gnosis: 0.5, zkSync: 1.0,
  Linea: 1.0, Scroll: 1.0, Mantle: 0.8, Blast: 1.0, Mode: 0.8, Sui: 0.5, Aptos: 0.5,
  Near: 0.5, Cosmos: 0.5, Stellar: 0.3, Bittensor: 1.0, Ink: 1.0, Sonic: 0.7,
};

/**
 * The gas of one transaction for this protocol: the cheapest chain it runs on, from the table —
 * a farmer farms a multi-chain protocol where it is cheap, not where it is dear. $3 where the
 * table names none of its chains.
 */
export function gasFor(p: SnapshotProtocol): number {
  if (p.chains.length === 0) return 3;
  return Math.min(...p.chains.map((c) => GAS_USD[c] ?? 3));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 350;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 150;
  return 100;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A farm plan's economics, worked out loud: the slice if it launches, the all-in cost, the net. */
export interface FarmEconomics {
  capital_usd: number;
  hold_days: number;
  weeks: number;
  gas_usd: number;
  yield_forgone_usd: number;
  cost_usd: number;
  /** The farmer's slice if the protocol issues at its implied value, under the model's shares. */
  slice_usd: number;
  net_usd: number;
  verdict: 'farm' | 'thin' | 'skip';
}

/**
 * The netting every plan ends with. The slice supposes three stated things: that a launch hands
 * user_share_pct of its implied value to the protocol's users; that the capital competing for it
 * is farmed_share of TVL, held by wallets of about typical_position_usd each; and that the user
 * allocation is split the way points programs usually split it — breadth_share of it evenly
 * among the qualifying wallets, the rest pro-rata to farmed capital. The breadth half is why a
 * small wallet in a small protocol can clear its costs while the same wallet in a giant cannot:
 * its slice there is a rounding error, and the plan says so. The cost is gas — three transactions
 * to set up, one a week while held, at the cheapest chain the protocol runs on — plus the
 * stablecoin yield the capital would have earned elsewhere. Net decides the verdict: at least
 * $20 clear is a farm, anything above water is thin, under water is a skip.
 */
export function farmEconomics(p: SnapshotProtocol, implied: number, age: number | null, model: ModelConstants = MODEL): FarmEconomics {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const gas = Math.round((3 + weeks) * gasFor(p) * 100) / 100;
  const yieldForgone = Math.round(capital * (model.yield_apr_pct / 100) * (hold / 365) * 100) / 100;
  const cost = Math.round((gas + yieldForgone) * 100) / 100;
  const farmedPool = Math.max(p.tvl_usd * model.farmed_share, capital);
  const wallets = Math.max(50, Math.round(farmedPool / model.typical_position_usd));
  const userPool = implied * (model.user_share_pct / 100);
  const slice = Math.round(userPool * (model.breadth_share / wallets + (1 - model.breadth_share) * (capital / farmedPool)) * 100) / 100;
  const net = Math.round((slice - cost) * 100) / 100;
  const verdict = net >= 20 ? 'farm' : net > 0 ? 'thin' : 'skip';
  return { capital_usd: capital, hold_days: hold, weeks, gas_usd: gas, yield_forgone_usd: yieldForgone, cost_usd: cost, slice_usd: slice, net_usd: net, verdict };
}

const money = (n: number): string => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator') || c.includes('collateral market')) return `Deposit $${capital} into a ${name} vault on ${chain} — pick the vault whose assets you would hold anyway — and keep the vault shares in the wallet.`;
  if (c.includes('lend') || c.includes('cdp')) return `Supply $${capital} of USDC to ${name} on ${chain} as collateral and leave the position open; borrowing is the second step, not this one.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s busiest stable or major pair on ${chain} and keep the LP position open.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('interest rate')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade so the account registers real volume.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in one app on the far side.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield asset on ${chain} through its own app and hold the asset in the wallet.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it rather than swapping out.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one position in a liquid market on ${name}, sized so you can hold it to settlement.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold, and keep the policy to expiry.`;
  if (c.includes('basis')) return `Open ${name}'s basis position with $${capital} on ${chain}: the spot leg and the hedge together, exactly as its app pairs them.`;
  if (c.includes('index')) return `Buy $${capital} of a ${name} index basket on ${chain} and hold it; the basket is the position.`;
  if (c.includes('payment') || c.includes('card')) return `Fund $${capital} through ${name} and route one real payment or card spend a week through it.`;
  if (c.includes('leveraged farm') || c.includes('farm')) return `Open a $${capital} leveraged farm on ${name}'s main pair on ${chain} at the lowest leverage it offers, and keep it open.`;
  if (c.includes('yield')) return `Deposit $${capital} into ${name}'s main vault on ${chain} and keep the shares; do not chase the highest-APR vault.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's asset through ${name} on ${chain} and keep the staking receipt in the wallet.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${chain} and hold it there; a young chain counts wallets that hold and transact, not visitors.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open.`;
}

/** The category's second action: the depth signal that separates a farmer from a drive-by. */
function depthFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Borrow a small amount against the collateral — under a third of its value — and repay it once, so the account shows both sides of ${name}.`;
  if (c.includes('dex')) return `Make two swaps through ${name}'s own interface on ${chain} in separate weeks; routed volume through the app is the signal most points programs count.`;
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('yield')) return `Split the position across two of ${name}'s vaults rather than one: curators count distinct vault holders when they report their numbers.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Trade in two separate weeks and close one position fully, so the account shows realised activity and not one open-and-forget ticket.`;
  if (c.includes('rwa') || c.includes('stable')) return `Hold the minted asset across a month boundary and make one small second mint, so the balance is not a single day's spike.`;
  if (c.includes('chain')) return `Use two native apps on ${chain} with the bridged funds — one swap and one deposit — so the wallet reads as a resident, not a tourist.`;
  return `Repeat ${name}'s core action once in a later week from the same wallet; a second, separate week of activity is the cheapest depth signal there is.`;
}

/** A step as one string within the gate's 20..600 characters, trimmed to fit if it runs long. */
function stepText(s: string): string {
  let out = s.trim();
  if (out.length > 600) out = `${out.slice(0, 596)}...`;
  if (out.length < 20) out = `${out} Hold the position and re-check the protocol's own page.`;
  return out;
}

/**
 * A protocol's farm plan: seven steps, each an action with its cost and its time, and the last
 * one the netting itself — the modelled slice against the all-in cost, and the verdict that
 * subtraction gives. Derived from the protocol's own record (category, chains, TVL, age) and its
 * reading; never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, reading: Reading, econ: FarmEconomics, model: ModelConstants = MODEL): string[] {
  const chain = chainOf(p);
  const gas = gasFor(p);
  const verdictWord = econ.verdict === 'farm' ? 'FARM' : econ.verdict === 'thin' ? 'THIN' : 'SKIP';
  return [
    `Set up a fresh wallet that holds only the funds you plan to farm, seed phrase offline, and fund it on ${chain}. Cost: about ${money(gas)} of gas for the first transaction. Time: 10 minutes.`,
    `${actionFor(p, econ.capital_usd, chain)} Cost: $${econ.capital_usd} of capital plus about ${money(gas * 2)} of gas for the deposit transactions. Time: 20 minutes.`,
    `${depthFor(p, chain)} Cost: about ${money(gas)} of gas. Time: 15 minutes, in a later week than the first deposit.`,
    `Make one qualifying action a week — a deposit, a swap, a vote or a claim — for ${econ.weeks} weeks, always from the same wallet. Cost: about ${money(gas)} of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${econ.hold_days} days so the activity spans more than one snapshot of the protocol's books. Cost: the $${econ.capital_usd} stays in, forgoing about ${money(econ.yield_forgone_usd)} of stablecoin yield at ${model.yield_apr_pct}% a year. Time: ${econ.hold_days} days.`,
    `Open the protocol's own points or rewards page and claim only from the link it publishes; a launch never charges a claim fee. Cost: nothing to check, and never pay to claim. Time: 10 minutes.`,
    `The maths, out loud: if ${p.name} issues at the board's implied value and hands ${model.user_share_pct}% of it to users — half split evenly among qualifying wallets, half pro-rata to farmed capital — a $${econ.capital_usd} position's slice is about ${money(econ.slice_usd)} against ${money(econ.cost_usd)} of all-in cost, net ${money(econ.net_usd)}. Verdict: ${verdictWord}.`,
  ].map(stepText);
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    curve_value_usd: number;
    category_factor: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm: FarmEconomics;
  farm_steps: string[];
}

/** The dashboard's view of one row: the figures, the reading and the verdict, in one line each. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  curve_value_usd: number;
  category_factor: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  verdict: 'farm' | 'thin' | 'skip';
  capital_usd: number;
  cost_usd: number;
  slice_usd: number;
  net_usd: number;
  steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 32;

/** Everything the dashboard needs: the board, the live set, the curve it was read off, its blind test. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  curve: SizeCurve;
  blind: BlindTest;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  verdict_counts: { farm: number; thin: number; skip: number };
  rows: RadarRow[];
  live: LiveRow[];
}

/**
 * The board itself: every rankable pre-token protocol, the watchlist guaranteed a place, read off
 * the fitted curve and ranked by implied value. Ranks are 1..N and values never rise as rank
 * ascends; equal values are ordered by TVL, then slug, so two runs write the same bytes.
 */
export function buildBoard(snapshot: Snapshot, curve: SizeCurve, model: ModelConstants = MODEL): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => {
    const reading = impliedValue(p, snapshot.as_of, curve, model);
    const econ = farmEconomics(p, reading.implied, reading.age, model);
    return { p, reading, econ };
  });
  scored.sort((a, b) =>
    b.reading.implied - a.reading.implied ||
    b.p.tvl_usd - a.p.tvl_usd ||
    (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watch.has(s.p.slug),
    age_days: s.reading.age,
    implied_value_usd: s.reading.implied,
    model: {
      curve_value_usd: s.reading.curve_value,
      category_factor: s.reading.category_factor,
      growth_pct: s.reading.growth_pct,
      growth_multiplier: s.reading.growth_multiplier,
      maturity_multiplier: s.reading.maturity_multiplier,
      age_days: s.reading.age,
    },
    farm: s.econ,
    farm_steps: farmSteps(s.p, s.reading, s.econ, model),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** A board row's dashboard form: the page renders the plan from the same steps board.json carries. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    on_watchlist: row.on_watchlist,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    curve_value_usd: row.model.curve_value_usd,
    category_factor: row.model.category_factor,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    verdict: row.farm.verdict,
    capital_usd: row.farm.capital_usd,
    cost_usd: row.farm.cost_usd,
    slice_usd: row.farm.slice_usd,
    net_usd: row.farm.net_usd,
    steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot: fit the curve, test it blind, build the board. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const comps = snapshot.protocols.filter(isComp);
  const curve = fitCurve(comps, model);
  const blind = blindTest(comps, model);
  const board = buildBoard(snapshot, curve, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const counts = { farm: 0, thin: 0, skip: 0 };
  for (const r of board) counts[r.farm.verdict]++;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    curve,
    blind,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    verdict_counts: counts,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears on the board twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const invented = board.filter((r) => !known.has(r.slug));
  if (invented.length > 0) return `the board invents slugs the snapshot does not list: ${invented.slice(0, 5).map((r) => r.slug).join(', ')}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
