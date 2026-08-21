/**
 * Parity test: the browser's arithmetic must equal the contract's, to the wei.
 *
 *   npm run test:math          (from the repo root)
 *   node --test apps/web/lib/market-math.test.ts
 *
 * Zero dependencies. Uses node:test so it runs with nothing installed.
 *
 * The vectors in test/vectors/cost-vectors.json are the shared source of truth:
 *   - `forge test --mt test_committedVectorsMatchContract` proves the CONTRACT agrees
 *   - this file proves the FRONTEND agrees
 * Both read the same file, so the order ticket cannot silently drift from Market.sol.
 */

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
	MIN_SHARES,
	NUM_TICKS,
	ONE,
	WAD,
	cost,
	formatBps,
	formatWad,
	impliedBps,
	legPrice,
	mulDivDown,
	mulDivUp,
	netPayout,
	parseWad,
	price,
	quote,
	refundFor,
	tickForBps,
	type Outcome,
} from "./market-math.ts"

type Vectors = {
	one: string
	numTicks: number
	minShares: string
	tickPrices: string[]
	shareSamples: string[]
	legPrices: string[][]
	/** tick asc -> isYes true then false -> shareSamples index asc */
	costs: string[]
	payout: Array<{
		tick: number
		yesShares: string
		noShares: string
		outcome: string
		feeBps: number
		gross: string
		fee: string
		net: string
	}>
	refund: Array<{ tick: number; isYes: boolean; shares: string; filled: string; paid: string; refund: string }>
	implied: Array<{ book: Array<{ openYes: string; openNo: string; matched: string }>; impliedBps: string }>
}

const vectors: Vectors = JSON.parse(
	readFileSync(new URL("../../../packages/contracts/test/vectors/cost-vectors.json", import.meta.url), "utf8"),
)

test("constants match the contract", () => {
	assert.equal(ONE, BigInt(vectors.one))
	assert.equal(NUM_TICKS, vectors.numTicks)
	assert.equal(MIN_SHARES, BigInt(vectors.minShares))
	assert.equal(vectors.tickPrices.length, NUM_TICKS)
	vectors.tickPrices.forEach((p, i) => assert.equal(price(i), BigInt(p), `tick ${i} price`))
})

test("legPrice matches the contract at every tick, both legs", () => {
	vectors.legPrices.forEach((pair, tick) => {
		assert.equal(legPrice(tick, true), BigInt(pair[0]!), `tick ${tick} YES`)
		assert.equal(legPrice(tick, false), BigInt(pair[1]!), `tick ${tick} NO`)
	})
})

test(`cost() is wei-exact across ${vectors.costs.length.toLocaleString()} vectors`, () => {
	// Must walk the vectors in exactly the documented order, or the whole harness is
	// comparing the wrong numbers to each other and silently passing.
	const samples = vectors.shareSamples.map(BigInt)
	let k = 0
	for (let tick = 0; tick < vectors.numTicks; tick++) {
		for (const isYes of [true, false]) {
			for (const shares of samples) {
				const expected = vectors.costs[k]
				assert.ok(expected !== undefined, `ran off the end of costs[] at ${k}`)
				assert.equal(
					cost(tick, shares, isYes),
					BigInt(expected),
					`cost tick=${tick} yes=${isYes} shares=${shares}`,
				)
				k++
			}
		}
	}
	assert.equal(k, vectors.costs.length, "walked a different number of vectors than the file holds")
	assert.ok(k > 8_000, `expected thousands of vectors, got ${k}`)
})

test("payout and fee are wei-exact", () => {
	for (const v of vectors.payout) {
		const got = netPayout(v.tick, BigInt(v.yesShares), BigInt(v.noShares), v.outcome as Outcome, v.feeBps)
		const where = `tick=${v.tick} outcome=${v.outcome} yes=${v.yesShares}`
		assert.equal(got.gross, BigInt(v.gross), `gross ${where}`)
		assert.equal(got.fee, BigInt(v.fee), `fee ${where}`)
		assert.equal(got.net, BigInt(v.net), `net ${where}`)
	}
})

test("void takes no fee, ever", () => {
	const voids = vectors.payout.filter((v) => v.outcome === "void")
	assert.ok(voids.length > 0)
	for (const v of voids) assert.equal(BigInt(v.fee), 0n, "a void must never be taxed")
})

test("refunds on partially filled orders are wei-exact", () => {
	for (const v of vectors.refund) {
		const got = refundFor({
			tick: v.tick,
			isYes: v.isYes,
			shares: BigInt(v.shares),
			filled: BigInt(v.filled),
			paid: BigInt(v.paid),
		})
		assert.equal(got, BigInt(v.refund), `refund tick=${v.tick} filled=${v.filled}/${v.shares}`)
	}
})

test("a withdrawn order refunds nothing (no double spend)", () => {
	const r = refundFor({ tick: 5, isYes: true, shares: WAD, filled: 0n, paid: cost(5, WAD, true), withdrawn: true })
	assert.equal(r, 0n)
})

test("impliedBps matches the contract, including the empty book", () => {
	assert.equal(impliedBps([]), 5_000n, "an empty book is 50/50")
	for (const [i, v] of vectors.implied.entries()) {
		const book = v.book.map((t) => ({
			openYes: BigInt(t.openYes),
			openNo: BigInt(t.openNo),
			matched: BigInt(t.matched),
		}))
		assert.equal(impliedBps(book), BigInt(v.impliedBps), `implied vector ${i}`)
	}
})

// ---------------------------------------------------------------- properties
// These are the properties that keep the contract solvent. If rounding ever goes
// the wrong way, these fail here before they can fail with real collateral.

test("SOLVENCY: a matched pair always collects at least the 1.00 it owes", () => {
	for (let tick = 0; tick < NUM_TICKS; tick++) {
		for (const shares of [1n, 2n, 3n, 7n, 9_999n, MIN_SHARES, WAD, WAD + 1n, 7_777_777_777_777_777n]) {
			const collected = cost(tick, shares, true) + cost(tick, shares, false)
			assert.ok(
				collected >= shares,
				`tick ${tick} shares ${shares}: collected ${collected} < owed ${shares} — INSOLVENT`,
			)
			// and it never over-collects by more than 1 wei per leg
			assert.ok(collected - shares <= 2n, `tick ${tick}: over-collected by ${collected - shares} wei`)
		}
	}
})

test("rounding down would break solvency (proves mulDivUp is load-bearing)", () => {
	let breaks = 0
	for (let tick = 0; tick < NUM_TICKS; tick++) {
		const down = mulDivDown(1n, legPrice(tick, true), ONE) + mulDivDown(1n, legPrice(tick, false), ONE)
		if (down < 1n) breaks++
	}
	assert.ok(breaks > 0, "if this passes with mulDivDown, the rounding argument is wrong")
})

test("the two legs of a tick always sum to exactly 1.00", () => {
	for (let tick = 0; tick < NUM_TICKS; tick++) {
		assert.equal(legPrice(tick, true) + legPrice(tick, false), ONE, `tick ${tick}`)
	}
})

test("mulDivUp and mulDivDown differ by at most 1", () => {
	for (const a of [1n, 7n, 9_999n, WAD, 123_456_789n]) {
		for (let t = 0; t < NUM_TICKS; t++) {
			const up = mulDivUp(a, price(t), ONE)
			const dn = mulDivDown(a, price(t), ONE)
			assert.ok(up - dn === 0n || up - dn === 1n, `a=${a} tick=${t}`)
		}
	}
})

test("quote(): cost never exceeds max payout at any tick", () => {
	for (let tick = 0; tick < NUM_TICKS; tick++) {
		const q = quote({ tick, shares: 10n * WAD, isYes: true, feeBps: 100 })
		assert.ok(q.cost < q.maxPayout, `tick ${tick}: cost ${q.cost} >= payout ${q.maxPayout}`)
		assert.ok(q.maxProfit > 0n, `tick ${tick} has no upside`)
		assert.ok(q.payoutMultipleWad > WAD, `tick ${tick} multiple must exceed 1.00x`)
		// break-even must sit above the raw price: the fee has to be earned back
		assert.ok(q.breakEvenBps >= legPrice(tick, true), `tick ${tick} break-even ignores the fee`)
	}
})

test("quote(): flags sub-dust orders instead of letting them revert onchain", () => {
	assert.equal(quote({ tick: 9, shares: MIN_SHARES - 1n, isYes: true, feeBps: 100 }).tooSmall, true)
	assert.equal(quote({ tick: 9, shares: MIN_SHARES, isYes: true, feeBps: 100 }).tooSmall, false)
})

test("tickForBps snaps to the nearest tradeable tick", () => {
	assert.equal(tickForBps(500), 0)
	assert.equal(tickForBps(9_500), 18)
	assert.equal(tickForBps(6_500), 12) // the 0.65 tick used throughout the tests
	assert.equal(tickForBps(0), 0) // clamps, never throws
	assert.equal(tickForBps(10_000), 18) // clamps, never throws
	for (let t = 0; t < NUM_TICKS; t++) assert.equal(tickForBps(price(t)), t, `round-trip tick ${t}`)
})

test("formatting is display-only and lossless enough to re-parse", () => {
	// bps render as a probability in 0..1, which is how a prediction market quotes
	assert.equal(formatBps(6_500n), "0.65")
	assert.equal(formatBps(500n), "0.05")
	assert.equal(formatBps(9_500n), "0.95")
	assert.equal(formatWad(WAD + WAD / 2n), "1.50")
	assert.equal(formatWad(0n), "0.00")
	assert.equal(formatWad(-WAD), "-1.00")
	assert.equal(parseWad("1.5"), WAD + WAD / 2n)
	assert.equal(parseWad("0.000000000000000001"), 1n)
	assert.equal(parseWad(""), 0n, "an empty input must not throw in an order ticket")
	assert.equal(parseWad("abc"), 0n, "garbage must not throw in an order ticket")
	assert.equal(parseWad("1.9999999999999999999999"), 1_999_999_999_999_999_999n, "truncates, never rounds up")
})
