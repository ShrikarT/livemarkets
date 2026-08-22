"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Address } from "viem"

import { marketAbi } from "./abi"
import { publicClient } from "./market-client"
import { NUM_TICKS } from "./market-math"

/**
 * How much of YOUR size is still resting, per tick, per side.
 *
 * WHY THIS EXISTS
 *
 * A limit book without your own orders drawn on it is unusable. You cannot tell
 * whether the 40 shares sitting at 0.55 are yours or somebody else's, so you
 * cannot tell whether to cancel, whether you are already in the queue, or
 * whether the thing you are about to place is a duplicate. The ladder draws a
 * marker for your resting size, and this is where that number comes from.
 *
 * WHY IT IS NOT SIMPLY POLLED
 *
 * openOrdersOf is per tick AND per side, so a full picture is 19 x 2 = 38
 * eth_calls. Polling that once a second is 38 calls/sec for one trader, which
 * is worse than the per-viewer streaming bug this project just removed -- and
 * it would be worse per person, not just in aggregate.
 *
 * The observation that fixes it: you can only have orders where you PLACED
 * orders, and that is a handful of ticks out of nineteen, known after one sweep.
 * So we sweep all 38 once on mount, remember which ticks came back non-empty,
 * and from then on re-read only those plus the tick the ticket is pointing at.
 * Steady state is 2-8 calls every four seconds instead of 38 every second.
 *
 * The focusTick is what keeps it correct rather than merely cheap: a tick you
 * have never used is not in the watched set, so without it your first order at
 * a new price would stay invisible until a remount.
 */

/** Personal state only changes when you act, so it does not need a fast clock. */
const POLL_MS = 4_000

export type MyOrders = {
	/** resting yes size by tick index; 0n where you have none */
	yes: bigint[]
	no: bigint[]
	/** re-read now, optionally forcing a tick into the watched set */
	refresh: (tick?: number) => void
	loading: boolean
}

const empty = () => new Array<bigint>(NUM_TICKS).fill(0n)

/**
 * openOrdersOf returns the caller's live orders at a tick. We only need the
 * total still resting, and the exact tuple shape is a detail of the ABI, so this
 * reduces whatever comes back to one number rather than assuming a layout.
 */
function totalRemaining(result: unknown): bigint {
	if (typeof result === "bigint") return result
	if (Array.isArray(result)) {
		let sum = 0n
		for (const item of result) {
			if (typeof item === "bigint") sum += item
			else if (Array.isArray(item)) {
				for (const inner of item) if (typeof inner === "bigint") sum += inner
			}
		}
		return sum
	}
	return 0n
}

export function useMyOrders(
	market: Address,
	who: Address | undefined,
	opts: { enabled?: boolean; focusTick?: number } = {},
): MyOrders {
	const { enabled = true, focusTick } = opts
	const [yes, setYes] = useState<bigint[]>(empty)
	const [no, setNo] = useState<bigint[]>(empty)
	const [loading, setLoading] = useState(false)

	/** Ticks worth re-reading: everywhere you have ever had size. */
	const watched = useRef<Set<number>>(new Set())
	const sweptFor = useRef<string>("")
	const [nonce, setNonce] = useState(0)

	const readTicks = useCallback(
		async (ticks: number[]) => {
			if (!who || ticks.length === 0) return
			const calls = ticks.flatMap((tick) =>
				[true, false].map(async (isYes) => {
					try {
						const res = await publicClient.readContract({
							address: market,
							abi: marketAbi,
							functionName: "openOrdersOf",
							args: [tick, isYes, who],
						})
						return { tick, isYes, size: totalRemaining(res) }
					} catch {
						// One failed leg must not blank the whole ladder.
						return null
					}
				}),
			)
			const results = await Promise.all(calls)
			const nextYes = new Map<number, bigint>()
			const nextNo = new Map<number, bigint>()
			for (const r of results) {
				if (!r) continue
				if (r.size > 0n) watched.current.add(r.tick)
				;(r.isYes ? nextYes : nextNo).set(r.tick, r.size)
			}
			// Merge rather than replace: a partial read must not erase ticks it did
			// not look at.
			setYes((prev) => {
				const out = prev.slice()
				for (const [tick, size] of nextYes) out[tick] = size
				return out
			})
			setNo((prev) => {
				const out = prev.slice()
				for (const [tick, size] of nextNo) out[tick] = size
				return out
			})
		},
		[market, who],
	)

	const refresh = useCallback(
		(tick?: number) => {
			// A tick you just traded is worth watching even if it came back empty --
			// the fill may not be visible for another block.
			if (typeof tick === "number") watched.current.add(tick)
			setNonce((n) => n + 1)
		},
		[],
	)

	// The one full sweep, per (market, account) pair.
	useEffect(() => {
		if (!enabled || !who) {
			setYes(empty())
			setNo(empty())
			watched.current = new Set()
			sweptFor.current = ""
			return
		}
		const key = `${market}:${who}`
		if (sweptFor.current === key) return
		sweptFor.current = key
		watched.current = new Set()
		setLoading(true)
		void readTicks(Array.from({ length: NUM_TICKS }, (_, i) => i)).finally(() => setLoading(false))
	}, [enabled, market, who, readTicks])

	// The cheap steady state: watched ticks plus wherever the ticket is aimed.
	useEffect(() => {
		if (!enabled || !who) return
		const targets = () => {
			const set = new Set(watched.current)
			if (typeof focusTick === "number") set.add(focusTick)
			return Array.from(set)
		}
		void readTicks(targets())
		const timer = setInterval(() => {
			// A backgrounded tab is not a trader.
			if (typeof document !== "undefined" && document.hidden) return
			void readTicks(targets())
		}, POLL_MS)
		return () => clearInterval(timer)
	}, [enabled, who, focusTick, nonce, readTicks])

	return { yes, no, refresh, loading }
}
