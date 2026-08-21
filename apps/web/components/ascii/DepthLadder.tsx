"use client"

import { useMemo, useRef } from "react"

import { NUM_TICKS, formatBps, formatWad, price, tickForBps, type TickLevel } from "../../lib/market-math"

/**
 * The book, as a depth ladder.
 *
 * Design decisions that matter here:
 *   - 19 ticks is too many to show at once and reads as noise. Show ticks that
 *     have volume, plus a two-tick window either side of the implied price, so
 *     there is always somewhere to place the first order in an empty book.
 *   - Bars are drawn in whole characters. A bar that eases between widths implies
 *     the fill was gradual; fills are atomic.
 *   - A row is a control. Clicking it loads that tick into the order ticket,
 *     because the sentence "I want this price" should be one gesture.
 *   - YES and NO get the two spot colours and nothing else does, so colour always
 *     means side.
 */

const BAR_CELLS = 14

export type DepthLadderProps = {
	levels: readonly TickLevel[]
	impliedBps: bigint
	selectedTick?: number
	onPickTick?: (tick: number) => void
	/** disable interaction once trading has closed */
	interactive?: boolean
}

function bar(value: bigint, max: bigint, cells = BAR_CELLS): string {
	if (max <= 0n) return ""
	// integer maths, then floor: a bar never rounds itself up into looking deeper
	// than the book actually is
	const n = Number((value * BigInt(cells)) / max)
	return "█".repeat(Math.max(value > 0n ? 1 : 0, Math.min(cells, n)))
}

export function DepthLadder({
	levels,
	impliedBps,
	selectedTick,
	onPickTick,
	interactive = true,
}: DepthLadderProps) {
	// Remember the previous depth per tick so a change can flash exactly one cell
	// rather than re-animating the whole ladder.
	const prev = useRef<Map<number, string>>(new Map())

	const { rows, max, isEmpty } = useMemo(() => {
		const mid = tickForBps(impliedBps)
		const keep = new Set<number>()
		for (let i = 0; i < NUM_TICKS; i++) {
			const l = levels[i]
			const hasVolume = l ? l.openYes > 0n || l.openNo > 0n || l.matched > 0n : false
			if (hasVolume) keep.add(i)
		}
		const empty = keep.size === 0
		// always leave a landing strip around the implied price
		for (let d = -2; d <= 2; d++) {
			const t = mid + d
			if (t >= 0 && t < NUM_TICKS) keep.add(t)
		}

		const list = [...keep].sort((a, b) => b - a) // high price at the top, like every book
		let m = 0n
		for (const t of list) {
			const l = levels[t]
			if (!l) continue
			if (l.openYes > m) m = l.openYes
			if (l.openNo > m) m = l.openNo
			if (l.matched > m) m = l.matched
		}
		return { rows: list, max: m, isEmpty: empty }
	}, [levels, impliedBps])

	return (
		<div className="panel">
			<div className="panel-head">
				<span className="label">Book</span>
				<span className="label">
					implied <span style={{ color: "var(--fg)" }}>{formatBps(impliedBps)}</span>
				</span>
			</div>

			{isEmpty ? (
				<div className="panel-body">
					{/*
					  The empty book is the state a new market spends its first seconds in,
					  and the state a demo is most likely to be caught in. It gets a real
					  design, not a spinner: it explains what happens next and invites the
					  first order.
					*/}
					<div className="ascii muted" aria-hidden="true" style={{ marginBottom: "var(--s3)" }}>
						{"┌" + "─".repeat(34) + "┐\n"}
						{"│" + " ".repeat(34) + "│\n"}
						{"│   no orders resting yet          │\n"}
						{"│   the first quote sets the price │\n"}
						{"│" + " ".repeat(34) + "│\n"}
						{"└" + "─".repeat(34) + "┘"}
					</div>
					<p className="muted" style={{ margin: 0, fontSize: "var(--t-small)" }}>
						Pick a price below and place the first order. Until someone quotes both sides, the
						implied probability is a coin flip.
					</p>
				</div>
			) : null}

			<table className="table">
				<thead>
					<tr>
						<th>Price</th>
						<th className="r">Yes</th>
						<th>Depth</th>
						<th className="r">No</th>
						<th className="r">Matched</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((t) => {
						const l = levels[t] ?? { openYes: 0n, openNo: 0n, matched: 0n }
						const yesBar = bar(l.openYes, max)
						const noBar = bar(l.openNo, max)
						const sig = `${l.openYes}:${l.openNo}:${l.matched}`
						const changed = prev.current.has(t) && prev.current.get(t) !== sig
						prev.current.set(t, sig)

						const selected = selectedTick === t
						return (
							<tr
								key={t}
								onClick={interactive && onPickTick ? () => onPickTick(t) : undefined}
								style={{
									cursor: interactive && onPickTick ? "pointer" : "default",
									background: selected ? "var(--bg-3, transparent)" : undefined,
									outline: selected ? "1px solid var(--line)" : undefined,
								}}
							>
								<td style={{ fontWeight: selected ? 700 : 400 }}>
									{selected ? "› " : "  "}
									{formatBps(price(t))}
								</td>
								<td className={`r yes${changed ? " flash" : ""}`}>
									{l.openYes > 0n ? formatWad(l.openYes) : "·"}
								</td>
								<td className="ascii" style={{ padding: "2px var(--s3)" }}>
									<span className="yes">{yesBar.padStart(BAR_CELLS, " ")}</span>
									<span className="muted">{"│"}</span>
									<span className="no">{noBar.padEnd(BAR_CELLS, " ")}</span>
								</td>
								<td className={`r no${changed ? " flash" : ""}`}>
									{l.openNo > 0n ? formatWad(l.openNo) : "·"}
								</td>
								<td className="r muted">{l.matched > 0n ? formatWad(l.matched) : "·"}</td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}
