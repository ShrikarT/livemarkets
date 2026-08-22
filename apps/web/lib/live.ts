"use client"

import { useEffect, useRef, useState } from "react"

import type { TickLevel } from "./market-math"
import type { SerialisedLevel, SerialisedSnapshot } from "./watcher"

export type { SerialisedLevel, SerialisedSnapshot }

/**
 * The client half of the shared watcher.
 *
 * Reading the book is a subscription, not a poll: lib/watcher.ts runs one loop
 * per market on the server and this hook attaches to it. What this file adds is
 * the part a stream cannot do for itself -- surviving its own failure.
 *
 * THREE THINGS THAT GO WRONG WITH SSE, AND WHAT IS DONE ABOUT EACH
 *
 *   1. It silently stalls. A proxy holds the connection open but stops
 *      delivering. EventSource reports nothing wrong, because from its point of
 *      view nothing is. So we do not trust the connection's opinion of its own
 *      health -- we watch the DATA. If no frame arrives for STALE_MS, we start
 *      polling in parallel and say so on screen.
 *
 *   2. It dies for good. Five-minute recycles, network changes, sleep/wake.
 *      EventSource retries on its own, so a reconnect needs no code -- but a
 *      DELIBERATE close (a resolved market) must not be mistaken for a fault,
 *      or we would reconnect forever to a finished book. Hence the readyState
 *      check in onerror.
 *
 *   3. The user's clock is wrong. Countdowns computed from a local Date.now()
 *      are wrong by however far the device has drifted, which on a market that
 *      lives sixty seconds is the difference between "you may still trade" and
 *      "you may not". Every frame carries the server's clock, so we measure the
 *      offset and hand it back as skewMs for callers to add.
 */

/** No frame for this long means the connection is lying about being alive. */
const STALE_MS = 8_000
/** How often the fallback reads the cached feed while the stream is unhealthy. */
const FALLBACK_POLL_MS = 2_000
/** Matches the 180ms fill-flash in globals.css, plus a frame of slack. */
const FLASH_MS = 220

export type LiveStatus = "connecting" | "live" | "polling" | "closed"

export type LiveMarket = {
	snapshot: SerialisedSnapshot | null
	status: LiveStatus
	/** ticks that just gained matched volume, for the fill flash */
	flashed: number[]
	/** add to Date.now() to get the server's clock */
	skewMs: number
}

/** The wire format keeps bigints as strings; the maths layer wants bigints. */
export function toTickLevels(levels: readonly SerialisedLevel[]): TickLevel[] {
	return levels.map((l) => ({
		openYes: BigInt(l.openYes),
		openNo: BigInt(l.openNo),
		matched: BigInt(l.matched),
	}))
}

export function useLiveMarket(address: string, initial: SerialisedSnapshot | null = null): LiveMarket {
	const [snapshot, setSnapshot] = useState<SerialisedSnapshot | null>(initial)
	const [status, setStatus] = useState<LiveStatus>(initial ? "live" : "connecting")
	const [flashed, setFlashed] = useState<number[]>([])
	const [skewMs, setSkewMs] = useState(0)

	// Last time ANY frame arrived, including pings. This is the real liveness
	// signal -- see note 1 above.
	const lastFrameRef = useRef<number>(Date.now())
	const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		if (!address) return

		let cancelled = false
		let source: EventSource | null = null
		let fallback: ReturnType<typeof setInterval> | null = null

		const accept = (next: SerialisedSnapshot) => {
			if (cancelled) return
			lastFrameRef.current = Date.now()
			// The server's clock minus ours. Positive means we are behind.
			if (typeof next.at === "number") setSkewMs(next.at - Date.now())
			setSnapshot(next)
		}

		const stopFallback = () => {
			if (fallback) clearInterval(fallback)
			fallback = null
		}

		/**
		 * Degrade to the cached feed route rather than to nothing. This is not the
		 * old per-viewer polling coming back: /api/feed is cached server-side, so a
		 * fallback reader is cheap and bounded.
		 */
		const startFallback = () => {
			if (fallback || cancelled) return
			setStatus("polling")
			const pull = async () => {
				try {
					const res = await fetch(`/api/feed/${address}`, { cache: "no-store" })
					if (!res.ok) return
					const body = (await res.json()) as SerialisedSnapshot
					if (body && Array.isArray(body.levels)) accept(body)
				} catch {
					// Offline. Keep the last known book on screen with the badge showing;
					// a stale price labelled stale beats an empty ladder.
				}
			}
			void pull()
			fallback = setInterval(() => void pull(), FALLBACK_POLL_MS)
		}

		try {
			source = new EventSource(`/api/stream/${address}`)
		} catch {
			startFallback()
			return () => {
				cancelled = true
				stopFallback()
			}
		}

		const es = source

		es.onopen = () => {
			lastFrameRef.current = Date.now()
			if (!cancelled) {
				setStatus("live")
				stopFallback()
			}
		}

		es.addEventListener("snapshot", (ev) => {
			try {
				accept(JSON.parse((ev as MessageEvent<string>).data) as SerialisedSnapshot)
				if (!cancelled) {
					setStatus("live")
					stopFallback()
				}
			} catch {
				/* a malformed frame is not worth tearing the stream down for */
			}
		})

		// Fills are announced separately from the book so the flash can fire on the
		// exact ticks that moved, rather than diffing nineteen levels in the client.
		es.addEventListener("fill", (ev) => {
			try {
				const data = JSON.parse((ev as MessageEvent<string>).data) as { ticks: number[] }
				lastFrameRef.current = Date.now()
				if (cancelled || !Array.isArray(data.ticks)) return
				setFlashed(data.ticks)
				if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
				flashTimerRef.current = setTimeout(() => {
					if (!cancelled) setFlashed([])
				}, FLASH_MS)
			} catch {
				/* ignore */
			}
		})

		es.addEventListener("phase", () => {
			lastFrameRef.current = Date.now()
		})

		es.addEventListener("warn", () => {
			// The server cannot reach the chain. The stream is fine; the data is not.
			lastFrameRef.current = Date.now()
			if (!cancelled) startFallback()
		})

		es.onerror = () => {
			if (cancelled) return
			// CLOSED means the server hung up deliberately -- a resolved market, or a
			// lifetime recycle. Treating that as a fault would mean reconnecting
			// forever to a book that is finished. CONNECTING means EventSource is
			// already retrying and will heal itself.
			if (es.readyState === EventSource.CLOSED) {
				setStatus("closed")
				startFallback()
			} else {
				startFallback()
			}
		}

		// The watchdog. Note it does not ask the connection whether it is well --
		// it checks whether data actually arrived.
		const watchdog = setInterval(() => {
			if (cancelled) return
			if (Date.now() - lastFrameRef.current > STALE_MS) startFallback()
		}, 1_000)

		return () => {
			cancelled = true
			clearInterval(watchdog)
			stopFallback()
			if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
			es.close()
		}
	}, [address])

	return { snapshot, status, flashed, skewMs }
}
