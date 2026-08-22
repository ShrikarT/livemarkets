import { kindFromUrl, type StreamKind, type StreamMeta, type StreamMode } from "../lib/stream"

/**
 * What is live behind each market.
 *
 * WHERE THIS LIVES AND WHY
 * The authoritative per-market stream row lives in the indexer (see the `streams`
 * table), written by /admin when a market is created. That row is per-address, so
 * it cannot exist until the market exists.
 *
 * A series, though, produces a new market address every sixty seconds forever.
 * Re-authoring a stream row every minute is not operable, so a series carries a
 * TEMPLATE, committed here, and the indexer row overrides it when one exists.
 * Same reasoning as deployments/10143.json: a committed file is reviewable in a
 * diff, an env var is not.
 *
 * This is metadata, not market data. Every price, size and clock on every screen
 * still comes from the chain -- see the note in §12 about not shipping a
 * simulated mode. What is authored here is the same thing a broadcaster authors:
 * which picture goes with which question.
 */

export type StreamTemplate = {
	/** matched, case-insensitively, against the market question */
	match: string
	kind: StreamKind
	mode: StreamMode
	url?: string
	ref?: string
	title: string
	/** for kind "tape": which feed id in config/feeds.ts */
	symbol?: string
	estimatedDelaySec?: number
	resolutionSource: string

	/**
	 * Seconds AFTER orders close at which the interval being predicted begins.
	 *
	 * This is the §3.4 fix expressed as a constant. Because resolvingStartsAt is
	 * derived as openUntil + this, it is impossible to author a market whose
	 * trading window overlaps the interval it is about. Must be > 0.
	 */
	intervalStartsAfterCloseSec: number
}

/**
 * Order matters: the first template whose `match` appears in the question wins.
 *
 * §3.5's launch order is encoded here deliberately.
 *   1. price-at-a-future-timestamp -- immune to the delay problem by construction,
 *      settles from an exchange print, runs 24/7. This is the floor.
 *   2. round-based esports -- discrete, unambiguous, embeddable.
 *   3. cricket / football intervals -- discrete but rights-restricted, so link mode.
 * Stream and social "moments" are deliberately absent: they need a dispute layer
 * the v1 single resolver does not have.
 */
export const STREAM_TEMPLATES: StreamTemplate[] = [
	{
		match: "eth",
		kind: "tape",
		mode: "tape",
		title: "ETH / USDT, sixty-second window",
		symbol: "eth-usdt",
		resolutionSource: "Binance ETHUSDT last print at the resolve timestamp",
		intervalStartsAfterCloseSec: 1,
	},
	{
		match: "gas",
		kind: "tape",
		mode: "tape",
		title: "Monad testnet block gas",
		symbol: "eth-usdt",
		resolutionSource: "gasUsed of the first block at or after the resolve timestamp",
		intervalStartsAfterCloseSec: 1,
	},
	{
		match: "ct side",
		kind: "twitch",
		mode: "embed",
		url: "https://www.twitch.tv/esl_csgo",
		ref: "esl_csgo",
		title: "ESL · next round",
		estimatedDelaySec: 5,
		resolutionSource: "round-end scoreboard on the official broadcast",
		intervalStartsAfterCloseSec: 2,
	},
	{
		match: "boundary",
		kind: "external",
		mode: "link",
		url: "https://www.espncricinfo.com/live-cricket-score",
		title: "Live cricket · next over",
		estimatedDelaySec: 30,
		resolutionSource: "ball-by-ball commentary for the over named in the question",
		intervalStartsAfterCloseSec: 3,
	},
]

/**
 * The template a question falls under, or null.
 *
 * Returning null is a real answer: it means nobody authored a live surface for
 * this market, and §3.2 says a market without one should not have been created.
 * The market page says so instead of pretending.
 */
export function templateFor(question: string): StreamTemplate | null {
	const q = question.toLowerCase()
	for (const t of STREAM_TEMPLATES) {
		if (q.includes(t.match.toLowerCase())) return t
	}
	return null
}

/** Turn a template plus one market's own timing into a concrete stream row. */
export function metaFromTemplate(
	t: StreamTemplate,
	marketAddress: `0x${string}`,
	openUntil: number,
): StreamMeta {
	return {
		marketAddress,
		kind: t.kind,
		mode: t.mode,
		url: t.url,
		ref: t.ref,
		title: t.title,
		symbol: t.symbol,
		estimatedDelaySec: t.estimatedDelaySec,
		resolutionSource: t.resolutionSource,
		// The invariant, by construction: the interval always starts after the book
		// shuts, so no viewer can trade into an outcome another viewer has seen.
		resolvingStartsAt: openUntil + t.intervalStartsAfterCloseSec,
	}
}

/** Used by /admin to pre-fill the form from a pasted URL. */
export function guessKind(url: string): StreamKind {
	return kindFromUrl(url)
}
