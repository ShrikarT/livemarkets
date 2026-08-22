"use client"

import { useEffect, useState } from "react"

import { PriceTape } from "./PriceTape"
import { feedFor } from "../../config/feeds"
import { DELAY_DISCLAIMER, PLATFORM_LABEL, effectiveMode, embedUrlFor, type StreamMeta } from "../../lib/stream"

/**
 * The live surface. Three modes, all of them first-class.
 *
 *   embed  a 16:9 player in the left panel, book beside it.
 *   link   the platform mark, the title, and "watch on <platform>" opening a new
 *          tab, with the book at full width beneath. This is the CORRECT mode for
 *          most real sports rights -- not a degraded fallback -- and it is styled
 *          to look chosen rather than broken.
 *   tape   the always-on price market, which has no video.
 *
 * HARD constraints, all enforced here:
 *   - The book is always the primary object. The stream never exceeds 62% of the
 *     row on desktop (that split lives in .market-grid), is never full-bleed, and
 *     is never autoplaying with sound: muted and playsinline, always.
 *   - Never send a viewer to an external page for the MARKET. External is fine
 *     for the STREAM, which is exactly what link mode is.
 *   - Every embed carries the delay disclaimer. The app clock is the authority.
 *   - On mobile the stream is dismissible and the choice persists per market,
 *     because somebody already watching on a TV does not want a duplicate player
 *     eating a third of their phone.
 */

const HIDDEN_PREFIX = "lm:stream-hidden:"

export type StreamPanelProps = {
	meta: StreamMeta
	/** rendered in the head so the title line stays one row */
	badge?: string
}

export function StreamPanel({ meta, badge }: StreamPanelProps) {
	const [hidden, setHidden] = useState(false)
	const [origin, setOrigin] = useState<string | undefined>(undefined)

	// localStorage and window.location are client-only. Reading them in an effect
	// keeps the server render and the first client render identical, so there is no
	// hydration mismatch on a page whose whole point is being server-rendered.
	useEffect(() => {
		setOrigin(window.location.origin)
		try {
			setHidden(window.localStorage.getItem(HIDDEN_PREFIX + meta.marketAddress) === "1")
		} catch {
			/* storage disabled: default to showing the stream */
		}
	}, [meta.marketAddress])

	const persistHidden = (next: boolean) => {
		setHidden(next)
		try {
			if (next) window.localStorage.setItem(HIDDEN_PREFIX + meta.marketAddress, "1")
			else window.localStorage.removeItem(HIDDEN_PREFIX + meta.marketAddress)
		} catch {
			/* nothing to persist to; the session-local choice still applies */
		}
	}

	const mode = effectiveMode(meta, origin)

	if (mode === "tape") return <PriceTape feed={feedFor(meta.symbol)} />

	if (hidden) {
		return (
			<button type="button" className="stream-collapsed" onClick={() => persistHidden(false)}>
				<span aria-hidden="true">&gt;</span> stream hidden · tap to show
			</button>
		)
	}

	return (
		<div className="panel">
			<div className="panel-head">
				<span className="label">
					{PLATFORM_LABEL[meta.kind]} · {meta.title}
				</span>
				<span style={ { display: "flex", gap: "var(--s2)", alignItems: "center" } }>
					{badge ? <span className="badge badge-live">{badge}</span> : null}
					<button type="button" className="badge" onClick={() => persistHidden(true)} aria-label="hide the stream">
						hide <span aria-hidden="true">^</span>
					</button>
				</span>
			</div>

			<div className="panel-body" style={ { display: "grid", gap: "var(--s3)" } }>
				{mode === "embed" ? <Player meta={meta} origin={origin} /> : <WatchElsewhere meta={meta} />}

				{/*
				  HARD: every embed carries this. A viewer 30 seconds behind must not
				  believe the picture is the source of truth about whether they can still
				  trade.
				*/}
				<p className="delay-note" style={ { margin: 0 } }>
					{DELAY_DISCLAIMER}
					{meta.estimatedDelaySec ? ` · this feed runs about ${meta.estimatedDelaySec}s behind` : ""}
				</p>

				{meta.resolutionSource ? (
					<p className="label" style={ { margin: 0, lineHeight: 1.5 } }>
						settles from: {meta.resolutionSource}
					</p>
				) : null}
			</div>
		</div>
	)
}

function Player({ meta, origin }: { meta: StreamMeta; origin?: string }) {
	const src = embedUrlFor(meta, origin)

	// hls is a <video>, everything else framable is an <iframe>.
	if (meta.kind === "hls" && src) {
		return (
			<div className="frame-16x9">
				{/* muted and playsInline are not negotiable: a market page must never
				    make noise, and iOS refuses to play inline without them. */}
				<video src={src} autoPlay muted playsInline controls preload="metadata" />
			</div>
		)
	}

	if (!src) return <WatchElsewhere meta={meta} />

	return (
		<div className="frame-16x9">
			<iframe
				src={src}
				title={meta.title}
				allow="autoplay; encrypted-media; picture-in-picture"
				allowFullScreen
				loading="lazy"
				referrerPolicy="strict-origin-when-cross-origin"
			/>
		</div>
	)
}

/**
 * link mode. Rights-restricted broadcast, X Spaces, anything that refuses to be
 * framed.
 *
 * The design job here is to make this read as a deliberate choice. A grey box
 * saying "cannot embed" tells the user the product is broken; a panel with the
 * platform, the title and a clear outbound action tells them where to watch while
 * they trade here.
 */
function WatchElsewhere({ meta }: { meta: StreamMeta }) {
	const platform = PLATFORM_LABEL[meta.kind]
	return (
		<div
			style={ {
				border: "var(--rule-w) solid var(--line)",
				borderRadius: "var(--radius)",
				padding: "var(--s5)",
				display: "grid",
				gap: "var(--s3)",
			} }
		>
			<span className="label">live on {platform}</span>
			<h3 className="display" style={ { margin: 0, fontSize: "var(--t-h3)" } }>
				{meta.title}
			</h3>
			<p className="muted" style={ { margin: 0, fontSize: "var(--t-small)", maxWidth: "52ch" } }>
				{platform} does not allow this broadcast to be embedded. Open it in a second tab and keep this one for the
				book — the market, both clocks and your position all stay here.
			</p>
			{meta.url ? (
				<a className="btn btn-ghost" href={meta.url} target="_blank" rel="noreferrer" style={ { justifySelf: "start" } }>
					watch on {platform.toLowerCase()} <span aria-hidden="true">-&gt;</span>
				</a>
			) : null}
		</div>
	)
}
