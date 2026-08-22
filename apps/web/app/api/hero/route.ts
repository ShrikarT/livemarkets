import { NextResponse } from "next/server"

import { readHero } from "../../../lib/hero"

/**
 * The landing hero's poll endpoint.
 *
 * WHY THIS EXISTS RATHER THAN <Refresher />
 * The V1 pattern for staying current was a client component calling
 * router.refresh() on an interval. router.refresh() re-renders the whole route
 * segment, so on the landing page it would re-run every section -- the shard
 * diagram, the benchmark table, the waitlist form -- once every few seconds to
 * update two prices. Polling one small JSON document and re-rendering one card is
 * the same freshness for a fraction of the work, and it keeps the refresh where
 * §4.2 wants it: on the card, not on the page.
 *
 * The response is intentionally tiny and cached for a second at the edge, so a
 * front page under load does not turn into one eth_call per visitor per second.
 */
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
	const payload = await readHero()

	return NextResponse.json(payload, {
		headers: {
			// One second is shorter than a round is long, so nobody sees a stale price
			// in a way that matters, and a hundred visitors share one read.
			"cache-control": "public, max-age=1, stale-while-revalidate=2",
		},
	})
}
