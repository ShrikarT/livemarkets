import { FEED_CACHE_MS, feedFor } from "../../../../config/feeds"

/**
 * GET /api/feed/eth-usdt -- the last print, server-side and cached.
 *
 * The browser must never call the exchange directly. Three reasons, all of which
 * bit somebody before this route existed:
 *   1. A hundred viewers on one market become a hundred requests a second to a
 *      public endpoint, which gets the deployment rate-limited and blanks the
 *      tape for everybody.
 *   2. CORS on exchange endpoints is not a promise anyone made to us.
 *   3. One cache means every viewer sees the SAME print, which matters when the
 *      print is what a market is about.
 *
 * The cache is module-scoped, so it is shared by every request this server
 * instance handles and refreshed at most once per FEED_CACHE_MS.
 */

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Entry = { price: number; at: number; inflight?: Promise<void> }

const cache = new Map<string, Entry>()

async function refresh(id: string): Promise<void> {
	const feed = feedFor(id)
	const res = await fetch(feed.endpoint, {
		cache: "no-store",
		headers: { accept: "application/json" },
		// A market lasts sixty seconds; a feed request that takes four is useless.
		signal: AbortSignal.timeout(3_000),
	})
	if (!res.ok) throw new Error(`upstream ${res.status}`)
	const body = (await res.json()) as Record<string, unknown>
	const raw = body[feed.priceKey]
	const price = typeof raw === "string" ? Number.parseFloat(raw) : typeof raw === "number" ? raw : Number.NaN
	if (!Number.isFinite(price)) throw new Error("upstream returned no usable price")
	cache.set(feed.id, { price, at: Date.now() })
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params
	const feed = feedFor(id)
	const hit = cache.get(feed.id)
	const fresh = hit !== undefined && Date.now() - hit.at < FEED_CACHE_MS

	if (!fresh) {
		try {
			// Collapse concurrent misses into one upstream call rather than letting
			// every waiting request fire its own.
			if (hit?.inflight) {
				await hit.inflight
			} else {
				const p = refresh(feed.id)
				if (hit) hit.inflight = p
				await p
				const updated = cache.get(feed.id)
				if (updated) delete updated.inflight
			}
		} catch (err) {
			const stale = cache.get(feed.id)
			// Serve the stale print, but SAY it is stale. A frozen number presented as
			// current is worse than no number.
			if (stale) {
				return Response.json(
					{
						feed: feed.id,
						label: feed.label,
						exchange: feed.exchange,
						price: stale.price,
						at: stale.at,
						stale: true,
						error: err instanceof Error ? err.message.slice(0, 120) : "feed unreachable",
					},
					{ status: 200, headers: { "cache-control": "no-store" } },
				)
			}
			return Response.json(
				{
					feed: feed.id,
					label: feed.label,
					exchange: feed.exchange,
					error: err instanceof Error ? err.message.slice(0, 120) : "feed unreachable",
				},
				{ status: 502, headers: { "cache-control": "no-store" } },
			)
		}
	}

	const entry = cache.get(feed.id)
	if (!entry) return Response.json({ error: "no price yet" }, { status: 503 })

	return Response.json(
		{
			feed: feed.id,
			label: feed.label,
			exchange: feed.exchange,
			symbol: feed.symbol,
			price: entry.price,
			at: entry.at,
			stale: false,
		},
		{
			status: 200,
			// One second of shared cache at the edge, then re-ask. Never store.
			headers: { "cache-control": "public, max-age=1, stale-while-revalidate=2" },
		},
	)
}
