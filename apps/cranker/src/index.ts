/**
 * The cranker.
 *
 * Matching is permissionless in this protocol, which means it is nobody's job,
 * which means it needs somebody to actually do it. This is that somebody: a plain
 * Node loop that every 600ms
 *
 *   1. pokes any series whose next round is due,
 *   2. reads each live market's book in one call,
 *   3. fires matchTick() at every tick that has both sides resting — all of them
 *      concurrently, with pre-computed nonces,
 *   4. collects its crank rewards,
 *   5. auto-resolves only the questions that are derivable from chain data, and
 *      leaves everything else to a human.
 *
 * Two decisions worth calling out.
 *
 * SKIPPING EMPTY TICKS. Firing all 19 ticks unconditionally is simpler and about
 * ten times more expensive: a matchTick on an empty level still costs a call and a
 * cold SLOAD. Reading book() first is one eth_call and removes ~90% of the
 * transactions in a normal round.
 *
 * PRE-COMPUTED NONCES. If you await each send, you have re-serialised the exact
 * work the contracts were sharded to parallelise — the chain could run them at
 * once but your client is feeding them in one at a time. Fetching the nonce once
 * and assigning base+i lets all of them go out together.
 */

import {
	createPublicClient,
	createWalletClient,
	http,
	type Address,
	type PublicClient,
	type WalletClient,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"

import { factoryAbi, marketAbi, seriesAbi } from "./abi.js"
import { chain, config } from "./config.js"
import { deriveOutcome } from "./oracle.js"
import { runHouseMaker } from "./house-maker.js"

type Tick = {
	openYes: bigint
	openNo: bigint
	matched: bigint
	feeAcc: bigint
	crankAcc: bigint
	yesCursor: number
	noCursor: number
	cranker: Address
}

const MATCH_STEPS = 64

const stats = {
	loops: 0,
	pokes: 0,
	matchTxs: 0,
	matchesSkipped: 0,
	resolved: 0,
	rewardsClaimed: 0,
	errors: 0,
	startedAt: Date.now(),
}

function log(...args: unknown[]) {
	const t = ((Date.now() - stats.startedAt) / 1000).toFixed(1).padStart(7)
	console.log(`[${t}s]`, ...args)
}

/** Poke every series whose next round is due. This is what keeps markets existing. */
async function pokeSeries(pub: PublicClient, wallet: WalletClient, account: Address) {
	const list = (await pub.readContract({
		address: config.factory,
		abi: factoryAbi,
		functionName: "allSeries",
	})) as readonly Address[]

	const due: Address[] = []
	await Promise.all(
		list.map(async (s) => {
			const ok = (await pub.readContract({ address: s, abi: seriesAbi, functionName: "pokeable" })) as boolean
			if (ok) due.push(s)
		}),
	)
	if (due.length === 0) return

	// Independent contracts, so these can all go at once too.
	const base = await pub.getTransactionCount({ address: account, blockTag: "pending" })
	const results = await Promise.allSettled(
		due.map((s, i) =>
			wallet.writeContract({
				chain,
				account,
				address: s,
				abi: seriesAbi,
				functionName: "poke",
				nonce: base + i,
			}),
		),
	)
	const ok = results.filter((r) => r.status === "fulfilled").length
	stats.pokes += ok
	if (ok) log(`poked ${ok}/${due.length} series \u2192 new rounds open`)
}

/**
 * Match every crossable tick on one market, concurrently.
 * Returns the number of transactions actually sent.
 */
async function crankMarket(
	pub: PublicClient,
	wallet: WalletClient,
	account: Address,
	market: Address,
): Promise<number> {
	const book = (await pub.readContract({ address: market, abi: marketAbi, functionName: "book" })) as readonly Tick[]

	// A tick can only match if BOTH sides are resting there. Anything else is a
	// guaranteed no-op that still costs gas.
	const crossable: number[] = []
	for (let i = 0; i < book.length; i++) {
		const t = book[i]!
		if (t.openYes > 0n && t.openNo > 0n) crossable.push(i)
		else stats.matchesSkipped++
	}
	if (crossable.length === 0) return 0

	const base = await pub.getTransactionCount({ address: account, blockTag: "pending" })

	// The whole point of the project, in five lines: N independent transactions,
	// N disjoint storage regions, one round trip.
	const sent = await Promise.allSettled(
		crossable.map((tick, i) =>
			wallet.writeContract({
				chain,
				account,
				address: market,
				abi: marketAbi,
				functionName: "matchTick",
				args: [tick, MATCH_STEPS],
				nonce: base + i,
			}),
		),
	)

	const ok = sent.filter((r) => r.status === "fulfilled").length
	stats.matchTxs += ok
	stats.errors += sent.length - ok
	if (ok) log(`${market.slice(0, 8)} matched ${ok} ticks in parallel [${crossable.join(",")}]`)
	return ok
}

/** Collect what this cranker has earned. Batched, because it is not urgent. */
async function collectRewards(pub: PublicClient, wallet: WalletClient, account: Address, market: Address) {
	const book = (await pub.readContract({ address: market, abi: marketAbi, functionName: "book" })) as readonly Tick[]
	const mine = book
		.map((t, i) => ({ t, i }))
		.filter(({ t }) => t.crankAcc > 0n && t.cranker.toLowerCase() === account.toLowerCase())
		.map(({ i }) => i)
	if (mine.length === 0) return

	const base = await pub.getTransactionCount({ address: account, blockTag: "pending" })
	const res = await Promise.allSettled(
		mine.map((tick, i) =>
			wallet.writeContract({
				chain,
				account,
				address: market,
				abi: marketAbi,
				functionName: "payCrankReward",
				args: [tick],
				nonce: base + i,
			}),
		),
	)
	const ok = res.filter((r) => r.status === "fulfilled").length
	stats.rewardsClaimed += ok
	if (ok) log(`claimed crank rewards on ${ok} ticks`)
}

/**
 * Resolve only what can be derived from the chain itself. Anything requiring
 * judgement is left for the human console — a bot guessing an outcome is worse
 * than a market settling late.
 */
async function autoResolve(pub: PublicClient, market: Address) {
	if (!config.resolverKey) return

	const [phase, outcome, question, resolveAfter] = await Promise.all([
		pub.readContract({ address: market, abi: marketAbi, functionName: "phase" }),
		pub.readContract({ address: market, abi: marketAbi, functionName: "outcome" }),
		pub.readContract({ address: market, abi: marketAbi, functionName: "question" }),
		pub.readContract({ address: market, abi: marketAbi, functionName: "resolveAfter" }),
	])

	if (Number(outcome) !== 0) return // already settled
	if (Number(phase) === 0) return // still taking orders
	const now = Math.floor(Date.now() / 1000)
	if (now < Number(resolveAfter)) return // resolve() would revert with TooEarly

	const decided = await deriveOutcome(pub, question as string, market)
	if (decided === null) {
		log(`${market.slice(0, 8)} needs a human: "${(question as string).slice(0, 48)}"`)
		return
	}

	const resolver = privateKeyToAccount(config.resolverKey)
	const rw = createWalletClient({ account: resolver, chain, transport: http(config.rpcUrl) })
	try {
		await rw.writeContract({ chain, account: resolver, address: market, abi: marketAbi, functionName: "resolve", args: [decided] })
		stats.resolved++
		log(`${market.slice(0, 8)} resolved ${["", "yes", "no", "void"][decided]} (derived from chain data)`)
	} catch (err) {
		stats.errors++
		log(`resolve failed on ${market.slice(0, 8)}:`, err instanceof Error ? err.message.slice(0, 120) : err)
	}
}

async function loop(pub: PublicClient, wallet: WalletClient, account: Address) {
	stats.loops++

	await pokeSeries(pub, wallet, account)

	const markets = (await pub.readContract({
		address: config.factory,
		abi: factoryAbi,
		functionName: "recent",
		args: [8n],
	})) as readonly Address[]

	// Markets are separate contracts, so cranking several at once is free
	// parallelism on top of the per-tick parallelism inside each one.
	await Promise.allSettled(markets.map((m) => crankMarket(pub, wallet, account, m)))
	await Promise.allSettled(markets.map((m) => autoResolve(pub, m)))

	// Rewards and the maker are not time-critical; run them on a slower cadence.
	if (stats.loops % 20 === 0) {
		await Promise.allSettled(markets.map((m) => collectRewards(pub, wallet, account, m)))
	}
	if (config.houseMaker.enabled && stats.loops % 3 === 0) {
		await runHouseMaker(pub, markets)
	}
}

async function main() {
	const once = process.argv.includes("--once")

	const account = privateKeyToAccount(config.crankKey)
	const pub = createPublicClient({ chain, transport: http(config.rpcUrl) })
	const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) })

	const balance = await pub.getBalance({ address: account.address })
	log(`cranker ${account.address} \u00b7 ${(Number(balance) / 1e18).toFixed(3)} MON \u00b7 factory ${config.factory}`)
	if (balance === 0n) {
		console.error("cranker has no MON. Fund it at https://faucet.monad.xyz and restart.")
		process.exit(1)
	}

	let stopping = false
	const stop = () => {
		if (stopping) process.exit(0)
		stopping = true
		log("stopping \u2014 stats:", JSON.stringify(stats))
	}
	process.on("SIGINT", stop)
	process.on("SIGTERM", stop)

	do {
		const started = Date.now()
		try {
			await loop(pub, wallet, account.address)
		} catch (err) {
			stats.errors++
			log("loop error:", err instanceof Error ? err.message.slice(0, 160) : err)
		}
		if (once || stopping) break
		// Sleep the remainder of the interval rather than a fixed delay, so a slow
		// loop does not drift the schedule later and later.
		const spent = Date.now() - started
		await new Promise((r) => setTimeout(r, Math.max(0, config.intervalMs - spent)))
	} while (!stopping)

	log("final:", JSON.stringify(stats))
	process.exit(0)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
