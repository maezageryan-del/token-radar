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
   least squares, with a per-category correction from each category's median miss, clamped so a
   thin category cannot rule.
2. **Tests the fit blind, three ways** — a two-fold split by slug (each half priced by a curve
   fitted on the other alone: median miss ×3.46, 33.3% within ×2); five-fold cross-validation,
   every comp read exactly once blind (×3.78, 27.8%); and a time split — fitted on the older
   half of the comps, made to price the newer (×2.17, 44.1%). The time split is the test shaped
   like the job itself: fit on the past, read on launches still to come. The dashboard states
   all three next to the model, because a curve that hides its error is asking to be trusted
   for the wrong reason.
3. **Reads each pre-token protocol off the curve** — the curve's value for its TVL and category,
   moved by its seven-day TVL growth (clamped) and by a maturity factor for how long it has run
   with no token. One function scores every row; no name is special-cased. Every reading carries
   two honesty checks beside it: a band (the implied value divided and multiplied by the
   cross-validated median miss — half of all blind readings land inside it) and a local
   cross-check that ignores the curve entirely, the median cap-per-TVL of the eight trading
   protocols nearest in size, times this TVL. The detail view also names the three nearest
   trading peers, with their real market caps, as exhibits.
4. **Ranks all of them** — 198 rows on this snapshot: the whole 40-protocol watchlist plus every
   early protocol below the floor that passes the watchlist's own standard (not an exchange
   book, not a versioned pool, not a wrapped, staked or bridged product of a token that trades).

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
and the net under a cautious scenario where users get 5%, not 10%. On this snapshot: 42 farm,
70 thin, 86 skip.

## The dashboard

`dashboard/` is a static page (no framework, no network) that `main.ts` fills from `data.js`:
the ranked board with sortable columns; filters for search, category, farm verdict and
watchlist-only; a detail panel per protocol showing the curve reading with its band and local
cross-check, the nearest trading peers, the netted farm maths with its break-even and cautious
scenario, and the plan; a "fit, in the open" panel that draws the curve through the 90 comps it
was fitted on, states the three blind tests, and tables the category corrections; and the
live-token protocols set aside at the market's own values. The page re-reads every row's implied
value off the published curve, so the number on screen and the number in `board.json` are the
same arithmetic.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18+, standard library only. Writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` (via the kit's `vendor/makefun-board.ts`, unchanged) to the
output directory. Two runs write the same bytes.
