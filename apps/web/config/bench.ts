/**
 * Benchmark results.
 *
 * The landing page makes a performance claim, so the numbers behind it have to be
 * reproducible by whoever is reading the claim. `npm run bench` writes this file
 * from a live run against Monad testnet; until it has been run, the landing says
 * so rather than showing numbers nobody measured.
 *
 * Two different kinds of fact live here, and they are labelled differently on the
 * page on purpose:
 *
 *   measured   wall-clock latency from a real run. Requires a funded key and an
 *              RPC endpoint, so it is empty in a fresh clone.
 *   structural bytes-and-slots facts about the contracts, true by construction and
 *              provable by reading the source. These are safe to state flatly.
 */

export type BenchRow = {
	label: string
	sequential: string
	parallel: string
	note?: string
}

export type BenchResults = {
	measured: boolean
	chain?: string
	takenAt?: string
	commit?: string
	rows: BenchRow[]
}

/**
 * Structural facts. These do not need a chain to be true.
 *
 * The claim the whole design rests on: filling all 19 price levels touches 19
 * disjoint sets of storage slots, so the transactions do not contend and the
 * scheduler can run them at the same time. A single shared order book cannot do
 * this at any block time, on any chain.
 */
export const structural = {
	ticks: 19,
	/** slots a matchTick(tick) write-path touches, all of them keyed by that tick */
	slotsPerTick: 4,
	/** slots shared between two different ticks' match paths */
	sharedSlots: 0,
	/** and therefore */
	maxConcurrentMatchTxs: 19,
	note: "Market.sol has no written global counter, total or shared array. Fees, crank rewards and cursors are all per-tick.",
} as const

/**
 * Populated by scripts/bench.ts. Left empty deliberately: an unmeasured number on
 * a landing page is a lie with a monospace font.
 */
export const bench: BenchResults = {
	measured: false,
	rows: [],
}

export const BENCH_COMMAND = "npm run bench"
