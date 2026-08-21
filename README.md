# LiveMarkets

**Sixty-second onchain prediction markets on Monad.** One question, nineteen independent price-tick shards, no shared counters — so the whole book can be matched in parallel.

```
      one question              nineteen shards                 one settlement

                          ┌─ 0.05 ─┐ openYes  openNo  matched ┐
                          ├─ 0.10 ─┤ openYes  openNo  matched │
   "Boundary this  ───────┼─ 0.15 ─┤ openYes  openNo  matched │
    over?"                │   ⋮    │    ⋮       ⋮       ⋮     ├──▶  yes / no / void
                          ├─ 0.85 ─┤ openYes  openNo  matched │
                          ├─ 0.90 ─┤ openYes  openNo  matched │
                          └─ 0.95 ─┘ openYes  openNo  matched ┘

                          ┗━━━━━━ 19 concurrent matchTick() txs ━━━━━━┛
```

A round is 45 seconds open, 60 seconds to settlement. Anyone can take a side at one of nineteen prices, 0.05 through 0.95. A YES and a NO resting at the same price have posted exactly 1.00 between them, which is exactly what the pair pays out — so matching them is pure bookkeeping, permissionless, and pays the matcher 10% of the fee on whatever they match. Winners take 1.00 per share minus a 1% fee. VOID refunds both legs at the traded price and charges nothing at all.

## Why the book is sharded by price

One shared order book is one contended storage slot. Two people filling completely unrelated prices still write the same length counter, the same volume total, the same fee accumulator — so a chain that executes transactions in parallel has to detect the conflict and serialise them anyway. The parallelism is real at the VM level and thrown away at the application level.

So there is no shared book here. Each of the nineteen ticks is its own `struct Tick` with its own resting YES total, resting NO total, matched total, fee accumulator, crank accumulator and two cursors. `matchTick(3, ...)` and `matchTick(11, ...)` touch disjoint storage and cannot conflict, so nineteen of them can land in the same block. Nothing in `Market.sol` writes a global counter, a running total or a shared array on the trading path — that absence is the whole design, and it is why history lives in the optional indexer instead of onchain.

## Status

| | where | state |
| --- | --- | --- |
| web app | not deployed from this build environment | run it locally, `npm run dev` |
| contracts | `packages/contracts/deployments/10143.json` | placeholder zero addresses until you deploy |
| chain | Monad testnet, id `10143` | 300–400 ms blocks, ~600–800 ms finality |
| resolution | one resolver key | v1 — see [Trust](#trust-and-limitations) |

No URL and no contract address is invented anywhere in this repo. After `npm run deploy`, fill this in from the file the deploy script writes:

| contract | address | verify |
| --- | --- | --- |
| `MarketFactory` | — | `https://testnet.monadexplorer.com/address/<addr>` |
| `Series` (per question) | — | same |
| `NaiveBook` (benchmark baseline) | — | same |

## Run it

```bash
git clone https://github.com/ShrikarT/livemarkets.git
cd livemarkets
npm i
npm run dev          # http://localhost:3000
```

The app works with an empty deployment file: factory reads are wrapped and the pages render designed empty states rather than crashing. Test MON comes from <https://faucet.monad.xyz>.

To put it on chain and keep it running:

```bash
cp .env.example .env     # DEPLOYER_PRIVATE_KEY, RESOLVER_ADDRESS, FEE_RECIPIENT, ...
npm run deploy           # forge script; writes packages/contracts/deployments/10143.json
npm run crank            # permissionless matcher + series poker + house maker
npm run index            # optional: postgres history, needs DATABASE_URL
npm test                 # forge tests + math parity + python model
```

Three separate keys on purpose: `CRANK_PRIVATE_KEY` is hot and worthless, `MAKER_PRIVATE_KEY` carries risk capital, and only `RESOLVER_PRIVATE_KEY` is privileged. A leaked cranker key costs a few cents of gas, not the ability to settle a market you are trading.

## The benchmark

`npm run bench` fills all nineteen levels four different ways against a live RPC and writes the numbers into `apps/web/config/bench.ts`, which ships with `measured: false` until someone does.

| run | what it does | transactions |
| --- | --- | --- |
| A · sequential | `matchTick(i)` per level, each awaited before the next | 19, serialised by the client |
| B · parallel | same 19 calls, one nonce fetch, all sent at once | 19, concurrent |
| C · batched | one `matchTicks([0..18])` call | 1 |
| D · naive baseline | `NaiveBook.matchAll()`, a deliberately shared book | 1, fully serialised inside |

`bench/NaiveBook.sol` exists to lose. It keeps one global order count and one running total, exactly like a normal single-book design, so the comparison measures the sharding rather than the compiler. Do not "fix" it.

What is true without running the benchmark, by reading the source: 19 ticks, 4 storage slots touched per tick on the match path, 0 slots shared between ticks.

## What was actually run

The Python reference model in `packages/contracts/sim/` reimplements `Market.sol` wei-for-wei, including `mulDivUp` on every debit and `mulDivDown` on every credit, and then a fuzzer beats on it. `cd packages/contracts/sim && python3 fuzz.py 400 300`:

```
worked example
  YES    alice_net= 59.40  bob_net=  0.00  refund=26.00  dust=0wei
  NO     alice_net=  0.00  bob_net= 59.40  refund=26.00  dust=0wei
  VOID   alice_net= 39.00  bob_net= 21.00  refund=26.00  dust=0wei
rounding edges
  rounding: mulDivUp keeps 1-wei pairs solvent at all 19 ticks (mulDivDown does not)
  refunds: exact to the wei on partially filled orders
fuzzing 400 runs x 300 actions
  orders placed        43,260
  cranks               23,959
  cancels              14,154
  shares matched     4,250.09
  expected reverts     10,921
  outcomes         {'YES': 126, 'NO': 128, 'VOID': 146}
  collateral settled    41,057.48
  rounding dust left after full drain: 12947 wei across 400 markets
ALL INVARIANTS HELD
```

12,947 wei of dust across 400 fully drained markets — about a hundredth of a cent — all of it rounding that favours the contract, never a user.

The browser does its own arithmetic, so `apps/web/lib/market-math.ts` mirrors the contract in `bigint` and is tested against the same vectors. `cd apps/web && node --test lib/market-math.test.ts`:

```
tests 16
pass 16
fail 0
```

`packages/contracts/test/Vectors.t.sol` closes the loop the other way: 9,120 committed cost vectors generated from the TypeScript, asserted against the Solidity, so the UI and the chain can never quietly disagree about what an order costs.

## Three bugs in the original spec

1. **`matchTick` was callable after resolution.** Once the outcome was known, anyone could still pair off a resting order at a price that was no longer a guess. It now reverts `AlreadyResolved()`; `test_no_matching_after_resolve` and the fuzzer both assert it.
2. **A global `feesAccrued` slot quietly broke the parallelism thesis.** Every `claim()` wrote one shared counter, so the nineteen shards reconverged on a single hot slot at settlement. Fees now accumulate per tick in `Tick.feeAcc`, and VOID takes no fee at all.
3. **`Series.poke()` drifted.** `nextStart = now + roundSeconds` pushed every future round later by however long the poke was late, so a series slipped minutes per hour. It now advances from the previous scheduled slot and resyncs after an outage — `test_series_schedule_does_not_drift` and `test_series_catches_up_after_long_outage`.

## Beyond the spec

- **`snapshot(who)`** returns the question, phase, outcome, both deadlines, implied price, the caller's balance, all nineteen levels and both position arrays in one `eth_call`. The trading room is one read, not twenty.
- **`matchTicks(list)`** and **`withdrawOrdersAt(tick, side)`** for callers who would rather pay once, without giving up the per-tick path that makes parallel matching possible.
- **Crank rewards are sharded too** — accrued per tick and paid to the address that actually did the matching.
- **A house maker** (`apps/cranker/src/house-maker.ts`) that quotes both legs so the first trader in a round has something to trade against, with per-round exposure and daily-loss caps checked before every order, on its own key.
- **An oracle that refuses to guess** (`apps/cranker/src/oracle.ts`): it settles only questions it can prove from chain data and returns `null` for everything else, which routes them to a human. A bot that guesses once, wrongly, destroys the only thing a prediction market sells.
- **A resolver console** (`/admin`) gated by the chain rather than an env allowlist, that makes you type the outcome word before it will submit, and that says "this is the centralisation risk" on the panel itself.
- **A faucet route** with five separate guards, and a `text/event-stream` book feed with heartbeats and a hard lifetime instead of a websocket that quietly dies.
- **A generated OG card** per market, cached for 5 seconds while live and immutably once settled.
- **An ASCII design system** — a real cell grid, an interference-field hero, a depth ladder drawn in box characters — previewable with no build step at all.

## Repo layout

```
packages/contracts/
  src/Market.sol            the price-tick sharded book
  src/MarketFactory.sol     deploys markets, holds fee config
  src/Series.sol            drift-free recurring rounds, permissionless poke
  bench/NaiveBook.sol       the deliberate serialiser, for comparison
  test/                     unit, invariant and cost-vector suites
  sim/                      python reference model + invariant fuzzer
apps/web/                   Next app: /, /app, /app/m/[address], /admin, api routes
apps/cranker/               matcher, series poker, house maker, oracle
apps/indexer/               optional postgres history and leaderboard
scripts/bench.ts            the A/B/C/D harness
design/preview/             static previews that link the real globals.css
```

There is no portfolio page. The routes above are all of them.

## Not committed

Four artefacts are generated, not authored, so they are not in git:

| missing | regenerate with |
| --- | --- |
| `packages/contracts/test/vectors/cost-vectors.json` | `cd packages/contracts && python3 sim/gen_vectors.py` |
| `design/preview/landing.html`, `room.html` | `python3 design/preview/make_previews.py` |
| `design/preview/*.png` | screenshot the two HTML files at 1440 wide |
| `apps/web/config/bench.ts` numbers | `npm run bench` |

## Trust and limitations

**One key settles every market today.** That is the honest centralisation, and the app says so on the page where it matters. The roadmap is v1 single resolver → v2 3-of-5 committee behind a multisig → v3 optimistic resolution with a bond and a challenge window.

**Unaudited. Testnet only.** 1% fee on winnings, nothing on VOID, no upgrade path and no admin function except resolution and a trading pause.

**What has not been run.** The build environment for this repo had neither Foundry nor network access, so `forge build`, `forge test`, `npm i` and `next build` were never executed here. The three `.t.sol` suites, the cranker, the indexer and the API routes are therefore unverified by execution and un-type-checked. That gap is not theoretical: six real defects were found and fixed while transcribing this code into git — two invalid Solidity hex literals (`0xREE`, `0xCAR01`) that would not have compiled, two dead links to a page that does not exist, a countdown bar whose window arithmetic collapsed to `1` so it never depleted, an ASCII box one cell too wide, and a component destructuring a toast API that does not exist while rendering a second copy of every toast. Run the suites before trusting any of it with anything.

## Licence

MIT.
