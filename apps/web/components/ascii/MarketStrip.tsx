"use client"

import Link from "next/link"

import { Clocks } from "./Clocks"
import { OUTCOME, PHASE } from "../../lib/abi"
import { formatBps } from "../../lib/market-math"

/**
 * The sideways strip of other open rounds.
 *
 * §7: /app opens on ONE market at full size, because a grid of twelve
 * simultaneous sixty-second countdowns is a slot machine, not a product -- there
 * is no way to decide which one to look at, and every one of them is expiring. So
 * the other rounds live in a horizontal strip above the market you are in, the way
 * a broadcast shows other fixtures.
 *
 * Each chip is deliberately small: the question, one price, and both clocks. It is
 * a way to leave, not a second trading surface. Anything richer competes with the
 * book underneath it.
 */

export type StripItem = {
	address: string
	question: string
	phase: number
	outcome: number
	openUntil: number
	resolveAfter: number
	impliedBps: string
	resolvingStartsAt?: number
	/** the market currently open on the page; rendered as a marker, not a link */
	current?: boolean
}

export function MarketStrip({ items, label = "other rounds" }: { items: StripItem[]; label?: string }) {
	if (items.length === 0) return null

	return (
		<div style={ { display: "grid", gap: "var(--s2)" } }>
			<span className="label">{label}</span>
			{/* .strip scrolls itself and snaps; it never widens the page. */}
			<div className="strip" role="list">
				{items.map((m) => (
					<Chip key={m.address} m={m} />
				))}
			</div>
		</div>
	)
}

function Chip({ m }: { m: StripItem }) {
	const implied = BigInt(m.impliedBps)
	const settled = m.outcome !== OUTCOME.Unresolved

	const inner = (
		<div style={ { display: "grid", gap: "var(--s2)", padding: "var(--s3)" } }>
			<span style={ { display: "flex", justifyContent: "space-between", gap: "var(--s2)", alignItems: "center" } }>
				{m.phase === PHASE.Open && !settled ? (
					<span className="badge badge-live">live</span>
				) : m.phase === PHASE.Locked ? (
					<span className="badge">matching</span>
				) : (
					<span className="badge">settled</span>
				)}
				{m.current ? <span className="label">you are here</span> : null}
			</span>

			<span
				style={ {
					fontSize: "var(--t-small)",
					lineHeight: 1.35,
					display: "-webkit-box",
					WebkitLineClamp: 2,
					WebkitBoxOrient: "vertical",
					overflow: "hidden",
				} }
			>
				{m.question}
			</span>

			<span style={ { display: "flex", gap: "var(--s3)", alignItems: "baseline" } }>
				<span className="label">yes</span>
				<span className="num yes">{formatBps(implied)}</span>
				<span className="label">no</span>
				<span className="num no">{formatBps(10_000n - implied)}</span>
			</span>

			{/* Two clocks even here. A chip showing one number is the §3.4 bug in
			    miniature: it is enough to make somebody click through believing they
			    have time. */}
			<Clocks
				phase={m.phase}
				openUntil={m.openUntil}
				resolveAfter={m.resolveAfter}
				resolvingStartsAt={m.resolvingStartsAt}
				size="row"
			/>
		</div>
	)

	if (m.current) {
		return (
			<div className="panel" role="listitem" style={ { boxShadow: "inset 2px 0 0 var(--accent)" } }>
				{inner}
			</div>
		)
	}

	return (
		<Link
			href={`/app/m/${m.address}`}
			className="panel"
			role="listitem"
			style={ { display: "block", color: "inherit", textDecoration: "none" } }
		>
			{inner}
		</Link>
	)
}
