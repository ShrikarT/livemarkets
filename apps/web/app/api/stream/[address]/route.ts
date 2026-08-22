import { isAddress } from "viem"

import { subscribe, type WatcherEvent } from "../../../../lib/watcher"

/**
 * Server-sent events for one market.
 *
 * This route used to own its own poll loop, which meant the RPC bill scaled with
 * the AUDIENCE rather than with the number of markets -- roughly 300 calls a
 * minute at ten viewers on a single round. It is now a thin adapter: all it does
 * is turn one subscription to the shared watcher into one SSE response.
 *
 * The important consequence is that this file no longer contains any polling,
 * any timing, or any RPC. If you want to change how often the book is read, that
 * decision lives in lib/watcher.ts, once, for every viewer.
 *
 * Why SSE and not a websocket: the data is one-directional. Orders go to the
 * chain through the user's wallet, never through this server, so there is
 * nothing to send upstream. SSE also survives proxies and reconnects on its own,
 * which a websocket does not.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Recycle the connection every five minutes. Long-lived streams get silently
 * severed by proxies and platform timeouts; a deliberate close with a retry hint
 * is a reconnect, while an unexpected one is a stall the viewer has to notice.
 */
const MAX_LIFETIME_MS = 5 * 60_000
const PING_MS = 15_000

type Params = { params: Promise<{ address: string }> }

export async function GET(req: Request, { params }: Params) {
	const { address } = await params
	if (!isAddress(address)) {
		return new Response("bad address", { status: 400 })
	}

	const encoder = new TextEncoder()

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false
			let unsubscribe: (() => void) | null = null
			let ping: ReturnType<typeof setInterval> | null = null
			let lifetime: ReturnType<typeof setTimeout> | null = null

			const teardown = () => {
				if (closed) return
				closed = true
				if (unsubscribe) unsubscribe()
				if (ping) clearInterval(ping)
				if (lifetime) clearTimeout(lifetime)
				try {
					controller.close()
				} catch {
					/* already closed by the platform */
				}
			}

			const write = (chunk: string) => {
				if (closed) return
				try {
					controller.enqueue(encoder.encode(chunk))
				} catch {
					// The client vanished mid-write. Stop, and let the watcher drop its
					// refcount so an unwatched market stops being polled.
					teardown()
				}
			}

			// Tell the browser how long to wait before reconnecting, so a recycled
			// connection comes back in two seconds instead of the default three.
			write("retry: 2000\n\n")

			unsubscribe = subscribe(address, (e: WatcherEvent) => {
				write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
				// A resolved market will never change again. Holding the connection
				// open would keep a poll loop alive for a book that is finished.
				if (e.event === "snapshot" && e.data.phase === 2) teardown()
			})

			// Comment frames keep intermediaries from treating a quiet book as a dead
			// connection. A market with no orders is silent by design.
			ping = setInterval(() => write(": ping\n\n"), PING_MS)
			lifetime = setTimeout(teardown, MAX_LIFETIME_MS)

			// Fires on navigation away, tab close, and refresh.
			req.signal.addEventListener("abort", teardown)
		},
	})

	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			// Nginx and friends will buffer an event stream into uselessness.
			"x-accel-buffering": "no",
		},
	})
}
