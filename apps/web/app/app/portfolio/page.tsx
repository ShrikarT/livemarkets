import { AppNav } from "../../../components/AppNav"
import { brand } from "../../../config/brand"
import { listRecentMarkets } from "../../../lib/market-client"
import { Portfolio } from "./Portfolio"

/**
 * What you are holding, and what you can collect.
 *
 * WHY THE WORK IS SPLIT ACROSS TWO FILES
 *
 * The list of markets is public, identical for everyone, and cheap to render on
 * the server. Your positions are neither: they depend on a wallet the server has
 * never seen and must not ask for. So the server sends down the addresses and
 * the client reads the positions -- which also means this page renders its own
 * chrome and its "connect to see yours" state with no JavaScript at all.
 */
export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata = {
	title: `portfolio \u00b7 ${brand.wordmark.toLowerCase()}`,
	description: brand.tagline,
}

/**
 * How far back to look.
 *
 * Rounds last a minute, so 24 is roughly the last half hour of activity. This is
 * deliberately a window and not "everything": an unbounded scan would grow one
 * RPC call per minute forever, and an address with a position older than the
 * window can still claim it from the market page itself. A real indexer replaces
 * this, and the number is here in one place for when it does.
 */
const SCAN = 24

export default async function PortfolioPage() {
	let addresses: string[] = []
	try {
		addresses = [...(await listRecentMarkets(SCAN))]
	} catch {
		addresses = []
	}

	return (
		<div className="theme-ink">
			<AppNav />
			<main className="wrap" style={{ paddingTop: "var(--s5)", paddingBottom: "var(--s8)" }}>
				<h1 className="display" style={{ fontSize: "var(--t-h2)", margin: 0 }}>
					portfolio
				</h1>
				<p className="label" style={{ marginTop: "var(--s2)" }}>
					the last {SCAN} rounds. older positions are still claimable from their own page.
				</p>
				<Portfolio addresses={addresses} />
			</main>
		</div>
	)
}
