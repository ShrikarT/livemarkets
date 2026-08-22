"use client"

import { useEffect, useState } from "react"

import { PHASE } from "../../lib/abi"

/**
 * TWO CLOCKS. ALWAYS. EVERYWHERE.
 *
 * This is a correctness feature, not decoration.
 *
 * ORDERS CLOSE is the only number that decides whether you may trade.
 * RESOLVES is the number that decides when you get paid.
 *
 * Showing one number lets a viewer on a 30-second-delayed broadcast believe they
 * still have time on a market whose outcome has already happened on somebody
 * else's feed. Whoever has the fastest feed then trades against a known result
 * and the book drains until only fast-feed operators are left. So: both clocks on
 * the market card, on the list strip, on the market page header, and on the OG
 * image. If a surface shows one number, that surface is wrong.
 *
 * The app clock is the authority. Not the picture, not the platform overlay.
 */

const CELLS = 24

export type ClocksProps = {
	/** unix seconds when trading closes */
	openUntil: number
	/** unix seconds when the outcome can be submitted */
	resolveAfter: number
	/** 0 Open, 1 Locked, 2 Resolved */
	phase: number
	/**
	 * unix seconds at which the interval this market is about begins. Trading is
	 * shut from this moment even if openUntil has not passed.
	 */
	resolvingStartsAt?: number
	/** how long the trading window was, in seconds, when the caller knows it */
	windowSec?: number
	/** compact for a list card, stacked with a depleting bar for a hero */
	size?: "row" | "stack"
	outcomeLabel?: string
}

export function useNowSec(intervalMs = 250): number {
	const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
	useEffect(() => {
		// Repaint 4x a second: fast enough that the seconds never look stuck, slow
		// enough to be free. Pause entirely when the tab is hidden.
		let id: ReturnType<typeof setInterval> | undefined
		const stop = () => {
			if (id) clearInterval(id)
			id = undefined
		}
		const start = () => {
			stop()
			id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs)
		}
		const onVis = () => {
			if (document.hidden) {
				stop()
			} else {
				setNow(Math.floor(Date.now() / 1000))
				start()
			}
		}
		start()
		document.addEventListener("visibilitychange", onVis)
		return () => {
			stop()
			document.removeEventListener("visibilitychange", onVis)
		}
	}, [intervalMs])
	return now
}

/** mm:ss, always two digits, always tabular. Never "3s" then "12s" -- that jumps. */
export function mmss(sec: number): string {
	const s = Math.max(0, Math.floor(sec))
	return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}

/**
 * The gate, exported so the ticket and the ladder use exactly the same predicate
 * the clock displays. Two copies of "is this tradeable" is how one of them ends up
 * wrong.
 */
export function isClosed(args: {
	phase: number
	openUntil: number
	resolvingStartsAt?: number
	nowSec: number
}): boolean {
	if (args.phase !== PHASE.Open) return true
	if (args.nowSec >= args.openUntil) return true
	if (args.resolvingStartsAt !== undefined && args.nowSec >= args.resolvingStartsAt) return true
	return false
}

export function Clocks({
	openUntil,
	resolveAfter,
	phase,
	resolvingStartsAt,
	windowSec,
	size = "row",
	outcomeLabel,
}: ClocksProps) {
	const nowSec = useNowSec()

	const toClose = Math.max(0, openUntil - nowSec)
	const toResolve = Math.max(0, resolveAfter - nowSec)

	const intervalStarted = resolvingStartsAt !== undefined && nowSec >= resolvingStartsAt
	const closed = isClosed({ phase, openUntil, resolvingStartsAt, nowSec })
	const settled = phase === PHASE.Resolved

	const closeText = settled
		? "CLOSED"
		: intervalStarted && phase === PHASE.Open
			? "INTERVAL STARTED"
			: closed
				? "CLOSED"
				: mmss(toClose)

	const resolveText = settled ? (outcomeLabel ?? "SETTLED").toUpperCase() : toResolve === 0 ? "RESOLVING" : mmss(toResolve)

	const valueSize = size === "stack" ? "var(--t-h3)" : "var(--t-lead)"

	return (
		<div className="clocks" role="group" aria-label="market clocks">
			<div className="clock">
				<span className="label">orders close</span>
				<span
					className="clock-value num"
					style={ { fontSize: valueSize, color: closed ? "var(--fg-muted)" : "var(--fg)" } }
					role="timer"
				>
					{closeText}
				</span>
			</div>

			<div className="clock">
				<span className="label">resolves</span>
				<span
					className="clock-value num"
					style={ { fontSize: valueSize, color: settled ? "var(--fg-muted)" : "var(--fg)" } }
					role="timer"
				>
					{resolveText}
				</span>
			</div>

			{size === "stack" ? <ProgressBar left={toClose} windowSec={windowSec} closed={closed} settled={settled} /> : null}
		</div>
	)
}

/**
 * The depleting bar. Steps in whole characters -- a bar that eases between cells
 * implies the deadline is soft, and it is not.
 *
 * ASCII ONLY. The heavy block glyph V1 used falls out to a substitute font on
 * several platforms, at a different advance, which shears the row it sits in.
 */
function ProgressBar({
	left,
	windowSec,
	closed,
	settled,
}: {
	left: number
	windowSec?: number
	closed: boolean
	settled: boolean
}) {
	// The window is NOT derivable from openUntil and resolveAfter: their difference
	// is the resolve delay, not the trading window. Either the caller knows it, or
	// we calibrate on the longest remaining time seen since mount so the bar
	// depletes honestly instead of sitting at one cell forever. (V1 computed this
	// as `Math.max(1, openUntil - (resolveAfter - (resolveAfter - openUntil)))`,
	// which algebraically collapses to 1, so the bar never moved.)
	const [peak, setPeak] = useState(0)
	useEffect(() => {
		setPeak((p) => (left > p ? left : p))
	}, [left])

	const total = Math.max(1, windowSec ?? peak ?? 1)
	const n = closed || settled ? 0 : Math.max(0, Math.min(CELLS, Math.round((left / total) * CELLS)))
	const color = settled ? "var(--fg-muted)" : closed ? "var(--no)" : "var(--yes)"

	return (
		<div className="ascii" aria-hidden="true" style={ { color, flexBasis: "100%" } }>
			{`[${"=".repeat(n)}${".".repeat(CELLS - n)}]`}
		</div>
	)
}
