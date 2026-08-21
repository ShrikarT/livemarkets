import { isAddress, type Address } from "viem"

import { chainTiming } from "../../../../config/chains"
import { readSnapshot } from "../../../../lib/market-client"

/**
 * GET /api/stream/0x... — server-sent events for one market.
 *
 * Why this exists even though the page already polls: one server poll can fan out
 * to every viewer of the same market, instead of every browser hitting the RPC
 * separately. With a few hundred people watching the same sixty-second round that
 * is the difference between one request per 500ms and several hundred.
 *
 * Design notes:
 *   - Only *changes* are sent. A book that has not moved produces no traffic.
 *   - A comment heartbeat every 15s keeps proxies from closing an idle stream.
 *   - The poll stops the moment the client disconnects. An SSE route that keeps
 *     polling after the tab closes is a bill, not a feature.
 *   - The stream closes itself once the market is settled and paid — there is
 *     nothing further to say about it.
 */

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const POLL_MS = Math.max(250, Math.floor(chainTiming.blockMs * 1.25))
const HEARTBEAT_MS = 15_000
const MAX_LIFETIME_MS = 5 * 60_000

/** Everything that can change, flattened into one comparable string. */
function signature(snap: Awaited<ReturnType<typeof readSnapshot>>): string {
	const book = snap.levels.map((l) => `${l.openYes}/${l.openNo}/${l.matched}`).join(",")
	return `${snap.phase}|${snap.outcome}|${snap.impliedBps}|${book}`
}

function serialise(snap: Awaited<ReturnType<typeof readSnapshot>>) {
	return {
		address: snap.address,
		question: snap.question,
		phase: snap.phase,
		outcome: snap.outcome,
		openUntil: snap.openUntil,
		resolveAfter: snap.resolveAfter,
		impliedBps: snap.impliedBps.toString(),
		levels: snap.levels.map((l) => ({
			openYes: l.openYes.toString(),
			openNo: l.openNo.toString(),
			matched: l.matched.toString(),
		})),
	}
}

export async function GET(req: Request, ctx: { params: Promise<{ address: string }> }) {
	const { address } = await ctx.params
	if (!isAddress(address)) return new Response("bad address", { status: 400 })
	const market = address as Address

	const encoder = new TextEncoder()
	let timer: ReturnType<typeof setInterval> | null = null
	let beat: ReturnType<typeof setInterval> | null = null
	let life: ReturnType<typeof setTimeout> | null = null

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let last = ""
			let closed = false

			const send = (event: string, data: unknown) => {
				if (closed) return
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
			}

			const shutdown = () => {
				if (closed) return
				closed = true
				if (timer) clearInterval(timer)
				if (beat) clearInterval(beat)
				if (life) clearTimeout(life)
				try {
					controller.close()
				} catch {
					/* already closed by the runtime */
				}
			}

			// Stop as soon as nobody is listening.
			req.signal.addEventListener("abort", shutdown)

			const tick = async () => {
				if (closed) return
				try {
					const snap = await readSnapshot(market)
					const sig = signature(snap)
					if (sig !== last) {
						last = sig
						send("book", serialise(snap))
					}
					if (snap.phase === 2) {
						send("settled", { outcome: snap.outcome })
						shutdown()
					}
				} catch (err) {
					send("warn", { message: err instanceof Error ? err.message.slice(0, 120) : "rpc error" })
				}
			}

			await tick()
			timer = setInterval(() => void tick(), POLL_MS)
			beat = setInterval(() => {
				if (!closed) controller.enqueue(encoder.encode(": ping\n\n"))
			}, HEARTBEAT_MS)
			// A market lasts a minute. A stream that has been open five is a leak.
			life = setTimeout(shutdown, MAX_LIFETIME_MS)
		},
		cancel() {
			if (timer) clearInterval(timer)
			if (beat) clearInterval(beat)
			if (life) clearTimeout(life)
		},
	})

	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-store, no-transform",
			connection: "keep-alive",
			"x-accel-buffering": "no",
		},
	})
}
