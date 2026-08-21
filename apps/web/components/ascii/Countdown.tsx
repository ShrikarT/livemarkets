"use client"

import { useEffect, useRef, useState } from "react"

import { PHASE } from "../../lib/abi"

/**
 * The countdown.
 *
 * Steps in whole characters. A progress bar that eases between cells implies the
 * deadline is soft; it is not. The bar loses one cell at a time, the seconds are
 * tabular so nothing reflows, and at zero it does not sit at 00 pretending to be
 * live — it says LOCKED, then RESOLVING.
 */

const CELLS = 24

export type CountdownProps = {
	/** unix seconds when trading closes */
	openUntil: number
	/** unix seconds when the outcome can be submitted */
	resolveAfter: number
	/** 0 Open, 1 Locked, 2 Resolved */
	phase: number
	label?: string
	/** how long the trading window was, in seconds, when the caller knows it */
	windowSec?: number
}

function useNow(intervalMs = 250) {
	const [now, setNow] = useState(() => Date.now())
	useEffect(() => {
		// Repaint 4x a second: fast enough that the seconds never look stuck, slow
		// enough to be free. Pause entirely when the tab is hidden.
		let id: ReturnType<typeof setInterval> | undefined
		const start = () => {
			stop()
			id = setInterval(() => setNow(Date.now()), intervalMs)
		}
		const stop = () => {
			if (id) clearInterval(id)
			id = undefined
		}
		const onVis = () => (document.hidden ? stop() : (setNow(Date.now()), start()))
		start()
		document.addEventListener("visibilitychange", onVis)
		return () => {
			stop()
			document.removeEventListener("visibilitychange", onVis)
		}
	}, [intervalMs])
	return now
}

export function Countdown({ openUntil, resolveAfter, phase, label, windowSec }: CountdownProps) {
	const now = useNow()
	const nowSec = Math.floor(now / 1000)

	// The trading window is NOT derivable from these two timestamps: resolveAfter
	// minus openUntil is the resolve delay, not the window. So either the caller
	// tells us, or we calibrate on the longest remaining time we have seen, which
	// makes the bar deplete honestly from whenever it mounted.
	const peak = useRef(0)
	const left = Math.max(0, openUntil - nowSec)
	if (left > peak.current) peak.current = left
	const total = Math.max(1, windowSec ?? peak.current)

	if (phase === PHASE.Resolved) {
		return <Bar filled={0} text="SETTLED" tone="muted" label={label} />
	}

	if (phase === PHASE.Locked || nowSec >= openUntil) {
		const untilResolve = Math.max(0, resolveAfter - nowSec)
		if (untilResolve === 0) {
			// The resolver is late, or is mid-transaction. Say so rather than showing
			// a frozen zero.
			return <Bar filled={0} text="RESOLVING" tone="no" label={label} />
		}
		return <Bar filled={0} text={`LOCKED · ${fmt(untilResolve)} TO RESOLVE`} tone="no" label={label} />
	}

	const filled = Math.round((left / total) * CELLS)

	return <Bar filled={filled} text={`${fmt(left)} OPEN`} tone="yes" label={label} />
}

function fmt(sec: number): string {
	const m = Math.floor(sec / 60)
	const s = sec % 60
	return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${String(s).padStart(2, "0")}s`
}

function Bar({
	filled,
	text,
	tone,
	label,
}: {
	filled: number
	text: string
	tone: "yes" | "no" | "muted"
	label?: string
}) {
	const n = Math.max(0, Math.min(CELLS, filled))
	const color = tone === "yes" ? "var(--yes)" : tone === "no" ? "var(--no)" : "var(--fg-muted)"
	return (
		<div>
			{label ? <div className="label" style={{ marginBottom: "var(--s1)" }}>{label}</div> : null}
			<div style={{ display: "flex", alignItems: "center", gap: "var(--s3)" }}>
				<div className="ascii" aria-hidden="true" style={{ color }}>
					{`[${"█".repeat(n)}${"·".repeat(CELLS - n)}]`}
				</div>
				<div className="label" style={{ color, letterSpacing: "0.1em" }} role="timer" aria-live="off">
					{text}
				</div>
			</div>
		</div>
	)
}
