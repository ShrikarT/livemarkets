import Link from "next/link"

import { HeroMarket } from "../components/HeroMarket"
import { WaitlistForm } from "../components/WaitlistForm"
import { brand } from "../config/brand"
import { BENCH_COMMAND, bench, structural } from "../config/bench"
import { activeChain, chainTiming, explorerAddress } from "../config/chains"
import { contracts, protocol, trust } from "../config/contracts"

export const metadata = {
	title: brand.headline,
	description: brand.description,
}

/**
 * The landing page.
 *
 * WHAT CHANGED AND WHY (§4)
 * V1 opened with generated ASCII art and then spent its second section arguing
 * about storage slots. A visitor could reach the footer without ever seeing a
 * question, a price or a countdown -- the page sold the architecture, not the
 * product. The order below is the fix, and the order is the whole point:
 *
 *   1. nav, carrying the honesty label
 *   2. A REAL LIVE MARKET -- question, both prices, both clocks
 *   3. one headline, one paragraph, two buttons
 *   4. how a round works
 *   5. why this needs Monad (the shard diagram, now that someone has a reason to care)
 *   6. benchmark
 *   7. what you are trusting
 *   8. waitlist
 *   9. footer
 *
 * Sections 4 through 9 are V1's, unchanged. They were never the problem; their
 * position was.
 */

/**
 * The shard diagram: nineteen price levels, nineteen independent slots, nineteen
 * transactions that can land in the same block because none of them touch the
 * same storage.
 *
 * ASCII ONLY (§5.3). V1 drew this with box-drawing and heavy box-drawing glyphs
 * plus an arrowhead and a vertical ellipsis. Light box-drawing is usually safe;
 * the heavy variants and the symbol glyphs are not, and where any single one of
 * them substitutes from a fallback font at a different advance the whole figure
 * shears -- which is exactly what "the ASCII art does not align" meant. Every
 * character below is in the allowed set: + - | : > . =
 *
 * The question is phrased in the next-interval form on purpose. "This over" is
 * the delay bug written into the copy.
 */
const SHARD_DIAGRAM = `   one question            nineteen shards            one settlement

                    +-- 0.05 --+ openYes openNo matched +
                    |-- 0.10 --| openYes openNo matched |
 "Boundary in the --+-- 0.15 --| openYes openNo matched |
  next over?"       |    :     |    :       :      :    +--> yes / no / void
                    |-- 0.90 --| openYes openNo matched |
                    +-- 0.95 --+ openYes openNo matched +

                    |===== 19 concurrent matchTick() txs =====|`

const STEPS = [
	{
		n: "01",
		h: "A question opens",
		p: `Something you can settle from a block: a boundary, a gas spike, a vote. It takes orders for ${protocol.openSeconds} seconds.`,
	},
	{
		n: "02",
		h: "You pick a price, not a side",
		p: "Nineteen ticks from 0.05 to 0.95. Buying yes at 0.35 means paying 35 cents for a dollar if you are right. Your counterparty pays the other 65.",
	},
	{
		n: "03",
		h: "It settles and pays",
		p: `The resolver posts the outcome, the winning leg is worth 1.00, and claiming is one transaction. Total round: ${protocol.roundSeconds} seconds.`,
	},
]

export default function LandingPage() {
	return (
		/*
		 * The theme class both PAINTS and FILLS (see globals.css). V1 also put
		 * `plate` here, which ran a duotone filter over every glyph on the page and
		 * -- because a filter creates a containing block -- silently broke any
		 * position:fixed descendant. Images get the plate; text never does.
		 */
		<div className="theme-paper">
			<header
				className="wrap"
				style={ {
					display: "flex",
					alignItems: "center",
					gap: "var(--s4)",
					paddingTop: "var(--s4)",
					flexWrap: "wrap",
				} }
			>
				<span className="display" style={ { fontSize: "var(--t-lead)", letterSpacing: "0.14em" } }>
					{brand.wordmark}
				</span>
				{/* The honesty label sits in the nav on every route, not in a modal
				    somebody dismisses once and never sees again. */}
				<span className="label">{brand.environmentLabel}</span>

				<nav style={ { display: "flex", gap: "var(--s4)", marginLeft: "auto", alignItems: "center", flexWrap: "wrap" } }>
					<a className="label" href="#how-it-works">
						how it works
					</a>
					<a className="label" href="#benchmark">
						benchmark
					</a>
					<Link className="btn" href="/app">
						open the app
					</Link>
				</nav>
			</header>

			<main>
				{/* --------------------------------------------------------- hero */}
				{/*
				 * §4.2: the first thing on the page is a market you can trade, rendered
				 * by the same component the list uses, server-rendered off the chain.
				 * Not a mock, not a screenshot, not an illustration of a market.
				 *
				 * §4.3: the plate lives HERE, behind the hero only, inside .plate-wrap so
				 * its stacking context is scoped. One plate on the page. Never behind body
				 * text, never animated, and it carries alt="" because it is decoration.
				 */}
				<section className="wrap plate-wrap" style={ { paddingTop: "var(--s7)", paddingBottom: "var(--s7)" } }>
					<picture>
						<source srcSet="/plates/colonnade.avif" type="image/avif" />
						<img
							className="plate"
							src="/plates/colonnade.webp"
							alt=""
							aria-hidden="true"
							style={ { opacity: 0.22 } }
							fetchPriority="low"
							decoding="async"
						/>
					</picture>

					<div style={ { display: "grid", gap: "var(--s6)", maxWidth: "760px" } }>
						<span className="label">trading right now</span>
						<HeroMarket />
					</div>
				</section>

				{/* ---------------------------------------------------- positioning */}
				{/* The pitch comes AFTER the thing it is describing. By this point the
				    reader has already seen a question, two prices and two clocks, so one
				    paragraph is enough. */}
				<section className="wrap">
					<h1 className="display" style={ { fontSize: "var(--t-h1)", margin: "0 0 var(--s3)", maxWidth: "22ch" } }>
						{brand.headline}
					</h1>
					<p className="lead" style={ { maxWidth: "var(--measure)" } }>
						{brand.tagline} A market opens, fills and pays out before you have finished reading this sentence
						twice. Orders close before the thing being predicted starts, so nobody with a faster feed is trading
						against an outcome you cannot see yet.
					</p>
					<div style={ { display: "flex", gap: "var(--s3)", marginTop: "var(--s5)", flexWrap: "wrap" } }>
						<Link className="btn" href="/app">
							trade the live round
						</Link>
						<a className="btn btn-ghost" href={brand.handles.github} target="_blank" rel="noreferrer">
							read the contracts
						</a>
						{/*
						  The external faucet button is deliberately gone (§12). Sending a new
						  user to a third-party site, to solve a captcha, to come back with
						  test tokens, before they have seen a single price, is the worst
						  onboarding step in the product. /api/faucet drips on first trade
						  instead -- see §9.
						*/}
					</div>
				</section>

				{/* -------------------------------------------------------- steps */}
				<section id="how-it-works" className="wrap" style={ { paddingTop: "var(--s8)", scrollMarginTop: "var(--s5)" } }>
					<span className="label">how a round works</span>
					<div
						style={ {
							display: "grid",
							gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
							gap: "var(--s5)",
							marginTop: "var(--s4)",
						} }
					>
						{STEPS.map((s) => (
							<div key={s.n}>
								<span className="num label">{s.n}</span>
								<h3 style={ { fontSize: "var(--t-h3)", margin: "var(--s2) 0" } }>{s.h}</h3>
								<p className="prose" style={ { margin: 0 } }>
									{s.p}
								</p>
							</div>
						))}
					</div>
				</section>

				{/* ------------------------------------------------------- shards */}
				<section className="wrap" style={ { paddingTop: "var(--s8)" } }>
					<span className="label">why this needs Monad</span>
					<h2 className="display" style={ { fontSize: "var(--t-h2)", margin: "var(--s3) 0", maxWidth: "30ch" } }>
						The order book is sharded by price
					</h2>
					<div className="prose" style={ { maxWidth: "var(--measure)" } }>
						<p>
							A normal order book is one sorted list, and one sorted list is one hot storage slot. Every fill
							writes the same head pointer, so however many transactions arrive, they queue. Parallel execution
							buys you nothing, because the contention is in the data structure, not the chain.
						</p>
						<p>
							So there is no shared list here. Each of the {structural.ticks} price levels is its own struct with
							its own resting size, its own matched total, its own fee accumulator and its own cursor. Matching
							tick 4 and tick 17 touches {structural.sharedSlots} slots in common, so the two transactions never
							contend and the scheduler runs them at the same time. That is the entire design, and it is why a
							market can open, fill across every level and settle inside {protocol.roundSeconds} seconds.
						</p>
					</div>
					{/* .ascii-scroll so a wide figure scrolls itself instead of dragging the
					    page wider than the viewport (§5.4). */}
					<div className="ascii-scroll panel" style={ { marginTop: "var(--s5)", padding: "var(--s4)" } }>
						<pre className="ascii ascii-selectable">{SHARD_DIAGRAM}</pre>
					</div>
					<p className="label" style={ { marginTop: "var(--s3)" } }>
						{structural.note}
					</p>
				</section>

				{/* ---------------------------------------------------- benchmark */}
				<section id="benchmark" className="wrap" style={ { paddingTop: "var(--s8)", scrollMarginTop: "var(--s5)" } }>
					<span className="label">sharded book vs single book</span>
					{bench.measured ? (
						<>
							<table className="table" style={ { marginTop: "var(--s4)" } }>
								<thead>
									<tr>
										<th>measurement</th>
										<th className="r">single book</th>
										<th className="r">sharded book</th>
									</tr>
								</thead>
								<tbody>
									{bench.rows.map((r) => (
										<tr key={r.label}>
											<td>
												{r.label}
												{r.note ? <span className="label"> {r.note}</span> : null}
											</td>
											<td className="r num">{r.sequential}</td>
											<td className="r num">{r.parallel}</td>
										</tr>
									))}
								</tbody>
							</table>
							<p className="label" style={ { marginTop: "var(--s3)" } }>
								Measured on {bench.chain} at {bench.takenAt}. Reproduce with <code>{BENCH_COMMAND}</code>.
							</p>
						</>
					) : (
						<div className="panel" style={ { marginTop: "var(--s4)" } }>
							<div className="panel-head">
								<span className="label">not measured yet</span>
							</div>
							<div className="panel-body prose">
								<p style={ { marginTop: 0 } }>
									This is where the latency table goes, and it stays empty until someone actually runs the
									benchmark. Publishing a number nobody measured is how benchmarks stop meaning anything.
								</p>
								<pre className="ascii ascii-selectable" style={ { margin: 0 } }>
									{BENCH_COMMAND}
								</pre>
								<p style={ { marginBottom: 0 } }>
									It fires {structural.ticks} <code>matchTick</code> transactions against a deployed market two
									ways — one at a time, then all at once with pre-computed nonces — and against{" "}
									<a href={explorerAddress(contracts.naiveBook)} target="_blank" rel="noreferrer">
										NaiveBook
									</a>
									, the same market built on one shared list. It writes its own results into{" "}
									<code>apps/web/config/bench.ts</code>, so the table on this page can only ever show a real run.
								</p>
							</div>
						</div>
					)}
					<p className="label" style={ { marginTop: "var(--s3)" } }>
						{activeChain.name} · {chainTiming.blockMs}ms blocks · {chainTiming.finalityMs}ms finality · crank every{" "}
						{chainTiming.crankIntervalMs}ms
					</p>
				</section>

				{/* -------------------------------------------------------- trust */}
				<section className="wrap" style={ { paddingTop: "var(--s8)" } }>
					<span className="label">what you are trusting</span>
					<h2 className="display" style={ { fontSize: "var(--t-h2)", margin: "var(--s3) 0", maxWidth: "30ch" } }>
						One key decides every outcome. For now.
					</h2>
					<p className="prose" style={ { maxWidth: "var(--measure)" } }>
						{trust.detail} It is written on every market page, not buried in a docs site, and the resolver is a
						constructor argument rather than a hardcoded address so replacing it does not need a new protocol.
					</p>
					<ol style={ { marginTop: "var(--s4)", paddingLeft: 0, listStyle: "none", display: "grid", gap: "var(--s2)" } }>
						{trust.roadmap.map((r) => (
							<li key={r.stage} style={ { display: "flex", gap: "var(--s3)", alignItems: "baseline" } }>
								<span className="num label">{r.stage}</span>
								<span>{r.label}</span>
								<span className={`badge ${r.status === "live" ? "yes" : ""}`} style={ { marginLeft: "auto" } }>
									{r.status}
								</span>
							</li>
						))}
					</ol>
				</section>

				{/* ----------------------------------------------------- waitlist */}
				<section className="wrap" style={ { paddingTop: "var(--s8)", maxWidth: "640px" } }>
					<WaitlistForm />
				</section>
			</main>

			{/* --------------------------------------------------------- footer */}
			<footer className="wrap" style={ { paddingTop: "var(--s8)", paddingBottom: "var(--s7)" } }>
				<div className="rule" style={ { marginBottom: "var(--s4)" } } />
				<div style={ { display: "flex", gap: "var(--s4)", flexWrap: "wrap", alignItems: "baseline" } }>
					<span className="label">
						{brand.name} · {brand.attribution.licence} licence
					</span>
					<a className="label" href={explorerAddress(contracts.factory)} target="_blank" rel="noreferrer">
						factory
					</a>
					<a className="label" href={brand.handles.github} target="_blank" rel="noreferrer">
						source
					</a>
					<a className="label" href={brand.handles.xUrl} target="_blank" rel="noreferrer">
						{brand.handles.x}
					</a>
					<span className="label" style={ { marginLeft: "auto" } }>
						{brand.attribution.artCredit}
					</span>
				</div>
			</footer>
		</div>
	)
}
