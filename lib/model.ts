// Token Radar's model, version radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds every
// pre-token protocol below the watchlist floor that passes the same launch-plausibility rule the
// watchlist uses: it records no token, and it is not a wrapped, staked or bridged product of a token
// that already trades, not a versioned pool, and not an exchange's own product. Protocols above the
// floor that the watchlist leaves out are left out too: the snapshot carries no parent-protocol field,
// so the watchlist is the only record of which of those are a parent's arm, and the board does not
// second-guess it. A protocol is pre-token when its record carries no token (no market cap, no
// CoinGecko id, no symbol); the snapshot's live-token protocols are kept apart and shown with the
// market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, and no protocol name is ever
// special-cased: the same function scores every row.
//
//   category multiple = the median market-cap-to-TVL ratio of the live-token protocols in the same
//                       category (at least 3 of them), else the median over all live-token protocols,
//                       clamped to [0.05, 0.80]. The market itself prices each sector; the radar
//                       reads the price off the snapshot instead of inventing one.
//   base              = tvl_usd x category multiple
//   growth            = clamp(change_7d, -40, 80) per cent
//   growth multiplier = 1 + (growth / 100) x 0.75
//   maturity          = 0.70 + min(age_days, 1460) / 1460 x 0.50   (age unknown: 365 days)
//   chains            = 1 + min(chains, 8) x 0.02
//   implied           = max(1, round(base x growth x maturity x chains))
//
// Rows are sorted by implied value, then TVL, then slug, and a one-dollar tie-break keeps the values
// strictly falling down the ranks, so the board is a ranking in fact as well as in name.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max: number;
  cat_mult_floor: number;
  cat_mult_cap: number;
  min_live_comps: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.75,
  growth_floor: -40,
  growth_cap: 80,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_days: 1460,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_max: 8,
  cat_mult_floor: 0.05,
  cat_mult_cap: 0.8,
  min_live_comps: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Already trading view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
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
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    live_comps: number;
    live_median: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the page builds the farm plan from the same fields. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  /** Full precision: the page recomputes the implied value from this, so it must not be rounded. */
  category_multiple: number;
  live_comps: number;
  /** Full precision: the raw median the multiple was clamped from. */
  live_median: number;
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
  mcap_tvl: number | null;
}

/** One category's live-token comparables: how many, and their median market-cap-to-TVL ratio. */
export interface CategoryComp {
  n: number;
  median: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  median_implied_usd: number;
  global_median: number;
  comps: Record<string, CategoryComp>;
  rows: RadarRow[];
  live: LiveRow[];
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

/** The median of a non-empty list, else `fallback`. */
function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a product's name must not begin with. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word `wrapped`, `staked` or `staking` anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Whether a protocol could plausibly launch a token of its own: pre-token, not a wrapped, staked or
 * bridged product, not a versioned pool, and not an exchange's own product. The same rule the
 * watchlist was built with, minus the TVL floor and the parent-protocol record the snapshot does not
 * carry.
 */
export function isLaunchable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !WRAPPED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/**
 * The market's own pricing per category: for every category with at least `min_live_comps`
 * live-token protocols, the median of their market-cap-to-TVL ratios; plus the global median over
 * every live-token protocol, the fallback for thin categories. Computed from the snapshot, never
 * written in by hand.
 */
export function categoryComps(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, CategoryComp>; globalMedian: number } {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const globalMedian = median(live.map((p) => p.mcap_usd! / p.tvl_usd), 0.2);
  const byCategory = new Map<string, CategoryComp>();
  const grouped = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? '(no category)';
    const list = grouped.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    grouped.set(key, list);
  }
  for (const [key, ratios] of grouped) {
    if (ratios.length >= model.min_live_comps) {
      byCategory.set(key, { n: ratios.length, median: median(ratios, globalMedian) });
    }
  }
  return { byCategory, globalMedian };
}

/** The category multiple a protocol gets: its category's median, or the global median when thin. */
export function categoryMultiple(
  p: SnapshotProtocol,
  comps: { byCategory: Map<string, CategoryComp>; globalMedian: number },
  model: ModelConstants = MODEL,
): { multiple: number; liveComps: number; liveMedian: number } {
  const comp = comps.byCategory.get(p.category ?? '(no category)');
  const raw = comp !== undefined ? comp.median : comps.globalMedian;
  const multiple = Math.min(model.cat_mult_cap, Math.max(model.cat_mult_floor, raw));
  return { multiple, liveComps: comp !== undefined ? comp.n : 0, liveMedian: raw };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comps: { byCategory: Map<string, CategoryComp>; globalMedian: number },
  model: ModelConstants = MODEL,
): {
  implied: number;
  categoryMultiple: number;
  liveComps: number;
  liveMedian: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, liveComps, liveMedian } = categoryMultiple(protocol, comps, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + Math.min(protocol.chains.length, model.chain_max) * model.chain_step;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  return { implied, categoryMultiple: multiple, liveComps, liveMedian, growthPct, growthMult, maturityMult, chainMult, age };
}

/**
 * A one-dollar tie-break, applied down the ranks: when two rows' implied values would tie, the lower
 * one loses a dollar, so the board's values fall strictly from rank 1 down. The page runs the same
 * function, so the code and the board always agree.
 */
export function applyTiebreak(values: number[]): number[] {
  const out = [...values];
  for (let i = 1; i < out.length; i++) {
    if (out[i]! >= out[i - 1]!) out[i] = Math.max(1, out[i - 1]! - 1);
  }
  return out;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const comps = categoryComps(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: launchable pre-token protocols below the watchlist floor, every one of them, by
  // TVL. Never a replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isLaunchable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, comps, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const tied = applyTiebreak(scored.map((s) => s.v.implied));
  const watchlist = new Set(snapshot.watchlist);
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
    token_status: 'pre-token' as const,
    watchlist: watchlist.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: tied[i]!,
    model: {
      category_multiple: s.v.categoryMultiple,
      live_comps: s.v.liveComps,
      live_median: s.v.liveMedian,
      growth_pct: s.v.growthPct,
      growth_multiplier: s.v.growthMult,
      maturity_multiplier: s.v.maturityMult,
      chain_multiplier: s.v.chainMult,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 100;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 30;
}

/** What gas costs to move funds onto a chain, by chain. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return '$3–$8 of gas';
  if (chain === 'Solana') return 'under $0.10 of gas';
  if (chain === 'Bitcoin') return '$1–$3 of gas';
  return '$0.10–$1 of gas';
}

/** The category's core action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} as collateral, then borrow a small amount against it and leave both legs open.`;
  }
  if (c.includes('dex')) {
    return `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain}, pairing USDC with the chain's native asset, and keep the LP position open.`;
  }
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) {
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and hold the vault shares instead of trading them.`;
  }
  if (c.includes('deriv') || c.includes('perp') || c.includes('basis') || c.includes('interest rate')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position, then leave it alone.`;
  }
  if (c.includes('rwa') || c.includes('anchor btc') || c.includes('decentralized btc') || c.includes('dual-token')) {
    return `Mint or buy $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the same wallet.`;
  }
  if (c.includes('stak') || c.includes('restak')) {
    return `Stake $${capital} through ${name} on ${chain} and keep the receipt token in the wallet.`;
  }
  if (c.includes('prediction')) {
    return `Fund your account with $${capital} and take one position in an active market on ${name}.`;
  }
  if (c.includes('stable')) {
    return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  }
  if (c.includes('index')) {
    return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  }
  if (c.includes('card')) {
    return `Load $${capital} onto ${name}'s card on ${chain} and spend through it for everyday purchases.`;
  }
  if (c.includes('farm') || c.includes('leveraged')) {
    return `Deposit $${capital} of USDC into ${name}'s farm on ${chain} and keep the position open.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly qualifying action. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) {
    return `Once a week, adjust the position: add $10 of supply, or repay and re-borrow a small amount, so the activity spans several snapshots.`;
  }
  if (c.includes('dex') || c.includes('farm') || c.includes('leveraged')) {
    return `Once a week, make one swap through the pool or add $10 of liquidity, so the activity spans several snapshots.`;
  }
  if (c.includes('deriv') || c.includes('perp') || c.includes('basis') || c.includes('interest rate')) {
    return `Once a week, adjust the hedge a little or close and reopen it, so the activity spans several snapshots.`;
  }
  if (c.includes('prediction')) {
    return `Once a week, take one small position in a new market, so the activity spans several snapshots.`;
  }
  return `Once a week, make one qualifying action — a deposit, a swap, a vote or a claim — so the activity spans several snapshots.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm with ${p.name}, and store its seed phrase offline, never in a screenshot or a chat.`,
      cost: 'nothing to open; under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `Move $${capital} of USDC to ${chain} from your main wallet, and keep a little of the chain's native token aside for gas.`,
      cost: `${gasFor(chain)} to move the funds`,
      time: '10–20 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 250 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and do not close it early for a small gain.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `When a claim opens, use only the claim link the protocol itself publishes, and never pay anyone to claim for you. Write the wallet, the dates and every transaction in a farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Already trading view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js; the page builds the farm plan from the same fields. */
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
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    watchlist: row.watchlist,
    category_multiple: row.model.category_multiple,
    live_comps: row.model.live_comps,
    live_median: row.model.live_median,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const comps = categoryComps(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const values = board.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const total = board.reduce((n, r) => n + r.implied_value_usd, 0);
  const medianValue = values.length % 2 === 1 ? values[(values.length - 1) / 2]! : Math.round((values[values.length / 2 - 1]! + values[values.length / 2]!) / 2);
  const compRecord: Record<string, CategoryComp> = {};
  for (const [key, comp] of [...comps.byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    compRecord[key] = { n: comp.n, median: round4(comp.median) };
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    // The source names the fetch endpoint; the address itself stays out of the dashboard's data.
    source: snapshot.source.replace(/https?:\/\/\S+/g, 'the DefiLlama protocols endpoint'),
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: total,
    median_implied_usd: medianValue,
    global_median: round4(comps.globalMedian),
    comps: compRecord,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate asks for`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i + 1} does not fall below row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
