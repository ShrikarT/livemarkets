"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { FRAME_MS, FieldEngine, measureGrid, type Pointer } from "./field"

/**
 * Drives the ASCII field.
 *
 * Everything expensive about an animated background is handled here on purpose:
 *   - capped at 30fps, because the field is texture, not data
 *   - stops dead when the tab is hidden (no background battery drain)
 *   - stops when scrolled out of view
 *   - respects prefers-reduced-motion by rendering a single still frame
 *   - re-measures the grid on resize so characters never land off the cell grid
 *
 * The wordmark is always faintly in the field and resolves under the cursor, so
 * the brand is something you discover rather than something shouted at you.
 */

export type AsciiHeroProps = {
	word: string
	/** height of the field, in character rows */
	rows?: number
	className?: string
	style?: React.CSSProperties
}

export function AsciiHero({ word, rows = 18, className, style }: AsciiHeroProps) {
	const hostRef = useRef<HTMLDivElement | null>(null)
	const preRef = useRef<HTMLPreElement | null>(null)
	const engineRef = useRef<FieldEngine | null>(null)
	const pointerRef = useRef<Pointer>({ col: 0, row: 0, active: false })
	const [ready, setReady] = useState(false)

	// Measure in whole cells, then build the engine. Runs before paint so there is
	// no visible reflow from an initial wrong-sized field.
	useLayoutEffect(() => {
		const host = hostRef.current
		if (!host) return

		const build = () => {
			const styles = getComputedStyle(host)
			const cellW = parseFloat(styles.getPropertyValue("--cell-w")) || 8
			const cellH = parseFloat(styles.getPropertyValue("--cell-h")) || 16
			const { cols } = measureGrid(host.clientWidth, rows * cellH, cellW, cellH)
			engineRef.current = new FieldEngine({ cols, rows, word })
			if (preRef.current) preRef.current.textContent = engineRef.current.still()
			setReady(true)
		}

		build()
		const ro = new ResizeObserver(build)
		ro.observe(host)
		return () => ro.disconnect()
	}, [word, rows])

	useEffect(() => {
		if (!ready) return
		const pre = preRef.current
		const host = hostRef.current
		if (!pre || !host) return

		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
		if (reduced) {
			pre.textContent = engineRef.current?.still() ?? ""
			return
		}

		let raf = 0
		let last = 0
		let running = true
		const t0 = performance.now()

		const loop = (now: number) => {
			if (!running) return
			raf = requestAnimationFrame(loop)
			if (now - last < FRAME_MS) return // the 30fps cap
			last = now
			pre.textContent = engineRef.current?.render(now - t0, pointerRef.current) ?? ""
		}
		raf = requestAnimationFrame(loop)

		const pause = () => {
			running = false
			cancelAnimationFrame(raf)
		}
		const resume = () => {
			if (running) return
			running = true
			last = 0
			raf = requestAnimationFrame(loop)
		}

		const onVis = () => (document.hidden ? pause() : resume())
		document.addEventListener("visibilitychange", onVis)

		// Off-screen is as good a reason to stop as a hidden tab.
		const io = new IntersectionObserver(([entry]) => (entry?.isIntersecting ? resume() : pause()), {
			threshold: 0,
		})
		io.observe(host)

		const onMove = (e: PointerEvent) => {
			const rect = host.getBoundingClientRect()
			const styles = getComputedStyle(host)
			const cellW = parseFloat(styles.getPropertyValue("--cell-w")) || 8
			const cellH = parseFloat(styles.getPropertyValue("--cell-h")) || 16
			pointerRef.current = {
				col: Math.round((e.clientX - rect.left) / cellW),
				row: Math.round((e.clientY - rect.top) / cellH),
				active: true,
			}
		}
		const onLeave = () => (pointerRef.current = { ...pointerRef.current, active: false })

		host.addEventListener("pointermove", onMove)
		host.addEventListener("pointerleave", onLeave)

		return () => {
			pause()
			document.removeEventListener("visibilitychange", onVis)
			io.disconnect()
			host.removeEventListener("pointermove", onMove)
			host.removeEventListener("pointerleave", onLeave)
		}
	}, [ready])

	return (
		<div
			ref={hostRef}
			className={className}
			style={{ overflow: "hidden", height: `calc(${rows} * var(--cell-h))`, ...style }}
			aria-hidden="true"
		>
			<pre ref={preRef} className="ascii" style={{ margin: 0 }} />
		</div>
	)
}
