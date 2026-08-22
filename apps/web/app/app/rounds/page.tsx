import { AppNav } from "../../../components/AppNav"
import { MarketCard } from "../../../components/ascii/MarketCard"
import { Refresher } from "../../../components/Refresher"
import { brand } from "../../../config/brand"
import { protocol } from "../../../config/contracts"
import { PHASE } from "../../../lib/abi"
import { readMarketList, totalMatched } from "../../../lib/market-client"

/**
 * Every round, grouped by what you can do with it.
 *
 * This is the directory, not the front door. /app opens directly on a live
 * market because a prediction market's landing job is to show a price; this page
 * exists for the different intent of "show me everything", which is a browsing
 * task and wants a grid.
 *
 * The grouping is by ACTION, not by time: open means you can trade, matching
 * means you can crank, settled means you can claim. Sorting the whole list by
 * timestamp would bury the two rounds you can actually do something with under
 * fifty you cannot.
 */
export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata = {
	title: `all rounds \u00b7 ${brand.wordmark.toLowerCase()}`,
	description: brand.tagline,
}

export default async function RoundsPage() {
	let markets: Awaited<ReturnType<typeof readMarketList>> = []
	let failed = false
	try {
		markets = await readMarketList(24)
	} catch {
		// A cold RPC or an unconfigured deployment is not a crash.
		failed = true
	}

	const open = markets.filter((m) => m.phase === PHASE.Open)
	const locked = markets.filter((m) => m.phase === PHASE.Locked)
	const settled = markets.filter((m) => m.phase === PHASE.Resolved)

	const groups: Array<{ key: string; label: string; note: string; rows: typeof markets }> = [
		{ key: "open", label: "open", note: "you can trade these", rows: open },
		{ key: "locked", label: "matching", note: "orders closed \u00b7 anyone can crank these", rows: locked },
		{ key: "settled", label: "settled", note: "claim what you won", rows: settled },
	]

	return (
		<div className="theme-ink">
			<AppNav />
			{/*
			  Two seconds, and only on this page. The grid has no stream and no
			  ticket, so there is nothing here that a reload would interrupt -- unlike
			  the market room, where the book arrives over a stream precisely so it
			  does not need reloading.
			*/}
			<Refresher intervalMs={2_000} />

			<main className="wrap" style={{ paddingTop: "var(--s5)", paddingBottom: "var(--s8)" }}>
				<h1 className="display" style={{ fontSize: "var(--t-h2)", margin: 0 }}>
					all rounds
				</h1>
				<p className="label" style={{ marginTop: "var(--s2)" }}>
					every round lasts {protocol.roundSeconds} seconds. orders close after {protocol.openSeconds}.
				</p>

				{failed ? (
					<div className="panel" style={{ marginTop: "var(--s5)" }}>
						<div className="panel-head">
							<span className="label">could not reach the chain</span>
						</div>
						<div className="panel-body">
							<p className="label" style={{ margin: 0, lineHeight: 1.6 }}>
								the rpc did not answer. this page does not cache, so a reload is the whole retry.
							</p>
						</div>
					</div>
				) : markets.length === 0 ? (
					/* Deploy-first empty state: the exact command, not a shrug. */
					<div className="panel" style={{ marginTop: "var(--s5)" }}>
						<div className="panel-head">
							<span className="label">no rounds yet</span>
						</div>
						<div className="panel-body">
							<p className="label" style={{ marginTop: 0, lineHeight: 1.6 }}>
								the factory is reachable but has never created a market. open one:
							</p>
							<pre className="ascii" style={{ margin: 0, overflowX: "auto" }}>
								{`forge script script/Deploy.s.sol \\\n  --rpc-url $MONAD_RPC_URL \\\n  --private-key $DEPLOYER_KEY \\\n  --broadcast`}
							</pre>
						</div>
					</div>
				) : (
					groups.map((g) =>
						g.rows.length === 0 ? null : (
							<section key={g.key} style={{ marginTop: "var(--s6)" }}>
								<div
									style={{
										display: "flex",
										gap: "var(--s3)",
										alignItems: "baseline",
										borderBottom: "1px solid var(--line)",
										paddingBottom: "var(--s2)",
									}}
								>
									<h2 className="label" style={{ margin: 0, color: "var(--fg)" }}>
										{g.label}
									</h2>
									<span className="label">{g.note}</span>
									<span className="label num" style={{ marginLeft: "auto" }}>
										{g.rows.length}
									</span>
								</div>

								<div
									style={{
										display: "grid",
										gap: "var(--s4)",
										gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
										marginTop: "var(--s4)",
									}}
								>
									{g.rows.map((m) => (
										<MarketCard
											key={m.address}
											address={m.address}
											question={m.question}
											phase={m.phase}
											outcome={m.outcome}
											openUntil={m.openUntil}
											resolveAfter={m.resolveAfter}
											impliedBps={m.impliedBps.toString()}
											matchedWad={totalMatched(m.levels).toString()}
											levels={m.levels}
										/>
									))}
								</div>
							</section>
						),
					)
				)}
			</main>
		</div>
	)
}
