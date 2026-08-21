import Link from "next/link"

import { formatBps, formatWad, tickForBps, type TickLevel } from "../../lib/market-math"
import { OUTCOME } from "../../lib/abi"
import { Countdown } from "./Countdown"

/**
 * One market, at a glance.
 *
 * The card answers the only three questions that matter in a sixty-second market,
 * in the order a trader asks them: what is it, what is the price, how long have I
 * got. Everything else is one click away.
 */

const SPARK_CELLS = 19 // one cell per tick — the sparkline *is* the book
const SPARK = " ▁▂▃▄▅▆▇█"

/** A 19-character picture of where the liquidity is sitting. */
function sparkline(levels: readonly TickLevel[]): string {
	const weights = levels.map((l) => l.openYes + l.openNo + l.matched * 2n)
	const peak = weights.reduce((a, b) => (b > a ? b : a), 0n)
	if (peak === 0n) return "·".repeat(SPARK_CELLS)
	const top = BigInt(SPARK.length - 1)
	return weights
		.map((w) => {
			if (w === 0n) return "·"
			// integer-only scaling, and never round a non-zero level down to blank
			const step = (w * top) / peak
			return SPARK[Number(step < 1n ? 1n : step)]
		})
		.join("")
}

const OUTCOME_TONE: Record<number, string> = {
	[OUTCOME.Yes]: "yes",
	[OUTCOME.No]: "no",
	[OUTCOME.Void]: "muted",
}

export type MarketCardProps = {
	address: string
	question: string
	phase: number
	outcome: number
	openUntil: number
	resolveAfter: number
	impliedBps: string
	matchedWad: string
	levels: TickLevel[]
	/** true when the connected address is holding something here */
	holding?: boolean
}

export function MarketCard(props: MarketCardProps) {
	const implied = BigInt(props.impliedBps)
	const matched = BigInt(props.matchedWad)
	const settled = props.outcome !== OUTCOME.Unresolved
	const tone = OUTCOME_TONE[props.outcome] ?? ""

	return (
		<Link
			href={`/app/m/${props.address}`}
			className="panel fade-in"
			style={{ display: "block", textDecoration: "none", color: "inherit" }}
		>
			<div className="panel-head">
				<span className="label">tick {tickForBps(implied)} · {props.address.slice(0, 6)}…{props.address.slice(-4)}</span>
				{props.holding ? <span className="badge">holding</span> : null}
			</div>

			<div className="panel-body" style={{ display: "grid", gap: "var(--s3)" }}>
				<h3 style={{ margin: 0, fontSize: "var(--t-h3)", lineHeight: 1.25 }}>{props.question}</h3>

				<div style={{ display: "flex", alignItems: "baseline", gap: "var(--s3)" }}>
					<span className="num" style={{ fontSize: "var(--t-h2)", lineHeight: 1 }}>
						{formatBps(implied)}
					</span>
					<span className="label">implied yes</span>
					{settled ? (
						<span className={`badge ${tone}`} style={{ marginLeft: "auto" }}>
							settled {props.outcome === OUTCOME.Yes ? "yes" : props.outcome === OUTCOME.No ? "no" : "void"}
						</span>
					) : null}
				</div>

				<Countdown phase={props.phase} openUntil={props.openUntil} resolveAfter={props.resolveAfter} />

				<div>
					<pre className="ascii" style={{ margin: 0 }}>
						{sparkline(props.levels)}
					</pre>
					<div className="label" style={{ display: "flex", justifyContent: "space-between" }}>
						<span>0.05</span>
						<span>{formatWad(matched)} MON matched</span>
						<span>0.95</span>
					</div>
				</div>
			</div>
		</Link>
	)
}
