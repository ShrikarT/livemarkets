/**
 * The house maker.
 *
 * A brand-new sixty-second market has an empty book. The first person to arrive
 * sees nothing to trade against, so they leave, so the next person also sees
 * nothing. Every fast market dies of this, and no amount of UI polish fixes it —
 * the fix is that something is always quoting.
 *
 * So the house quotes both legs, cheaply, on every live round:
 *
 *   buy YES at (mid - spread)        buy NO at (mid + spread)
 *
 * Both legs cost the maker less than their fair value if `mid` is roughly right,
 * which is where the edge comes from. It is a real position with real downside,
 * which is exactly why the caps below are not optional and are checked before
 * every single order rather than once at startup.
 *
 *   per-round exposure  stops one weird round eating the whole float
 *   daily loss cap      stops a bad `mid` bleeding out over an afternoon
 *   own key             the maker is never the cranker or the resolver, so a
 *                       compromised maker cannot settle a market it is trading
 */

import { createWalletClient, http, type Address, type PublicClient } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import { marketAbi } from "./abi.js"
import { chain, config } from "./config.js"

const ONE = 10_000n
const TICK_STEP = 500n
const NUM_TICKS = 19

/** price of tick i, in bps: 500, 1000, ... 9500 */
function price(tick: number): bigint {
	return (BigInt(tick) + 1n) * TICK_STEP
}

function legPrice(tick: number, isYes: boolean): bigint {
	return isYes ? price(tick) : ONE - price(tick)
}

function mulDivUp(a: bigint, b: bigint, d: bigint): bigint {
	const p = a * b
	return p === 0n ? 0n : (p - 1n) / d + 1n
}

/** Same rounding as the contract: the maker never underfunds its own order. */
function cost(tick: number, shares: bigint, isYes: boolean): bigint {
	return mulDivUp(shares, legPrice(tick, isYes), ONE)
}

function tickForBps(bps: bigint): number {
	const raw = Number(bps / TICK_STEP) - 1
	return Math.max(0, Math.min(NUM_TICKS - 1, raw))
}

type RoundState = {
	/** wei committed to this market so far */
	spent: bigint
	/** the tick pair currently resting, so we know when to re-quote */
	quotedYes: number | null
	quotedNo: number | null
}

const rounds = new Map<string, RoundState>()
const daily = { day: today(), spent: 0n, returned: 0n }

function today(): string {
	return new Date().toISOString().slice(0, 10)
}

function rollDay() {
	if (daily.day !== today()) {
		daily.day = today()
		daily.spent = 0n
		daily.returned = 0n
		rounds.clear()
	}
}

/** Realised loss so far today. Negative means the maker is up. */
function dailyLoss(): bigint {
	return daily.spent - daily.returned
}

type Snapshot = readonly [
	string,
	number,
	number,
	bigint,
	bigint,
	bigint,
	bigint,
	readonly { openYes: bigint; openNo: bigint; matched: bigint }[],
	readonly bigint[],
	readonly bigint[],
]

export async function runHouseMaker(pub: PublicClient, markets: readonly Address[]): Promise<void> {
	if (!config.makerKey) return
	rollDay()

	if (dailyLoss() >= config.houseMaker.maxDailyLossWei) {
		// Loud, once per loop, because a silently disabled maker looks identical to
		// a working one until you notice the books are empty.
		console.warn("[maker] daily loss cap reached \\u2014 not quoting until tomorrow")
		return
	}

	const account = privateKeyToAccount(config.makerKey)
	const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) })

	for (const market of markets) {
		try {
			const snap = (await pub.readContract({
				address: market,
				abi: marketAbi,
				functionName: "snapshot",
				args: [account.address],
			})) as unknown as Snapshot

			const phase = Number(snap[1])
			if (phase !== 0) continue // only quote while the book is open

			const impliedBps = snap[5]
			const state = rounds.get(market) ?? { spent: 0n, quotedYes: null, quotedNo: null }

			// Where we want to be quoting right now.
			const mid = tickForBps(impliedBps)
			const offset = Math.max(1, Math.round(config.houseMaker.spreadBps / Number(TICK_STEP)))
			const wantYes = Math.max(0, mid - offset)
			const wantNo = Math.min(NUM_TICKS - 1, mid + offset)

			// Already quoting the right pair? Leave it alone. Churning orders just
			// burns gas and loses queue position.
			if (state.quotedYes === wantYes && state.quotedNo === wantNo) continue

			const size = config.houseMaker.sizePerLegWei
			const need = cost(wantYes, size, true) + cost(wantNo, size, false)

			if (state.spent + need > config.houseMaker.maxExposurePerRoundWei) {
				continue // this round has had its allowance
			}
			if (dailyLoss() + need > config.houseMaker.maxDailyLossWei) {
				continue // worst case for this order would breach the daily cap
			}

			// Pull the stale pair first so the maker is not left holding four quotes.
			const base = await pub.getTransactionCount({ address: account.address, blockTag: "pending" })
			let n = base
			const txs: Promise<unknown>[] = []

			if (state.quotedYes !== null && state.quotedYes !== wantYes) {
				txs.push(
					wallet.writeContract({
						chain,
						account,
						address: market,
						abi: marketAbi,
						functionName: "withdrawOrdersAt",
						args: [state.quotedYes, true],
						nonce: n++,
					}),
				)
			}
			if (state.quotedNo !== null && state.quotedNo !== wantNo) {
				txs.push(
					wallet.writeContract({
						chain,
						account,
						address: market,
						abi: marketAbi,
						functionName: "withdrawOrdersAt",
						args: [state.quotedNo, false],
						nonce: n++,
					}),
				)
			}

			// place() is payable, so the collateral rides along with the order. Two
			// different ticks, two different storage regions, one round trip.
			txs.push(
				wallet.writeContract({
					chain,
					account,
					address: market,
					abi: marketAbi,
					functionName: "place",
					args: [wantYes, size, true],
					value: cost(wantYes, size, true),
					nonce: n++,
				}),
			)
			txs.push(
				wallet.writeContract({
					chain,
					account,
					address: market,
					abi: marketAbi,
					functionName: "place",
					args: [wantNo, size, false],
					value: cost(wantNo, size, false),
					nonce: n++,
				}),
			)

			const res = await Promise.allSettled(txs)
			const failed = res.filter((r) => r.status === "rejected").length

			state.spent += need
			state.quotedYes = wantYes
			state.quotedNo = wantNo
			rounds.set(market, state)
			daily.spent += need

			console.log(
				`[maker] ${market.slice(0, 8)} quoting yes@${wantYes} no@${wantNo} ` +
					`(${(Number(need) / 1e18).toFixed(3)} MON committed${failed ? `, ${failed} tx failed` : ""})`,
			)
		} catch (err) {
			console.warn(`[maker] ${market.slice(0, 8)} skipped:`, err instanceof Error ? err.message.slice(0, 120) : err)
		}
	}
}

/**
 * Called after a round settles so the daily figure reflects reality rather than
 * only what went out. Without this the maker looks like it is losing money every
 * single round and shuts itself off by mid-afternoon.
 */
export function recordReturn(amountWei: bigint) {
	rollDay()
	daily.returned += amountWei
}

export function makerStats() {
	return {
		day: daily.day,
		spentMon: Number(daily.spent) / 1e18,
		returnedMon: Number(daily.returned) / 1e18,
		netMon: Number(daily.returned - daily.spent) / 1e18,
		roundsQuoted: rounds.size,
	}
}
