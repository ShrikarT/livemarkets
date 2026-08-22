import { AppNav } from "../../components/AppNav"
import { MarketRoom } from "../../components/MarketRoom"
import { MarketStrip, type StripItem } from "../../components/ascii/MarketStrip"
import { Refresher } from "../../components/Refresher"
import { ToastProvider } from "../../components/ascii/Toast"
import { brand } from "../../config/brand"
import { protocol } from "../../config/contracts"
import { PHASE } from "../../lib/abi"
import { readAllSeries, readMarketList } from "../../lib/market-client"
import { getStreamMeta, getStreamMetas } from "../../lib/stream-registry"

/**
 * /app opens ON a market, at full size.
 *
 * THE V1 MISTAKE THIS FIXES
 *
 * /app used to be a grid of cards. That is the right shape for a catalogue and
 * the wrong shape for this product: the thing that makes someone care is a price
 * moving on a clock, and a grid shows twelve of them at a size where none of
 * them move visibly. You had to pick a card before the app did anything
 * interesting, which means the most important moment -- the first five seconds --
 * was spent on a menu.
 *
 * So the newest tradeable market is mounted here in full, using the identical
 * component the dedicated route uses -- same code, no "preview" variant to drift
 * out of sync. The other rounds become a thin strip above it, and the catalogue
 * still exists at /app/rounds for the browsing intent.
 */
export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata = {
	title: `live \u00b7 ${brand.wordmark.toLowerCase()}`,
	description: brand.tagline,
}

type Metas = Awaited<ReturnType<typeof getStreamMetas>>

export default async function AppHome() {
	let markets: Awaited<ReturnType<typeof readMarketList>> = []
	let failed = false
	try {
		markets = await readMarketList(12)
	} catch {
		failed = true
	}

	const open = markets.filter((m) => m.phase === PHASE.Open)
	const locked = markets.filter((m) => m.phase === PHASE.Locked)
	const settled = markets.filter((m) => m.phase === PHASE.Resolved)

	/**
	 * What to open on, in order of what the visitor can do with it.
	 *
	 * Tradeable beats matching beats settled. A settled market is still worth
	 * showing rather than an empty page -- it proves the whole loop ran and paid
	 * out -- but it is the last choice, not the first.
	 */
	const featured = open[0] ?? locked[0] ?? settled[0] ?? null

	if (failed || !featured) {
		// No live market. Say which of the two reasons it is, and poll, because the
		// next round starting is exactly the event this page is waiting for.
		let nextIn: number | null = null
		if (!failed) {
			try {
				const series = await readAllSeries()
				const nowSec = Math.floor(Date.now() / 1_000)
				const upcoming = series
					.filter((s) => !s.stopped && s.nextStart > nowSec)
					.map((s) => s.nextStart - nowSec)
				if (upcoming.length > 0) nextIn = Math.min(...upcoming)
			} catch {
				nextIn = null
			}
		}

		return (
			<div className="theme-ink">
				<AppNav />
				<Refresher intervalMs={5_000} />
				<main className="wrap" style={{ paddingTop: "var(--s6)", paddingBottom: "var(--s8)" }}>
					<div className="panel">
						<div className="panel-head">
							<span className="label">{failed ? "could not reach the chain" : "no market is open"}</span>
							{nextIn !== null ? <span className="label num">next in {nextIn}s</span> : null}
						</div>
						<div className="panel-body">
							{failed ? (
								<p className="label" style={{ margin: 0, lineHeight: 1.6 }}>
									the rpc did not answer. this page retries every five seconds on its own.
								</p>
							) : nextIn !== null ? (
								<p className="label" style={{ margin: 0, lineHeight: 1.6 }}>
									a series is scheduled and the next round opens shortly. rounds run {protocol.roundSeconds}{" "}
									seconds each, so nothing here is ever a long wait.
								</p>
							) : (
								<>
									<p className="label" style={{ marginTop: 0, lineHeight: 1.6 }}>
										no series is scheduled, so no round will open on its own. deploy one:
									</p>
									<pre className="ascii" style={{ margin: 0, overflowX: "auto" }}>
										{`forge script script/Deploy.s.sol \\\n  --rpc-url $MONAD_RPC_URL \\\n  --private-key $DEPLOYER_KEY \\\n  --broadcast`}
									</pre>
								</>
							)}
						</div>
					</div>
				</main>
			</div>
		)
	}

	const others = markets.filter((m) => m.address !== featured.address)

	// One registry call for the featured market, one batched call for the rest.
	// getStreamMetas uses allSettled internally, so a single dead row cannot take
	// the strip down with it -- and the registry is optional anyway, because both
	// clocks remain authoritative without it.
	const [featuredMeta, metas] = await Promise.all([
		getStreamMeta({
			address: featured.address,
			question: featured.question,
			openUntil: featured.openUntil,
		}).catch(() => null),
		getStreamMetas(others).catch((): Metas => new Map()),
	])

	/**
	 * The featured market stays IN the strip, flagged current.
	 *
	 * MarketStrip renders a current chip as a marker rather than a link, so the
	 * strip reads as "you are here, and these are the others". Filtering it out
	 * instead would silently renumber the row you are looking at, which is how a
	 * strip becomes disorienting rather than orienting.
	 */
	const stripItems: StripItem[] = markets.map((m) => ({
		address: m.address,
		question: m.question,
		phase: m.phase,
		outcome: m.outcome,
		openUntil: m.openUntil,
		resolveAfter: m.resolveAfter,
		impliedBps: m.impliedBps.toString(),
		// Two clocks everywhere, including here -- and the resolving instant is the
		// stricter of the two, so it has to come along.
		resolvingStartsAt:
			m.address === featured.address
				? featuredMeta?.resolvingStartsAt
				: metas.get(m.address.toLowerCase())?.resolvingStartsAt,
		current: m.address === featured.address,
	}))

	const nothingOpen = open.length === 0

	return (
		<div className="theme-ink">
			<AppNav />
			{/*
			  Only poll when there is nothing live to interrupt.

			  When a market IS open the room holds a server-sent stream and a possibly
			  half-filled order ticket; reloading the document under it would drop both
			  to save a request the stream is already making. When nothing is open
			  there is no stream and no ticket, and the thing we are waiting for -- a
			  new round appearing -- is only visible on a fresh server render.
			*/}
			{nothingOpen ? <Refresher intervalMs={5_000} /> : null}

			<ToastProvider>
				<MarketRoom
					address={featured.address}
					initialQuestion={featured.question}
					initialPhase={featured.phase}
					initialOpenUntil={featured.openUntil}
					initialResolveAfter={featured.resolveAfter}
					initialImpliedBps={featured.impliedBps.toString()}
					initialLevels={featured.levels.map((l) => ({
						openYes: l.openYes.toString(),
						openNo: l.openNo.toString(),
						matched: l.matched.toString(),
					}))}
					serverNow={Date.now()}
					streamMeta={featuredMeta}
					/* One chip is just the market you are already looking at. */
					strip={stripItems.length > 1 ? <MarketStrip items={stripItems} label="other rounds" /> : undefined}
					/* AppNav above already supplies the chrome. */
					chrome={false}
				/>
			</ToastProvider>
		</div>
	)
}
