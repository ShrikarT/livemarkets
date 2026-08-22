"use client"

import { useEffect, useState } from "react"

import { MarketCard } from "./ascii/MarketCard"
import type { HeroPayload } from "../lib/hero"
import type { TickLevel } from "../lib/market-math"

/**
 * Keeps the landing hero current without refreshing the landing page.
 *
 * Seeded from the server render, so the first paint already has real prices and
 * needs no JavaScript to be meaningful. The poll only ever REPLACES numbers that
 * are already on screen -- there is no loading state, no skeleton and no layout
 * shift, because the card is never empty.
 *
 * Four seconds, not one: this is a shop window, not a trading screen. Somebody
 * who wants tick-by-tick clicks through to the market page, which holds an
 * EventSource. The two clocks tick locally at 4Hz regardless, so the hero always
 * *looks* live even between polls.
 */

const POLL_MS = 4_000

export function HeroLive({ initial }: { initial: HeroPayload }) {
	const [payload, setPayload] = useState(initial)

	useEffect(() => {
		let alive = true
		let timer: ReturnType<typeof setInterval> | null = null

		const poll = async () => {
			try {
				const res = await fetch("/api/hero", { cache: "no-store" })
				if (!res.ok) return
				const next = (await res.json()) as HeroPayload
				if (alive && next?.market) setPayload(next)
			} catch {
				// Keep showing the last good numbers. The clocks keep running, and they
				// are what tell the viewer whether the round is still open.
			}
		}

		const start = () => {
			if (!timer) timer = setInterval(() => void poll(), POLL_MS)
		}
		const stop = () => {
			if (timer) clearInterval(timer)
			timer = null
		}
		// A backgrounded tab does not need prices.
		const onVis = () => {
			if (document.hidden) {
				stop()
			} else {
				void poll()
				start()
			}
		}

		document.addEventListener("visibilitychange", onVis)
		if (!document.hidden) start()

		return () => {
			alive = false
			stop()
			document.removeEventListener("visibilitychange", onVis)
		}
	}, [])

	const m = payload.market

	// JSON carried the book as decimal strings; the card and market-math want bigints.
	const levels: TickLevel[] = m.levels.map((l) => ({
		openYes: BigInt(l.openYes),
		openNo: BigInt(l.openNo),
		matched: BigInt(l.matched),
	}))

	return (
		<div style={ { display: "grid", gap: "var(--s3)" } }>
			<MarketCard
				size="hero"
				address={m.address}
				question={m.question}
				phase={m.phase}
				outcome={m.outcome}
				openUntil={m.openUntil}
				resolveAfter={m.resolveAfter}
				impliedBps={m.impliedBps}
				matchedWad={m.matchedWad}
				levels={levels}
				resolvingStartsAt={m.resolvingStartsAt}
				stamp={m.stamp}
				static={!m.linkable}
			/>

			{/*
			  When the card is not live, say so on the card rather than letting a
			  visitor assume those are real prices. This is the honesty label §9 asks
			  for, applied to the one surface that renders before anyone has connected
			  anything.
			*/}
			{!payload.live ? (
				<p className="label" style={ { margin: 0, lineHeight: 1.5 } }>
					this is a worked example, not a live book — {payload.reason ?? "no factory configured"}. deploy the
					contracts and set the factory address to see real rounds here.
				</p>
			) : null}
		</div>
	)
}
