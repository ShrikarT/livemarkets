"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

/**
 * Keeps a server-rendered page live without turning it into a client app.
 *
 * The market list is a server component so the RPC calls happen once, server
 * side, instead of once per visitor's browser. This nudges it to re-fetch on an
 * interval, and stops entirely when the tab is hidden — nobody needs a market
 * list refreshing in a background tab at 400ms.
 */
export function Refresher({ intervalMs = 2_000 }: { intervalMs?: number }) {
	const router = useRouter()

	useEffect(() => {
		let timer: ReturnType<typeof setInterval> | null = null

		const start = () => {
			if (timer) return
			timer = setInterval(() => router.refresh(), intervalMs)
		}
		const stop = () => {
			if (!timer) return
			clearInterval(timer)
			timer = null
		}

		const onVis = () => (document.hidden ? stop() : (router.refresh(), start()))
		document.addEventListener("visibilitychange", onVis)
		if (!document.hidden) start()

		return () => {
			stop()
			document.removeEventListener("visibilitychange", onVis)
		}
	}, [router, intervalMs])

	return null
}
