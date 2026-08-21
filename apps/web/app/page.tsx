import Link from "next/link"

import { AsciiHero } from "../components/ascii/AsciiHero"
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
 * The shard diagram.
 *
 * This is the whole argument for the project in one picture: nineteen price
 * levels, nineteen independent slots, nineteen transactions that can land in the
 * same block because none of them touch the same storage.
 */
const SHARD_DIAGRAM = `      one question              nineteen shards                 one settlement

                          ┌─ 0.05 ─┐ openYes  openNo  matched ┐
                          ├─ 0.10 ─┤ openYes  openNo  matched │
   "Boundary this  ───────┼─ 0.15 ─┤ openYes  openNo  matched │
    over?"                │   ⋮    │    ⋮       ⋮       ⋮     ├──▶  yes / no / void
                          ├─ 0.85 ─┤ openYes  openNo  matched │
                          ├─ 0.90 ─┤ openYes  openNo  matched │
                          └─ 0.95 ─┘ openYes  openNo  matched ┘

                          ┗━━━━━━ 19 concurrent matchTick() txs ━━━━━━┛`

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
		<div className="theme-paper plate">
			<header className="wrap" style={{ display: "flex", alignItems: "center", gap: "var(--s4)", paddingTop: "var(--s4)" }}>
				<span className="display" style={{ fontSize: "var(--t-lead)", letterSpacing: "0.14em" }}>
					{brand.wordmark}
				</span>
				<span className="label">{brand.environmentLabel}</span>
				<Link className="btn" href="/app" style={{ marginLeft: "auto" }}>
					Open the app
				</Link>
			</header>

			{/* ------------------------------------------------------------- hero */}
			<section className="wrap" style={{ paddingTop: "var(--s6)" }}>
				<AsciiHero word={brand.wordmark} rows={14} className="halftone" />
				<h1 className="display" style={{ fontSize: "var(--t-h1)", margin: "var(--s5) 0 var(--s3)", maxWidth: "22ch" }}>
					{brand.headline}
				</h1>
				<p className="lead" style={{ maxWidth: "var(--measure)" }}>
					{brand.tagline} A market opens, fills and pays out before you have finished reading this sentence twice.
					No oracle to wait on, no week-long resolution, no wondering whether it settled.
				</p>
				<div style={{ display: "flex", gap: "var(--s3)", marginTop: "var(--s5)", flexWrap: "wrap" }}>
					<Link className="btn" href="/app">
						Trade a live round
					</Link>
					<a className="btn btn-ghost" href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">
						Get test MON
					</a>
					<a className="btn btn-ghost" href={brand.handles.github} target="_blank" rel="noreferrer">
						Read the contracts
					</a>
				</div>
			</section>

			{/* ------------------------------------------------------------ steps */}
			<section className="wrap" style={{ paddingTop: "var(--s8)" }}>
				<span className="label">how a round works</span>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
						gap: "var(--s5)",
						marginTop: "var(--s4)",
					}}
				>
					{STEPS.map((s) => (
						<div key={s.n}>
							<span className="num label">{s.n}</span>
							<h3 style={{ fontSize: "var(--t-h3)", margin: "var(--s2) 0" }}>{s.h}</h3>
							<p className="prose" style={{ margin: 0 }}>
								{s.p}
							</p>
						</div>
					))}
				</div>
			</section>

			{/* ------------------------------------------------------------ shards */}
			<section className="wrap" style={{ paddingTop: "var(--s8)" }}>
				<span className="label">why this needs Monad</span>
				<h2 className="display" style={{ fontSize: "var(--t-h2)", margin: "var(--s3) 0", maxWidth: "30ch" }}>
					The order book is sharded by price
				</h2>
				<div className="prose" style={{ maxWidth: "var(--measure)" }}>
					<p>
						A normal order book is one sorted list, and one sorted list is one hot storage slot. Every fill writes
						the same head pointer, so however many transactions arrive, they queue. Parallel execution buys you
						nothing, because the contention is in the data structure, not the chain.
					</p>
					<p>
						So there is no shared list here. Each of the {structural.ticks} price levels is its own struct with its
						own resting size, its own matched total, its own fee accumulator and its own cursor. Matching tick 4
						and tick 17 touches {structural.sharedSlots} slots in common, so the two transactions never contend and
						the scheduler runs them at the same time. That is the entire design, and it is why a market can open,
						fill across every level and settle inside {protocol.roundSeconds} seconds.
					</p>
				</div>
				<pre className="ascii ascii-selectable panel" style={{ marginTop: "var(--s5)", padding: "var(--s4)", overflowX: "auto" }}>
					{SHARD_DIAGRAM}
				</pre>
				<p className="label" style={{ marginTop: "var(--s3)" }}>
					{structural.note}
				</p>
			</section>

			{/* --------------------------------------------------------- benchmark */}
			<section className="wrap" style={{ paddingTop: "var(--s8)" }}>
				<span className="label">sharded book vs single book</span>
				{bench.measured ? (
					<>
						<table className="table" style={{ marginTop: "var(--s4)" }}>
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
						<p className="label" style={{ marginTop: "var(--s3)" }}>
							Measured on {bench.chain} at {bench.takenAt}. Reproduce with <code>{BENCH_COMMAND}</code>.
						</p>
					</>
				) : (
					<div className="panel" style={{ marginTop: "var(--s4)" }}>
						<div className="panel-head">
							<span className="label">not measured yet</span>
						</div>
						<div className="panel-body prose">
							<p style={{ marginTop: 0 }}>
								This is where the latency table goes, and it stays empty until someone actually runs the
								benchmark. Publishing a number nobody measured is how benchmarks stop meaning anything.
							</p>
							<pre className="ascii ascii-selectable" style={{ margin: 0 }}>
								{BENCH_COMMAND}
							</pre>
							<p style={{ marginBottom: 0 }}>
								It fires {structural.ticks} <code>matchTick</code> transactions against a deployed market two ways
								— one at a time, then all at once with pre-computed nonces — and against{" "}
								<a href={explorerAddress(contracts.naiveBook)} target="_blank" rel="noreferrer">
									NaiveBook
								</a>
								, the same market built on one shared list. It writes its own results into{" "}
								<code>apps/web/config/bench.ts</code>, so the table on this page can only ever show a real run.
							</p>
						</div>
					</div>
				)}
				<p className="label" style={{ marginTop: "var(--s3)" }}>
					{activeChain.name} · {chainTiming.blockMs}ms blocks · {chainTiming.finalityMs}ms finality · crank every{" "}
					{chainTiming.crankIntervalMs}ms
				</p>
			</section>

			{/* ------------------------------------------------------------- trust */}
			<section className="wrap" style={{ paddingTop: "var(--s8)" }}>
				<span className="label">what you are trusting</span>
				<h2 className="display" style={{ fontSize: "var(--t-h2)", margin: "var(--s3) 0", maxWidth: "30ch" }}>
					One key decides every outcome. For now.
				</h2>
				<p className="prose" style={{ maxWidth: "var(--measure)" }}>
					{trust.detail} It is written on every market page, not buried in a docs site, and the resolver is a
					constructor argument rather than a hardcoded address so replacing it does not need a new protocol.
				</p>
				<ol style={{ marginTop: "var(--s4)", paddingLeft: 0, listStyle: "none", display: "grid", gap: "var(--s2)" }}>
					{trust.roadmap.map((r) => (
						<li key={r.stage} style={{ display: "flex", gap: "var(--s3)", alignItems: "baseline" }}>
							<span className="num label">{r.stage}</span>
							<span>{r.label}</span>
							<span className={`badge ${r.status === "live" ? "yes" : ""}`} style={{ marginLeft: "auto" }}>
								{r.status}
							</span>
						</li>
					))}
				</ol>
			</section>

			{/* ---------------------------------------------------------- waitlist */}
			<section className="wrap" style={{ paddingTop: "var(--s8)", maxWidth: "640px" }}>
				<WaitlistForm />
			</section>

			{/* ------------------------------------------------------------ footer */}
			<footer className="wrap" style={{ paddingTop: "var(--s8)", paddingBottom: "var(--s7)" }}>
				<div className="rule" style={{ marginBottom: "var(--s4)" }} />
				<div style={{ display: "flex", gap: "var(--s4)", flexWrap: "wrap", alignItems: "baseline" }}>
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
					<span className="label" style={{ marginLeft: "auto" }}>
						{brand.attribution.artCredit}
					</span>
				</div>
			</footer>
		</div>
	)
}
