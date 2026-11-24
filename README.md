# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/aleens279-gif/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/aleens279-gif/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar — ranks pre-token protocols by implied value, with a web dashboard.

Entry for make.fun's "Build the best token launch radar" bounty.

## What it is

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama snapshot at `/input/snapshot.json`, ranks every launchable pre-token protocol by implied value, and writes a dashboard that renders with no network.

- **Board:** 178 rows — all 40 watchlist protocols plus 138 launchable pre-token protocols, ranked by implied value.
- **Model ("radar-2"):** implied value = TVL × sector multiple × growth × maturity × chains. The sector multiple is the median market-cap/TVL ratio of live-token protocols in the same category.
- **Dashboard:** sortable/filterable board, per-protocol detail view with a full model breakdown and a 6-step farm plan, methodology section, live self-check.
- **Screenshots:** board, protocol detail view, filtered view.

## Run it

Run `main.ts` with the kit's snapshot at `/input/snapshot.json`. Outputs land in `/output/`: `board.json`, the dashboard, `screenshots/`, and `dossier.json` (built with the kit's `vendor/makefun-board.ts`).

Entered on [make.fun](https://make.fun/?ref=14mdadnq).
