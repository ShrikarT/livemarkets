import { watcherStats } from "../../../lib/watcher"

/**
 * Makes the central performance claim falsifiable.
 *
 * The README says cost tracks the number of MARKETS, not the number of VIEWERS.
 * That is the kind of sentence every project writes and few can demonstrate, so
 * this endpoint prints the actual numbers: how many poll loops are running, how
 * many browsers are attached to them, and the ratio.
 *
 * Open two tabs on the same market and `viewersPerPollLoop` goes to 2 while
 * `pollLoops` stays at 1. Open ten and it goes to 10. If it ever tracks viewers
 * instead, the ref-counting broke and this will say so.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
	const stats = watcherStats()
	return Response.json(
		{
			ok: true,
			at: new Date().toISOString(),
			pollLoops: stats.markets,
			viewers: stats.viewers,
			// The number the README is claiming. Should rise with an audience while
			// pollLoops stays flat.
			viewersPerPollLoop: stats.markets === 0 ? 0 : Number((stats.viewers / stats.markets).toFixed(2)),
			pollIntervalMs: stats.pollMs,
			rpcCallsPerMinute: Math.round((60_000 / stats.pollMs) * stats.markets),
			markets: stats.detail,
		},
		{ headers: { "cache-control": "no-store" } },
	)
}
