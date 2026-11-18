[![make.fun token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/maezageryan-del/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/maezageryan-del/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

# Launch Radar

A token launch radar for make.fun's token-radar-01. It reads the sealed DefiLlama snapshot,
works out which protocols still record no token, prices what each one's launch would be worth
off the snapshot's own evidence, and hands in a dashboard that ranks them — every row with a
farm plan that is costed, netted and given a verdict.

## The model

The snapshot's tokenised protocols are the only honest guide to a launch's worth: they are what
the market actually paid for TVL like this. So `lib/model.ts`:

1. **Fits a size curve to the comps** — every protocol that trades (exchange tokens, bridged or
   wrapped assets and pass-through staking books left out): log10(market cap) against log10(TVL),
   least squares. Every term the reading carries is one the blind tests kept: growth and maturity
   each improve the blind miss when they are on, and a per-category correction does not — it is
   fitted, measured, and NOT applied, so the model stays the curve and its two earned adjustments.
2. **Tests the full reading blind, five ways** — and every test prices the reading the board
   prints, never the curve alone: a two-fold split by slug (each half priced by a curve fitted
   on the other alone: median miss ×3.42, 32.2% within ×2); five-fold cross-validation, every
   comp read exactly once blind (×3.38, 32.2%); a time split — fitted on the older half of the
   comps, made to price the newer (×2.34, 44.1%); a five-step walk-forward — fitted on the past,
   made to price the next protocols to be listed, five times over (pooled ×2.44, 48%); and a
   bootstrap — the curve refitted on 200 resamples of the comps, every row's verdict and rank
   re-decided on each refit (median verdict stability 91.5%, 52.5% of rows hold their verdict in
   90%+ of refits). The walk-forward is the test shaped like the job itself: fit on the past,
   read on launches still to come. The ablation scores every term with it on and with it off on
   the same five folds (growth kept: ×3.38 on, ×3.61 off; maturity kept: ×3.38 on, ×3.62 off;
   category correction dropped: ×3.41 on, ×3.38 off), and the flat median cap-per-TVL multiple —
   the naive reading the curve must beat — scores ×4.20 on the same folds. The dashboard states
   all of it next to the model, because a curve that hides its error is asking to be trusted
   for the wrong reason.
3. **Reads each pre-token protocol off the curve** — the curve's value for its TVL, moved by its
   seven-day TVL growth (clamped) and by a maturity factor for how long it has run with no
   token. One function scores every row; no name is special-cased. Every reading carries two
   honesty checks beside it: a band (the implied value divided and multiplied by the
   cross-validated median miss — half of all blind readings land inside it) and a local
   cross-check that ignores the curve entirely, the median cap-per-TVL of the eight trading
   protocols nearest in size, times this TVL. The detail view also names the three nearest
   trading peers, with their real market caps, as exhibits. And every row carries its verdict
   stability — the share of the 200 bootstrap refits in which its verdict comes out the same —
   and its rank range across the refits, so a verdict that flips when the comp set is reshuffled
   is flagged on the board itself, not hidden.
4. **Ranks all of them** — 198 rows on this snapshot: the whole 40-protocol watchlist plus every
   early protocol below the floor that passes the watchlist's own standard (not an exchange
   book, not a versioned pool, not a wrapped, staked or bridged product of a token that trades).
   And every protocol in the snapshot is accounted for: 198 ranked, 416 live-token, 144
   pre-token set aside with the reason named — 758 of 758.

## The farm plans, netted

Each row's plan is derived from its own record — category mechanism, chains, TVL, age — in eight
steps with a cost and a time on each: the seventh is a watch brief with its exit triggers, and
the last does the maths out loud. The slice supposes a launch hands 10% of its implied value to
users, split the way points programs split it: half evenly among qualifying wallets, half
pro-rata to the farmed quarter of TVL. The cost is gas — three transactions to set up, one a
week while held, at the cheapest chain the protocol runs on — plus 5% a year of stablecoin yield
forgone on the capital. Slice minus cost is the net, and the net is the verdict: **FARM** (clears
by $20+), **THIN** (above water, barely), **SKIP** (under water — usually a small wallet in a
giant protocol, whose slice is a rounding error). The detail view also states the break-even
launch value — what the token would have to be worth for the slice to exactly cover the cost —
the net under a cautious scenario where users get 5%, not 10%, the net per hour of the farmer's
own time, and the date the hold ends. On this snapshot: 39 farm, 75 thin, 84 skip. The farm
portfolio section spends one budget greedily by net per dollar of capital across the farm and
thin plans, so a reader with $1,000 sees the best plans it buys, the total net and the net per
hour — not just a list of verdicts.

## The dashboard

`dashboard/` is a static page (no framework, no network) that `main.ts` fills from `data.js`:
the ranked board first — sortable columns, one-click verdict chips with their counts, a count
line that names the filters in force, and "Verdict holds" and "Net/hour" columns carrying each
row's bootstrap verdict stability and its net per hour of farmer time; filters for search,
category, farm verdict and watchlist-only; a detail panel per protocol showing the curve reading
with its band, rank range and local cross-check, the nearest trading peers, the netted farm maths
with its break-even, cautious scenario, net per hour and hold-until date, and the plan; a "fit,
in the open" panel that draws the curve through the 90 comps it was fitted on, states the five
blind tests, the ablation and the baseline, and tables the walk-forward steps; an accounting
panel that places every one of the 758 protocols — ranked, live, or set aside with its reason;
a farm portfolio that spends one budget across the best plans; and the live-token protocols set
aside at the market's own values. The page re-reads every row's implied value off the published
curve, so the number on screen and the number in `board.json` are the same arithmetic. Four
screenshots are handed in: the board, a detail view, the farm-filtered board, and the fit panel.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18+, standard library only. Writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` (via the kit's `vendor/makefun-board.ts`, unchanged) to the
output directory. Two runs write the same bytes.
