import Link from "next/link"

import { MarketCard } from "../../components/ascii/MarketCard"
import { Refresher } from "../../components/Refresher"
import { brand } from "../../config/brand"
import { explorerAddress } from "../../config/chains"
import { contracts, trust } from "../../config/contracts"
import { readMarketList, totalMatched } from "../../lib/market-client"

/**
 * The market list.
 *
 * Server-rendered on purpose: the RPC work happens once here rather than once in
 * every visitor's browser, and a <Refresher /> re-fetches on an interval. A
 * sixty-second market does not need a websocket to stay honest, it needs a page
 * that is never more than a couple of seconds stale.
 */
export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata = {
	title: "Live rounds",
	description: brand.description,
}

export default async function MarketListPage() {
	let markets: Awaited<ReturnType<typeof readMarketList>> = []
	let error: string | null = null

	try {
		markets = await readMarketList(12)
	} catch (err) {
		// A dead RPC or an undeployed factory must not render a broken page.
		error = err instanceof Error ? err.message : "could not reach the factory"
	}

	const live = markets.filter((m) => m.phase === 0)
	const settling = markets.filter((m) => m.phase === 1)
	const done = markets.filter((m) => m.phase === 2)

	return (
		<div className="theme-ink">
			<Refresher intervalMs={2_000} />

			<header
				className="wrap"
				style={{ display: "flex", alignItems: "center", gap: "var(--s4)", paddingTop: "var(--s4)", flexWrap: "wrap" }}
			>
				<Link href="/" className="display" style={{ fontSize: "var(--t-lead)", letterSpacing: "0.14em", textDecoration: "none" }}>
					{brand.wordmark}
				</Link>
				<span className="badge">{trust.label}</span>
				<span className="label">{brand.environmentLabel}</span>
				<nav style={{ marginLeft: "auto", display: "flex", gap: "var(--s3)" }}>
					<a className="btn btn-ghost" href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">
						Test MON
					</a>
				</nav>
			</header>

			<main className="wrap" style={{ paddingTop: "var(--s6)", paddingBottom: "var(--s8)" }}>
				<div style={{ display: "flex", alignItems: "baseline", gap: "var(--s3)" }}>
					<h1 className="display" style={{ fontSize: "var(--t-h2)", margin: 0 }}>
						Live rounds
					</h1>
					<span className="label">
						{live.length} open · {settling.length} settling · {done.length} settled
					</span>
				</div>

				{error ? (
					<div className="panel" style={{ marginTop: "var(--s5)" }}>
						<div className="panel-head">
							<span className="label">no factory at this address</span>
						</div>
						<div className="panel-body prose">
							<p style={{ marginTop: 0 }}>
								The app is pointed at{" "}
								<a href={explorerAddress(contracts.factory)} target="_blank" rel="noreferrer">
									<code>{contracts.factory}</code>
								</a>{" "}
								and nothing answered. In a fresh clone that is expected — deploy first:
							</p>
							<pre className="ascii ascii-selectable" style={{ margin: 0 }}>{`npm run deploy   # writes packages/contracts/deployments/10143.json\nnpm run crank    # opens rounds and matches them`}</pre>
							<p className="label" style={{ marginBottom: 0 }}>{error}</p>
						</div>
					</div>
				) : markets.length === 0 ? (
					<div className="panel" style={{ marginTop: "var(--s5)" }}>
						<div className="panel-head">
							<span className="label">no rounds yet</span>
						</div>
						<div className="panel-body prose">
							<p style={{ margin: 0 }}>
								The factory is live but no series has been poked yet. Run <code>npm run crank</code> and a round
								opens within {Math.round(600 / 1000)} second.
							</p>
						</div>
					</div>
				) : (
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
							gap: "var(--s4)",
							marginTop: "var(--s5)",
						}}
					>
						{[...live, ...settling, ...done].map((m) => (
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
				)}
			</main>
		</div>
	)
}
