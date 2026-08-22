import Link from "next/link"

import { formatBps, formatWad, type TickLevel } from "../../lib/market-math"
import { OUTCOME, PHASE } from "../../lib/abi"
import { Clocks } from "./Clocks"

/**
 * One market, at a glance. ONE component, two scales.
 *
 * §4.2 is explicit that the landing hero must be a real market rendered by this
 * component at a larger scale, NOT a second hero component that drifts from the
 * card. So `size` switches the type scale and adds the call to action, and
 * everything else -- the clocks, the sparkline, the settled stamp -- is shared.
 * If the hero and the list card ever disagree about a price, that is a bug in one
 * file instead of a bug in two.
 *
 * The card answers the only three questions that matter in a sixty-second market,
 * in the order a trader asks them: what is it, what is the price, how long have I
 * got. And "how long" is ALWAYS two numbers -- see Clocks.
 */

const SPARK_CELLS = 19 // one cell per tick -- the sparkline *is* the book

/*
 * ASCII ONLY (§5.3). V1 drew this with the block-element glyphs U+2581..U+2588.
 * Those are not in every mono font: where they are substituted they come from a
 * fallback with a different advance, so a 19-cell sparkline stops being 19 cells
 * wide and every row under it shears. Seven ASCII levels read just as well and
 * are guaranteed to be one cell each.
 */
const RAMP = "_.-=+*#"

/** A 19-character picture of where the liquidity is sitting. */
function sparkline(levels: readonly TickLevel[]): string {
	const weights = levels.map((l) => l.openYes + l.openNo + l.matched * 2n)
	if (weights.length === 0) return ".".repeat(SPARK_CELLS)
	const peak = weights.reduce((a, b) => (b > a ? b : a), 0n)
	if (peak === 0n) return ".".repeat(SPARK_CELLS)
	const top = BigInt(RAMP.length - 1)
	return weights
		.map((w) => {
			if (w === 0n) return "."
			// integer-only scaling, and never round a non-zero level down to blank
			const step = (w * top) / peak
			return RAMP[Number(step < 1n ? 1n : step)]
		})
		.join("")
}

const OUTCOME_WORD: Record<number, string> = {
	[OUTCOME.Yes]: "yes",
	[OUTCOME.No]: "no",
	[OUTCOME.Void]: "void",
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
	/** unix seconds the resolving interval begins; gates tradeability (§3.4) */
	resolvingStartsAt?: number
	/** distinct traders seen by the indexer, when it is running */
	traders?: number
	/** hero renders at landing scale with a call to action */
	size?: "list" | "hero"
	/**
	 * Overlaid stamp. Used for exactly one thing: marking the landing hero as an
	 * EXAMPLE when the factory could not be reached, so a static card is never
	 * mistaken for a live one.
	 */
	stamp?: string
	/** when the next round of this series opens, shown under a settled card */
	nextOpensInSec?: number
	/** rendered instead of a <Link> when the card is already the page you are on */
	static?: boolean
}

export function MarketCard(props: MarketCardProps) {
	const hero = props.size === "hero"
	const implied = BigInt(props.impliedBps)
	const matched = BigInt(props.matchedWad)
	const settled = props.outcome !== OUTCOME.Unresolved
	const outcomeWord = OUTCOME_WORD[props.outcome]
	const openLevels = props.levels.filter((l) => l.openYes > 0n || l.openNo > 0n).length

	const body = (
		<>
			<div className="panel-head">
				<span style={ { display: "flex", gap: "var(--s2)", alignItems: "center" } }>
					{props.phase === PHASE.Open && !settled ? (
						<span className="badge badge-live">live now</span>
					) : props.phase === PHASE.Locked ? (
						<span className="badge">locked · matching</span>
					) : (
						<span className="badge">settled · {outcomeWord ?? "pending"}</span>
					)}
					{props.stamp ? <span className="badge">{props.stamp}</span> : null}
					{props.holding ? <span className="badge">holding</span> : null}
				</span>
				<span className="label">
					{props.traders !== undefined ? `${props.traders} traders` : `${openLevels} levels open`}
				</span>
			</div>

			<div className="panel-body" style={ { display: "grid", gap: hero ? "var(--s5)" : "var(--s3)" } }>
				<h3
					className={hero ? "display" : undefined}
					style={ {
						margin: 0,
						fontSize: hero ? "var(--t-h2)" : "var(--t-h3)",
						lineHeight: hero ? 1.05 : 1.25,
						maxWidth: "28ch",
					} }
				>
					{props.question}
				</h3>

				{/*
				  TWO CLOCKS. Never one. A market card that shows a single countdown is
				  the bug §3.4 is about.
				*/}
				<Clocks
					phase={props.phase}
					openUntil={props.openUntil}
					resolveAfter={props.resolveAfter}
					resolvingStartsAt={props.resolvingStartsAt}
					size={hero ? "stack" : "row"}
					outcomeLabel={settled ? outcomeWord : undefined}
				/>

				{/* Both sides, both prices, always. "0.62 implied" makes a reader do the
				    subtraction; showing NO too does not. */}
				<div style={ { display: "flex", alignItems: "baseline", gap: "var(--s5)", flexWrap: "wrap" } }>
					<span style={ { display: "flex", alignItems: "baseline", gap: "var(--s2)" } }>
						<span className="label">yes</span>
						<span className="num yes" style={ { fontSize: hero ? "var(--t-h1)" : "var(--t-h3)", lineHeight: 1 } }>
							{formatBps(implied)}
						</span>
					</span>
					<span style={ { display: "flex", alignItems: "baseline", gap: "var(--s2)" } }>
						<span className="label">no</span>
						<span className="num no" style={ { fontSize: hero ? "var(--t-h1)" : "var(--t-h3)", lineHeight: 1 } }>
							{formatBps(10_000n - implied)}
						</span>
					</span>
				</div>

				<div className="ascii-scroll">
					<pre className="ascii" aria-hidden="true">
						{sparkline(props.levels)}
					</pre>
				</div>
				<div className="label" style={ { display: "flex", justifyContent: "space-between", gap: "var(--s3)" } }>
					<span>0.05</span>
					<span>
						{formatWad(matched)} matched · {openLevels} levels open
					</span>
					<span>0.95</span>
				</div>

				{props.nextOpensInSec !== undefined ? (
					<p className="label" style={ { margin: 0 } }>
						next round opens in {mmssStatic(props.nextOpensInSec)}
					</p>
				) : null}

				{hero ? (
					<span className="ascii" style={ { color: "var(--accent)", fontSize: "var(--t-body)" } }>
						[ trade this round -&gt; ]
					</span>
				) : null}
			</div>
		</>
	)

	if (props.static) {
		return (
			<div className="panel" style={ { display: "block" } }>
				{body}
			</div>
		)
	}

	return (
		<Link
			href={`/app/m/${props.address}`}
			className="panel"
			style={ { display: "block", textDecoration: "none", color: "inherit" } }
		>
			{body}
		</Link>
	)
}

/** Server-safe mm:ss. The live one lives in Clocks and needs a timer. */
function mmssStatic(sec: number): string {
	const s = Math.max(0, Math.floor(sec))
	return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}
