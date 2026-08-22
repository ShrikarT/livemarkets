import { notFound } from "next/navigation"
import { isAddress, type Address } from "viem"

import { ToastProvider } from "../../../../components/ascii/Toast"
import { brand } from "../../../../config/brand"
import { readSnapshot } from "../../../../lib/market-client"
import { formatBps } from "../../../../lib/market-math"
import { getStreamMeta } from "../../../../lib/stream-registry"
import type { StreamMeta } from "../../../../lib/stream"
import { MarketRoom } from "./MarketRoom"

/**
 * Market page.
 *
 * The server does one snapshot read so the question, the price and the countdown
 * are in the HTML before any JavaScript runs — which also means a shared link
 * previews correctly and a slow connection still sees a real page. The room then
 * takes over and polls.
 */
export const dynamic = "force-dynamic"
export const revalidate = 0

type Params = { params: Promise<{ address: string }> }

export async function generateMetadata({ params }: Params) {
	const { address } = await params
	if (!isAddress(address)) return { title: "Unknown market" }
	try {
		const snap = await readSnapshot(address as Address)
		return {
			title: snap.question,
			description: `${formatBps(snap.impliedBps)} implied · ${brand.tagline}`,
			openGraph: {
				title: snap.question,
				description: `${formatBps(snap.impliedBps)} implied probability of yes`,
				images: [{ url: `/api/og/${address}`, width: 1200, height: 630 }],
			},
			twitter: { card: "summary_large_image" as const, images: [`/api/og/${address}`] },
		}
	} catch {
		return { title: "Market" }
	}
}

export default async function MarketPage({ params }: Params) {
	const { address } = await params
	if (!isAddress(address)) notFound()

	let snap
	try {
		snap = await readSnapshot(address as Address)
	} catch {
		// An address that is well-formed but not a market is a 404, not a stack trace.
		notFound()
	}

	/*
	 * The live surface is resolved HERE, on the server, for two reasons.
	 *
	 *   1. resolvingStartsAt gates tradeability (§3.4), so it has to be in the HTML
	 *      with the first paint rather than arriving a second later. Otherwise there
	 *      is a window in which the ticket looks open on a market that is shut.
	 *   2. Both sources -- the indexer row and the committed template -- are
	 *      server-side. The browser never learns STREAMS_API_URL.
	 *
	 * null is a real state, not a failure: §3.2 says a market without a stream row
	 * should never have got past /admin, and the room says so plainly.
	 */
	let streamMeta: StreamMeta | null = null
	try {
		streamMeta = await getStreamMeta({
			address: address as Address,
			question: snap.question,
			openUntil: snap.openUntil,
		})
	} catch {
		// A stream row that cannot be read must never 500 a live market page.
		streamMeta = null
	}

	return (
		<ToastProvider>
			<MarketRoom
				address={address as Address}
				initialQuestion={snap.question}
				initialPhase={snap.phase}
				initialOpenUntil={snap.openUntil}
				initialResolveAfter={snap.resolveAfter}
				streamMeta={streamMeta}
			/>
		</ToastProvider>
	)
}
