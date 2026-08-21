/**
 * The indexer.
 *
 * The contracts keep no history on purpose — a global volume counter would be a
 * shared storage slot, and a shared storage slot is exactly what stops nineteen
 * matchTick() transactions running at once. So the chain stays stateless about
 * aggregates and this process rebuilds them from logs.
 *
 * Design:
 *   - Poll getLogs in windows instead of using a websocket subscription. Polling
 *     is boring, survives disconnects, and resumes from a cursor after a crash.
 *   - Re-scan the last REORG_DEPTH blocks every pass. Every insert is keyed by
 *     (blockNumber, logIndex) with onConflictDoNothing, so replaying a range is
 *     free and reorg handling needs no rollback logic at all.
 *   - Advance the cursor only after the write transaction commits. Crash between
 *     the two and the next pass redoes the window — which is safe, per above.
 */

import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import { createPublicClient, http, parseAbiItem, type Address, type Log } from "viem"

import { chain, config } from "../../cranker/src/config.js"
import { claims, cursor, markets, matches, orders, traders } from "./schema.js"

const CURSOR_ID = "factory"
const WINDOW = 2_000n
const REORG_DEPTH = 30n
const POLL_MS = 1_000

const marketCreated = parseAbiItem(
	"event MarketCreated(address indexed market, string question, uint64 openUntil, uint64 resolveAfter)",
)
const orderPlaced = parseAbiItem(
	"event OrderPlaced(address indexed maker, uint8 indexed tick, bool isYes, uint32 index, uint128 shares, uint256 paid)",
)
const matched = parseAbiItem(
	"event Matched(uint8 indexed tick, uint128 shares, uint128 tickTotal, address indexed matcher)",
)
const resolved = parseAbiItem("event Resolved(uint8 outcome)")
const claimed = parseAbiItem("event Claimed(address indexed who, uint256 net, uint256 fee)")

const pub = createPublicClient({ chain, transport: http(config.rpcUrl) })

const pool = new pg.Pool({
	connectionString: process.env.DATABASE_URL,
	max: 4,
})
const db = drizzle(pool)

const stats = { passes: 0, markets: 0, orders: 0, matches: 0, claims: 0, resolutions: 0 }

function ts(seconds: bigint | number): Date {
	return new Date(Number(seconds) * 1000)
}

/** Block timestamps, fetched once per block and reused across every log in it. */
const blockTimes = new Map<string, Date>()
async function blockTime(blockNumber: bigint): Promise<Date> {
	const key = blockNumber.toString()
	const hit = blockTimes.get(key)
	if (hit) return hit
	const block = await pub.getBlock({ blockNumber })
	const when = ts(block.timestamp)
	blockTimes.set(key, when)
	// The map is a cache, not a leak.
	if (blockTimes.size > 5_000) blockTimes.clear()
	return when
}

async function readCursor(): Promise<bigint> {
	const rows = await db.select().from(cursor).where(sql`${cursor.id} = ${CURSOR_ID}`)
	if (rows.length > 0) return rows[0]!.blockNumber
	const start = process.env.INDEX_FROM_BLOCK ? BigInt(process.env.INDEX_FROM_BLOCK) : await pub.getBlockNumber()
	return start
}

async function writeCursor(to: bigint) {
	await db
		.insert(cursor)
		.values({ id: CURSOR_ID, blockNumber: to, updatedAt: new Date() })
		.onConflictDoUpdate({ target: cursor.id, set: { blockNumber: to, updatedAt: new Date() } })
}

/** Every market address we know about, so we can filter market-level logs. */
const known = new Set<string>()
async function loadKnown() {
	const rows = await db.select({ address: markets.address }).from(markets)
	for (const r of rows) known.add(r.address.toLowerCase())
}

async function touchTrader(address: string, when: Date) {
	await db
		.insert(traders)
		.values({ address: address.toLowerCase(), firstSeen: when, lastSeen: when })
		.onConflictDoUpdate({
			target: traders.address,
			set: { lastSeen: sql`greatest(${traders.lastSeen}, ${when.toISOString()}::timestamptz)` },
		})
}

async function indexRange(from: bigint, to: bigint) {
	// 1. New markets from the factory.
	const created = await pub.getLogs({ address: config.factory, event: marketCreated, fromBlock: from, toBlock: to })
	for (const log of created) {
		const address = (log.args.market as Address).toLowerCase()
		await db
			.insert(markets)
			.values({
				address,
				question: log.args.question as string,
				openUntil: ts(log.args.openUntil as bigint),
				resolveAfter: ts(log.args.resolveAfter as bigint),
				createdBlock: log.blockNumber!,
				createdAt: await blockTime(log.blockNumber!),
			})
			.onConflictDoNothing()
		known.add(address)
		stats.markets++
	}

	if (known.size === 0) return
	const addresses = [...known] as Address[]

	// 2. Market-level logs, all markets at once. One getLogs per event type per
	//    window, not per market — that difference is minutes at scale.
	const [placedLogs, matchedLogs, resolvedLogs, claimedLogs] = await Promise.all([
		pub.getLogs({ address: addresses, event: orderPlaced, fromBlock: from, toBlock: to }),
		pub.getLogs({ address: addresses, event: matched, fromBlock: from, toBlock: to }),
		pub.getLogs({ address: addresses, event: resolved, fromBlock: from, toBlock: to }),
		pub.getLogs({ address: addresses, event: claimed, fromBlock: from, toBlock: to }),
	])

	for (const log of placedLogs) {
		const at = await blockTime(log.blockNumber!)
		const maker = (log.args.maker as Address).toLowerCase()
		await touchTrader(maker, at)
		await db
			.insert(orders)
			.values({
				market: log.address.toLowerCase(),
				maker,
				tick: Number(log.args.tick),
				isYes: log.args.isYes as boolean,
				indexInBook: Number(log.args.index),
				shares: (log.args.shares as bigint).toString(),
				paid: (log.args.paid as bigint).toString(),
				blockNumber: log.blockNumber!,
				logIndex: log.logIndex!,
				txHash: log.transactionHash!,
				at,
			})
			.onConflictDoNothing()
		await db
			.update(traders)
			.set({ stakedWei: sql`${traders.stakedWei} + ${(log.args.paid as bigint).toString()}::numeric` })
			.where(sql`${traders.address} = ${maker}`)
		stats.orders++
	}

	for (const log of matchedLogs) {
		const at = await blockTime(log.blockNumber!)
		const matcher = (log.args.matcher as Address).toLowerCase()
		await db
			.insert(matches)
			.values({
				market: log.address.toLowerCase(),
				tick: Number(log.args.tick),
				shares: (log.args.shares as bigint).toString(),
				tickTotal: (log.args.tickTotal as bigint).toString(),
				matcher,
				blockNumber: log.blockNumber!,
				logIndex: log.logIndex!,
				txHash: log.transactionHash!,
				at,
			})
			.onConflictDoNothing()
		await db
			.update(markets)
			.set({ matchedWei: sql`${markets.matchedWei} + ${(log.args.shares as bigint).toString()}::numeric` })
			.where(sql`${markets.address} = ${log.address.toLowerCase()}`)
		await touchTrader(matcher, at)
		await db
			.update(traders)
			.set({ cranksLanded: sql`${traders.cranksLanded} + 1` })
			.where(sql`${traders.address} = ${matcher}`)
		stats.matches++
	}

	for (const log of resolvedLogs) {
		await db
			.update(markets)
			.set({ outcome: Number(log.args.outcome), resolvedAt: await blockTime(log.blockNumber!) })
			.where(sql`${markets.address} = ${log.address.toLowerCase()}`)
		stats.resolutions++
	}

	for (const log of claimedLogs) {
		const at = await blockTime(log.blockNumber!)
		const who = (log.args.who as Address).toLowerCase()
		await db
			.insert(claims)
			.values({
				market: log.address.toLowerCase(),
				who,
				net: (log.args.net as bigint).toString(),
				fee: (log.args.fee as bigint).toString(),
				blockNumber: log.blockNumber!,
				logIndex: log.logIndex!,
				txHash: log.transactionHash!,
				at,
			})
			.onConflictDoNothing()
		await touchTrader(who, at)
		await db
			.update(traders)
			.set({
				returnedWei: sql`${traders.returnedWei} + ${(log.args.net as bigint).toString()}::numeric`,
				feesPaidWei: sql`${traders.feesPaidWei} + ${(log.args.fee as bigint).toString()}::numeric`,
				roundsWon: sql`${traders.roundsWon} + 1`,
			})
			.where(sql`${traders.address} = ${who}`)
		stats.claims++
	}
}

async function main() {
	if (!process.env.DATABASE_URL) {
		console.error("DATABASE_URL is not set. The indexer is optional \u2014 the app reads live state from the chain")
		console.error("directly and works without it. Set DATABASE_URL to enable history and the leaderboard.")
		process.exit(1)
	}

	await loadKnown()
	console.log(`indexer up \u00b7 factory ${config.factory} \u00b7 ${known.size} markets known`)

	let stopping = false
	process.on("SIGINT", () => {
		stopping = true
	})
	process.on("SIGTERM", () => {
		stopping = true
	})

	while (!stopping) {
		try {
			const head = await pub.getBlockNumber()
			const saved = await readCursor()
			// Always step back a little: cheap, and it makes reorgs a non-event.
			const from = saved > REORG_DEPTH ? saved - REORG_DEPTH : 0n
			const to = from + WINDOW < head ? from + WINDOW : head

			if (to > from) {
				await indexRange(from, to)
				await writeCursor(to)
				stats.passes++
				if (stats.passes % 20 === 0) console.log(`\u2192 block ${to} \u00b7 ${JSON.stringify(stats)}`)
			}

			// Caught up? Breathe. Behind? Go straight round again.
			if (to >= head) await new Promise((r) => setTimeout(r, POLL_MS))
		} catch (err) {
			console.error("pass failed:", err instanceof Error ? err.message.slice(0, 200) : err)
			await new Promise((r) => setTimeout(r, 2_000))
		}
	}

	console.log("shutting down", JSON.stringify(stats))
	await pool.end()
	process.exit(0)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
