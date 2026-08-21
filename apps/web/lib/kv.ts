/**
 * Tiny KV over Upstash's REST API.
 *
 * Deliberately dependency-free: it is four fetch calls, and adding an SDK to a
 * serverless bundle for four fetch calls is how cold starts get slow. If the
 * Upstash env vars are missing it falls back to an in-process Map, so `npm run
 * dev` works with no accounts and no signup — the fallback is loudly labelled
 * because a waitlist that quietly forgets everyone on redeploy is worse than one
 * that says it is not configured.
 */

const URL_ = process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

export const kvConfigured = Boolean(URL_ && TOKEN)

/** Dev-only fallback. Per-process, lost on restart, never used in production. */
const mem = new Map<string, string>()
const memSets = new Map<string, Set<string>>()

async function command<T = unknown>(args: (string | number)[]): Promise<T> {
	if (!kvConfigured) throw new Error("kv not configured")
	const res = await fetch(`${URL_}/${args.map((a) => encodeURIComponent(String(a))).join("/")}`, {
		headers: { Authorization: `Bearer ${TOKEN}` },
		cache: "no-store",
	})
	if (!res.ok) throw new Error(`kv ${args[0]} failed: ${res.status}`)
	const body = (await res.json()) as { result: T }
	return body.result
}

/** Atomic counter. Returns the value after incrementing. */
export async function incr(key: string, by = 1): Promise<number> {
	if (!kvConfigured) {
		const next = Number(mem.get(key) ?? 0) + by
		mem.set(key, String(next))
		return next
	}
	return Number(await command<number>(["incrby", key, by]))
}

export async function get(key: string): Promise<string | null> {
	if (!kvConfigured) return mem.get(key) ?? null
	return (await command<string | null>(["get", key])) ?? null
}

export async function set(key: string, value: string, ttlSeconds?: number): Promise<void> {
	if (!kvConfigured) {
		mem.set(key, value)
		return
	}
	await command(ttlSeconds ? ["set", key, value, "ex", ttlSeconds] : ["set", key, value])
}

/**
 * Add to a set. Returns true when the member was new, which is exactly the
 * primitive a "one drip per address, ever" rule needs — the check and the write
 * are one atomic operation, so two simultaneous requests cannot both win.
 */
export async function addOnce(key: string, member: string): Promise<boolean> {
	if (!kvConfigured) {
		const s = memSets.get(key) ?? new Set<string>()
		memSets.set(key, s)
		if (s.has(member)) return false
		s.add(member)
		return true
	}
	return Number(await command<number>(["sadd", key, member])) === 1
}

export async function setSize(key: string): Promise<number> {
	if (!kvConfigured) return memSets.get(key)?.size ?? 0
	return Number(await command<number>(["scard", key]))
}

/**
 * Fixed-window rate limit. Coarser than a sliding window and that is fine here:
 * the goal is to stop a script draining the faucet, not to be fair to the
 * millisecond.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
	const bucket = `${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`
	const hits = await incr(bucket)
	if (hits === 1 && kvConfigured) {
		// expire the window so old buckets do not accumulate
		await command(["expire", bucket, windowSeconds])
	}
	return hits <= limit
}

/** Hash an IP before storing it. Rate limiting does not need to know who you are. */
export async function hashIp(ip: string): Promise<string> {
	const salt = process.env.IP_HASH_SALT ?? "livemarkets-dev-salt"
	const data = new TextEncoder().encode(`${salt}:${ip}`)
	const digest = await crypto.subtle.digest("SHA-256", data)
	return Array.from(new Uint8Array(digest.slice(0, 8)))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
}

/** Best-effort client IP from the usual proxy headers. */
export function clientIp(req: Request): string {
	const fwd = req.headers.get("x-forwarded-for")
	if (fwd) return fwd.split(",")[0]!.trim()
	return req.headers.get("x-real-ip") ?? "0.0.0.0"
}
