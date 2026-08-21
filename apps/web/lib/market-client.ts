import { createPublicClient, http, type Address } from "viem"

import { activeChain } from "../config/chains"
import { contracts } from "../config/contracts"
import { factoryAbi, marketAbi, seriesAbi } from "./abi"
import type { TickLevel } from "./market-math"

/**
 * Read layer.
 *
 * Every read in this file is one RPC call, on purpose. On a chain with 400ms
 * blocks, the bottleneck is round trips, not compute, so the contracts expose
 * batched views (snapshot, book, recent) and this file uses them instead of
 * looping in JavaScript.
 */

const ZERO = "0x0000000000000000000000000000000000000000" as const

export const publicClient = createPublicClient({
	chain: activeChain,
	transport: http(undefined, {
		// A stale quote is worse than a missing one.
		batch: { wait: 8 },
		retryCount: 2,
		retryDelay: 120,
	}),
})

export type MarketSnapshot = {
	address: Address
	question: string
	phase: number
	outcome: number
	openUntil: number
	resolveAfter: number
	impliedBps: bigint
	balanceWei: bigint
	levels: TickLevel[]
	yesPositions: bigint[]
	noPositions: bigint[]
}

type RawTick = {
	openYes: bigint
	openNo: bigint
	matched: bigint
	feeAcc: bigint
	crankAcc: bigint
	yesCursor: number
	noCursor: number
	cranker: Address
}

function toLevels(raw: readonly RawTick[]): TickLevel[] {
	return raw.map((t) => ({ openYes: t.openYes, openNo: t.openNo, matched: t.matched }))
}

/** One market, one eth_call. `who` may be omitted in watch mode. */
export async function readSnapshot(address: Address, who?: Address): Promise<MarketSnapshot> {
	const r = await publicClient.readContract({
		address,
		abi: marketAbi,
		functionName: "snapshot",
		args: [who ?? ZERO],
	})

	const [q, ph, oc, openUntil, resolveAfter, implied, userBalance, levels, yesPositions, noPositions] = r

	return {
		address,
		question: q,
		phase: Number(ph),
		outcome: Number(oc),
		openUntil: Number(openUntil),
		resolveAfter: Number(resolveAfter),
		impliedBps: implied,
		balanceWei: userBalance,
		levels: toLevels(levels as readonly RawTick[]),
		yesPositions: [...(yesPositions as readonly bigint[])],
		noPositions: [...(noPositions as readonly bigint[])],
	}
}

/**
 * The newest `n` markets, straight from the factory.
 *
 * The factory is the only discovery root in the system. No hardcoded market
 * lists, no "featured" array in a config file that goes stale the moment a round
 * rolls over.
 */
export async function listRecentMarkets(n = 12): Promise<Address[]> {
	const out = await publicClient.readContract({
		address: contracts.factory,
		abi: factoryAbi,
		functionName: "recent",
		args: [BigInt(n)],
	})
	return [...out] as Address[]
}

/** Snapshots for the market list, fetched concurrently rather than in sequence. */
export async function readMarketList(n = 12, who?: Address): Promise<MarketSnapshot[]> {
	const addresses = await listRecentMarkets(n)
	const settled = await Promise.allSettled(addresses.map((a) => readSnapshot(a, who)))
	// One dead market must not blank the whole list.
	return settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []))
}

export type SeriesInfo = {
	address: Address
	question: string
	current: Address
	round: bigint
	pokeable: boolean
	nextStart: number
	stopped: boolean
}

export async function readSeries(address: Address): Promise<SeriesInfo> {
	const [question, current, count, pokeable, nextStart, stopped] = await Promise.all([
		publicClient.readContract({ address, abi: seriesAbi, functionName: "question" }),
		publicClient.readContract({ address, abi: seriesAbi, functionName: "current" }),
		publicClient.readContract({ address, abi: seriesAbi, functionName: "count" }),
		publicClient.readContract({ address, abi: seriesAbi, functionName: "pokeable" }),
		publicClient.readContract({ address, abi: seriesAbi, functionName: "nextStart" }),
		publicClient.readContract({ address, abi: seriesAbi, functionName: "stopped" }),
	])
	return {
		address,
		question,
		current: current as Address,
		round: count,
		pokeable,
		nextStart: Number(nextStart),
		stopped,
	}
}

export async function readAllSeries(): Promise<SeriesInfo[]> {
	const list = await publicClient.readContract({
		address: contracts.factory,
		abi: factoryAbi,
		functionName: "allSeries",
	})
	const settled = await Promise.allSettled((list as readonly Address[]).map(readSeries))
	return settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []))
}

/** Total matched volume across a book, for the market card and the landing counter. */
export function totalMatched(levels: readonly TickLevel[]): bigint {
	let sum = 0n
	for (const l of levels) sum += l.matched
	return sum
}

/** Does this address hold anything that can still be claimed? */
export function hasPosition(s: MarketSnapshot): boolean {
	return s.yesPositions.some((v) => v > 0n) || s.noPositions.some((v) => v > 0n)
}
