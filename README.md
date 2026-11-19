[![Bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/maezageryan-del/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/maezageryan-del/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

# Launch Radar — a field guide to pre-token protocols

Launch Radar reads the sealed DefiLlama snapshot (758 protocols, as of
2026-11-14), separates the protocols that already have a token from the ones
that do not, prices every stand-alone pre-token protocol with a model fitted
from the snapshot itself, and nets each one as a farming plan — expected drop
minus gas, ramp and forgone yield — so the board answers two questions at a
glance: what would this be worth if it launched, and is farming it worth the
hours?

Run it with `node main.ts` (Node 22, standard library only, no network). It
reads `/input/snapshot.json` by default (`--input <file|dir>` overrides) and
writes `board.json`, `dashboard/` with a generated `data.js`, `screenshots/`
and `dossier.json` to the output directory (`--output` or
`MAKEFUN_OUTPUT_DIR`, default `/output`). Two runs are byte-identical: the
only randomness is a seeded bootstrap.

## The universe, accounted for

All 758 protocols land in exactly one bucket, by stated rules:

| Bucket | Count | Rule |
| --- | ---: | --- |
| Ranked | 198 | Pre-token (no gecko id, no symbol), stand-alone, positive TVL |
| Live token | 416 | Already records a token |
| Bridge | 43 | Category Bridge or Canonical Bridge |
| Liquid staking or restaking | 43 | Category Liquid Staking, Liquid Restaking or Restaked BTC |
| Exchange custody | 42 | Category CEX, or a name led by an exchange brand |
| Versioned release | 11 | Name ends in a version marker (V2, 2.0, …) |
| Wrapped-or-staked name | 5 | Name carries the whole word wrapped, staked or staking |
| No positive TVL | 0 | — |

All 40 watchlist protocols are on the board. Total implied value across the
198 ranked rows is $1,737,348,109.

## The reading

Comparables ("comps") are the 92 traded stand-alone protocols with positive
TVL and market cap — the same stand-alone test as the board, so bridges,
liquid-staking books, exchange custody, versioned releases and
wrapped/staked names never price anything. On the comps, least squares on
log–log scale gives the size curve

    market cap ≈ 10^(3.958 + 0.394 · log10 TVL)

and each pre-token protocol is read as

    implied = curve(TVL) × (1 + clamp(7d %, −50, 100) × 0.0035)
                        × (0.82 + 0.28 · min(age in days, 1095) / 1095)

with unknown age taken as 365 days. Category factors are computed (median
actual/curve per category with at least 6 comps, clamped to [1/2.2, 2.2]:
Basis Trading ×1.77, RWA ×1.66, Dexs ×1.25, Yield ×0.91, Lending ×0.61) and
reported, but **not applied** — the ablation below says they earn nothing
blind, so the board does not take their help.

## Validation — the full reading, held out

Every test prices held-out comps with the full reading (curve refit on the
training part only; growth and maturity are fixed constants). Miss is
max(pred/actual, actual/pred).

| Test | Median miss | Within ×2 | n |
| --- | ---: | ---: | ---: |
| Blind split (halves by slug hash, each priced by the other) | ×3.42 | 37.0% | 92 |
| 5-fold cross-validation | ×3.28 | 35.9% | 92 |
| Time split (fit older half by listing date, price newer) | ×2.06 | 48.6% | 35 |
| Walk-forward (5 expanding windows, pooled) | ×2.21 | 42.0% | 50 |
| Flat-multiple baseline (median cap/TVL, same folds) | ×4.56 | 31.5% | 92 |

Ablation (5-fold): full reading ×3.28 · growth off ×3.33 · maturity off
×3.27 · category factors on ×3.25 with fewer inside ×2 (34.8% vs 35.9%).
Growth helps a little; maturity is roughly neutral in the folds and is
kept as a stated prior — a reading that prices a two-week-old protocol
exactly like a three-year-old one would be hiding an assumption, not
removing one; category factors change nothing that matters and stay out.

Each board value carries a band: implied ÷/× 7.76, the pooled
75th-percentile absolute held-out log miss from the 5-fold run — and 76.1%
of held-out comps indeed land inside their band. Rank ranges come from 200
bootstrap refits (resample the comps, refit, re-read the whole board):
each row prints its p10–p90 rank and the share of refits in which its
verdict class survives.

## Farm economics

At the standard $2,500 plan: the user pool is 10% of implied value
(cautious scenario 5%); the farmed share is 25% of TVL split across wallets
of $250; a plan's expected drop is pool × (½/wallets + ½ × capital/farmed
TVL) — half the drop spread evenly, half pro-rata. Costs are the step count
times gas on the protocol's cheapest listed chain (Ethereum $12, BNB Chain
$1.20, Solana $0.40, Base $0.80, Arbitrum $0.90, Avalanche $0.70, Polygon
$0.50, Tron $1.00, Sui $0.50, default $2.00) plus a $4.60 on/off-ramp, and
opportunity cost at 5%/yr over a hold of clamp(730 − age/2, 90, 730) days.
Verdicts: **FARM** when net ≥ $25 (66 rows), **THIN** when net > $0 (10),
**SKIP** otherwise (122). The honest pattern the netting exposes: the
biggest protocols are SKIP at this plan size — their drops are spread over
so many wallets that forgone yield wins — while the best net per hour,
MetalX Swap at $65/hour, sits at rank 148 by value.

The detail view shows, per protocol, the line-item build-up (TVL → curve →
growth → maturity → implied), the three nearest traded comparables by TVL,
the farm panel with the cautious-scenario net, a sensitivity matrix (user
shares 3.5%/7%/14% × plans $1,000/$2,500/$10,000), and 8–9 numbered farm
steps generated from the protocol's category and chains, each with its cost
in dollars and its time in minutes. A greedy basket over FARM rows by net
per dollar fills a $10,000 budget with MetalX Swap, SyncSwap, Katana DEX
and BTCFi CDP for an expected net of $1,257 over 24.2 hours.

## The page

`dashboard/` is a static, offline field guide — warm paper, ink, one teal
accent, serif display type, mono figures — that renders entirely from
`data.js` and recomputes every net at the selected plan size ($1,000 /
$2,500 / $10,000) from the same carried fields `board.json` is written
from, so page and board cannot drift. The board is the hero: stat strip,
the fitted formula, the coverage bar over all 758, verdict/watchlist/
category/chain/search filters, and a table sortable by rank, TVL, 7-day
change, tracked age, value, net and net per hour. `#farm` opens it filtered
to FARM sorted by net per hour; `#detail=<slug>` opens a protocol's detail.
