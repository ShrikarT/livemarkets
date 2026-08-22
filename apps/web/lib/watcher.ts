import { chainTiming } from "../config/chains"
import { readSnapshot } from "./market-client"

/**
 * ONE poll loop per market, not one per visitor.
 *
 * THE PROBLEM THIS SOLVES
 *
 * The first version of /api/stream opened a fresh interval for every connected
 * browser. Ten people watching the same sixty-second round meant ten identical
 * eth_call storms against the same block -- about 300 RPC calls a minute for one
 * market, rising linearly with an audience. That is the exact shape of cost you
 * cannot afford on a product whose pitch is "come and watch", because being
 * popular is what breaks it.
 *
 * The fix is not a faster poll or a bigger rate limit. It is noticing that the
 * order book is the SAME OBJECT for every viewer. There is no per-user component
 * to a price. So the server keeps one watcher per market address, ref-counted by
 * subscriber, and fans the result out. The second viewer costs one Map lookup;
 * the two-hundredth costs one Map lookup.
 *
 * WHY readSnapshot IS CALLED WITHOUT `who`
 *
 * snapshot(who) also returns that address's balance and positions. Reading it
 * here with any particular account would be both wrong and a privacy leak: the
 * result is broadcast to every subscriber. So the shared layer reads the public
 * half only, and personal state stays a per-user read in the client. That split
 * is the whole design: shared data is shared, private data is not.
 */

export type SerialisedLevel = { openYes: string; openNo: string; matched: string }

export type SerialisedSnapshot = {
	address: string
	question: string
	phase: number
	outcome: number
	openUntil: number
	resolveAfter: number
	impliedBps: string
	levels: SerialisedLevel[]
	/**
	 * Server clock when this was read. The client uses it to measure its own skew,
	 * so a device with a wrong clock still gets honest countdowns.
	 */
	at: number
}

export type WatcherEvent =
	| { event: "snapshot"; data: SerialisedSnapshot }
	| { event: "fill"; data: { ticks: number[]; at: number } }
	| { event: "phase"; data: { phase: number; outcome: number; at: number } }
	| { event: "warn"; data: { message: string; at: number } }

type Subscriber = (e: WatcherEvent) => void

type Watcher = {
	subscribers: Set<Subscriber>
	timer: ReturnType<typeof setInterval> | null
	last: SerialisedSnapshot | null
	lastSignature: string
	failures: number
	startedAt: number
	polls: number
}

/**
 * Next dev recompiles the module graph on edit. A module-level Map would be
 * replaced on every hot reload, orphaning live intervals and leaking a poll loop
 * per save. Hanging state off globalThis survives that.
 */
const GLOBAL_KEY = "__livemarkets_watchers__"

type Registry = Map<string, Watcher>

function registry(): Registry {
	const g = globalThis as unknown as Record<string, Registry | undefined>
	let r = g[GLOBAL_KEY]
	if (!r) {
		r = new Map<string, Watcher>()
		g[GLOBAL_KEY] = r
	}
	return r
}

/**
 * Poll a little slower than the chain produces blocks. Polling faster than
 * blocks arrive cannot surface new information -- it just multiplies cost for
 * identical answers.
 */
export const POLL_MS = Math.max(250, Math.floor(chainTiming.blockMs * 1.25))

/** Cheap identity of the public book, used to suppress no-change traffic. */
function signature(s: SerialisedSnapshot): string {
	let acc = `${s.phase}|${s.outcome}|${s.impliedBps}|${s.openUntil}|${s.resolveAfter}`
	for (const l of s.levels) acc += `|${l.openYes},${l.openNo},${l.matched}`
	return acc
}

/** Which ticks gained matched volume between two reads -- i.e. what just filled. */
function filledTicks(prev: SerialisedSnapshot | null, next: SerialisedSnapshot): number[] {
	if (!prev) return []
	const out: number[] = []
	for (let i = 0; i < next.levels.length; i++) {
		const before = BigInt(prev.levels[i]?.matched ?? "0")
		const after = BigInt(next.levels[i]?.matched ?? "0")
		if (after > before) out.push(i)
	}
	return out
}

function emit(w: Watcher, e: WatcherEvent): void {
	for (const fn of w.subscribers) {
		try {
			fn(e)
		} catch {
			// One broken subscriber -- an aborted request, a closed socket -- must
			// never take down the loop that every other viewer depends on.
		}
	}
}

async function tick(address: string, w: Watcher): Promise<void> {
	w.polls++
	try {
		// Deliberately no `who`: this result is broadcast. See the header note.
		const snap = await readSnapshot(address as `0x${string}`)
		const next: SerialisedSnapshot = {
			address,
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
			at: Date.now(),
		}

		if (w.failures > 0) w.failures = 0

		const sig = signature(next)
		const phaseChanged = w.last !== null && (w.last.phase !== next.phase || w.last.outcome !== next.outcome)
		const fills = filledTicks(w.last, next)

		// A book that did not move produces no traffic. On a market with no orders
		// this is the difference between a stream that is silent and one that ships
		// nineteen unchanged levels every 500ms to every viewer.
		if (sig === w.lastSignature) {
			w.last = next
			return
		}

		w.lastSignature = sig
		w.last = next

		if (fills.length > 0) emit(w, { event: "fill", data: { ticks: fills, at: next.at } })
		if (phaseChanged) emit(w, { event: "phase", data: { phase: next.phase, outcome: next.outcome, at: next.at } })
		emit(w, { event: "snapshot", data: next })
	} catch (err) {
		w.failures++
		// Say it once, not every 500ms. Viewers keep the last known book on screen
		// with a staleness badge rather than being shown an empty ladder.
		if (w.failures === 3) {
			emit(w, {
				event: "warn",
				data: {
					message: err instanceof Error ? err.message : "rpc unreachable",
					at: Date.now(),
				},
			})
		}
	}
}

/**
 * Subscribe to a market's public book. Returns an unsubscribe function.
 *
 * The first subscriber starts the loop; the last one to leave stops it. Nothing
 * polls a market that nobody is watching.
 */
export function subscribe(address: string, fn: Subscriber): () => void {
	const key = address.toLowerCase()
	const reg = registry()
	let w = reg.get(key)

	if (!w) {
		w = {
			subscribers: new Set<Subscriber>(),
			timer: null,
			last: null,
			lastSignature: "",
			failures: 0,
			startedAt: Date.now(),
			polls: 0,
		}
		reg.set(key, w)
	}

	const watcher = w
	watcher.subscribers.add(fn)

	// Late joiners get the current book immediately instead of staring at an
	// empty ladder until the next poll boundary.
	if (watcher.last) {
		try {
			fn({ event: "snapshot", data: watcher.last })
		} catch {
			/* see emit() */
		}
	}

	if (!watcher.timer) {
		void tick(address, watcher)
		const timer = setInterval(() => void tick(address, watcher), POLL_MS)
		// Never hold a serverless invocation or a test runner open. Node's Timeout
		// has unref(); the DOM's number-based setInterval does not, so this is a
		// feature test rather than a cast we assert.
		const handle = timer as unknown as { unref?: () => void }
		if (typeof handle.unref === "function") handle.unref()
		watcher.timer = timer
	}

	return () => {
		watcher.subscribers.delete(fn)
		if (watcher.subscribers.size === 0) {
			if (watcher.timer) clearInterval(watcher.timer)
			watcher.timer = null
			// Keep `last` so the next arrival gets an instant first paint.
		}
	}
}

/** Last known book without subscribing -- used by the cached feed route. */
export function peek(address: string): SerialisedSnapshot | null {
	return registry().get(address.toLowerCase())?.last ?? null
}

/**
 * Exposed so the cost claim is checkable rather than merely asserted.
 * See /api/health.
 */
export function watcherStats(): {
	pollMs: number
	markets: number
	viewers: number
	detail: Array<{ address: string; viewers: number; polls: number; failures: number; ageSec: number }>
} {
	const reg = registry()
	const detail: Array<{ address: string; viewers: number; polls: number; failures: number; ageSec: number }> = []
	let viewers = 0
	for (const [address, w] of reg) {
		viewers += w.subscribers.size
		detail.push({
			address,
			viewers: w.subscribers.size,
			polls: w.polls,
			failures: w.failures,
			ageSec: Math.floor((Date.now() - w.startedAt) / 1000),
		})
	}
	return { pollMs: POLL_MS, markets: reg.size, viewers, detail }
}
