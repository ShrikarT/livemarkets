import type { Address } from "viem"

import { listRecentMarkets, publicClient } from "./market-client"

/**
 * Who actually won, from settlement logs.
 *
 * WHY LOGS AND NOT A COUNTER
 *
 * The tempting shortcut is to have the app POST "I won" to a KV counter when a
 * claim succeeds. That produces a leaderboard anyone can forge with curl, which
 * is worse than no leaderboard: it invites people to trust a number that is not
 * true. Claimed is emitted by the contract at the moment value moves, and `net`
 * is the amount actually credited after the fee -- so this table is exactly as
 * trustworthy as the chain, and nothing here can be written by a client.
 *
 * WHAT THIS DELIBERATELY IS NOT
 *
 * It is not profit-and-loss. Ranking by net claimed rewards volume as much as
 * skill, and computing true P&L needs the cost basis of every fill, which means
 * replaying Matched logs against per-order prices -- an indexer's job, not a
 * page render's. Calling this "winnings" rather than "profit" is the honest
 * label for what the number is.
 */

/** Transcribed from lib/abi.ts. Inline so viem infers the arg types exactly. */
const CLAIMED_EVENT = {
	type: "event",
	name: "Claimed",
	inputs: [
		{ name: "who", type: "address", indexed: true },
		{ name: "net", type: "uint256", indexed: false },
		{ name: "fee", type: "uint256", indexed: false },
	],
} as const

const CRANK_EVENT = {
	type: "event",
	name: "CrankRewardPaid",
	inputs: [
		{ name: "tick", type: "uint8", indexed: true },
		{ name: "to", type: "address", indexed: true },
		{ name: "amount", type: "uint256", indexed: false },
	],
} as const

/**
 * How far back to read.
 *
 * Monad testnet produces a block roughly every 400ms, so 20,000 blocks is about
 * two hours -- long enough that a leaderboard is never empty during a demo, short
 * enough that a public RPC will serve it. This is a window, and the UI says so;
 * an all-time board needs an indexer, not a bigger number here.
 */
const LOOKBACK_BLOCKS = 20_000n

/** How many recent markets to include. Rounds are ~60s, so 48 is under an hour. */
const MARKET_SCAN = 48

export type LeaderRow = {
	address: Address
	/** MON credited by claims, after the fee */
	netWei: bigint
	/** fee paid on those winnings -- shown because a fee you cannot see is a fee you distrust */
	feeWei: bigint
	claims: number
	/** crank rewards earned for doing the matching nobody is obliged to do */
	crankWei: bigint
	cranks: number
}

export type LeaderboardResult = {
	rows: LeaderRow[]
	fromBlock: bigint
	toBlock: bigint
	markets: number
	/** true when the window had to be narrowed to satisfy the RPC */
	partial: boolean
}

const EMPTY: LeaderboardResult = {
	rows: [],
	fromBlock: 0n,
	toBlock: 0n,
	markets: 0,
	partial: false,
}

/**
 * The sequence of windows to try, widest first.
 *
 * Public RPCs disagree about how wide a getLogs range may be and signal refusal
 * with an opaque error rather than a documented code. Rather than guess a limit
 * that happens to suit one provider, ask for what we want and halve on refusal.
 *
 * This returns only the SCHEDULE, not the logs. An earlier version wrapped the
 * request itself in a generic helper, which quietly erased viem's inferred log
 * types -- the type-checker caught it as `unknown`. Keeping the retry policy and
 * the typed call separate means every getLogs call site stays concrete.
 */
function windows(head: bigint, wanted: bigint): Array<{ from: bigint; to: bigint; narrowed: boolean }> {
	const out: Array<{ from: bigint; to: bigint; narrowed: boolean }> = []
	let span = wanted
	for (let attempt = 0; attempt < 5 && span >= 100n; attempt++) {
		out.push({
			from: head > span ? head - span : 0n,
			to: head,
			narrowed: span !== wanted,
		})
		span /= 2n
	}
	return out
}

/**
 * Structural shape of the log args we read.
 *
 * Every field is optional on purpose: viem types them as required for a const
 * event, which is assignable to this, while the optionality documents that a
 * malformed or re-orged log must not crash a page render. The guards below are
 * the enforcement.
 */
type ClaimedLog = { args: { who?: Address; net?: bigint; fee?: bigint } }
type CrankLog = { args: { to?: Address; amount?: bigint } }

export async function getLeaderboard(opts?: { limit?: number }): Promise<LeaderboardResult> {
	const limit = opts?.limit ?? 25

	let addresses: Address[] = []
	try {
		addresses = [...(await listRecentMarkets(MARKET_SCAN))] as Address[]
	} catch {
		return EMPTY
	}
	if (addresses.length === 0) return EMPTY

	let head: bigint
	try {
		head = await publicClient.getBlockNumber()
	} catch {
		return EMPTY
	}

	const schedule = windows(head, LOOKBACK_BLOCKS)

	let claimedLogs: ClaimedLog[] = []
	let claimedFrom = head
	let narrowed = false
	for (const w of schedule) {
		try {
			claimedLogs = await publicClient.getLogs({
				address: addresses,
				event: CLAIMED_EVENT,
				fromBlock: w.from,
				toBlock: w.to,
			})
			claimedFrom = w.from
			narrowed = narrowed || w.narrowed
			break
		} catch {
			narrowed = true
		}
	}

	// Reuse the window that actually worked. Asking for a wider range for the
	// second event would only rediscover the same refusal, and a board whose two
	// columns cover different spans is not comparable.
	let crankLogs: CrankLog[] = []
	try {
		crankLogs = await publicClient.getLogs({
			address: addresses,
			event: CRANK_EVENT,
			fromBlock: claimedFrom,
			toBlock: head,
		})
	} catch {
		// Crank rewards are a secondary column; losing them must not lose the board.
		crankLogs = []
		narrowed = true
	}

	const byAddress = new Map<string, LeaderRow>()
	const row = (who: Address): LeaderRow => {
		const key = who.toLowerCase()
		const existing = byAddress.get(key)
		if (existing) return existing
		const fresh: LeaderRow = {
			address: who,
			netWei: 0n,
			feeWei: 0n,
			claims: 0,
			crankWei: 0n,
			cranks: 0,
		}
		byAddress.set(key, fresh)
		return fresh
	}

	for (const log of claimedLogs) {
		const who = log.args.who
		if (!who) continue
		const r = row(who)
		r.netWei += log.args.net ?? 0n
		r.feeWei += log.args.fee ?? 0n
		r.claims += 1
	}

	for (const log of crankLogs) {
		const to = log.args.to
		if (!to) continue
		const r = row(to)
		r.crankWei += log.args.amount ?? 0n
		r.cranks += 1
	}

	const rows = [...byAddress.values()].sort((a, b) => {
		// Winnings first, then who did the unpaid-by-default work of matching.
		if (a.netWei !== b.netWei) return a.netWei > b.netWei ? -1 : 1
		if (a.crankWei !== b.crankWei) return a.crankWei > b.crankWei ? -1 : 1
		return b.claims - a.claims
	})

	return {
		rows: rows.slice(0, limit),
		fromBlock: claimedFrom,
		toBlock: head,
		markets: addresses.length,
		partial: narrowed,
	}
}
