import { addOnce, clientIp, hashIp, incr, kvConfigured, rateLimit, setSize } from "../../../lib/kv"

/**
 * POST /api/waitlist
 *
 * Returns the caller's queue position, because a number is a receipt and "thanks!"
 * is not. Signing up twice returns the same position rather than pretending you
 * just joined again.
 */

export const runtime = "edge"

const COUNTER = "waitlist:count"
const MEMBERS = "waitlist:emails"
const POSITION = (email: string) => `waitlist:pos:${email}`

function normalise(email: string): string | null {
	const e = email.trim().toLowerCase()
	// Deliberately permissive: the point is to catch typos, not to police addresses.
	if (e.length < 5 || e.length > 254) return null
	if (!/^[^@\\s]+@[^@\\s.]+\\.[^@\\s]+$/.test(e)) return null
	return e
}

export async function POST(req: Request) {
	let email: string | null = null
	try {
		const body = (await req.json()) as { email?: string }
		email = normalise(body.email ?? "")
	} catch {
		return Response.json({ error: "send a JSON body" }, { status: 400 })
	}

	if (!email) return Response.json({ error: "that does not look like an email address" }, { status: 400 })

	// 10 signups per hour per IP. Generous for a human, useless for a script.
	const ip = await hashIp(clientIp(req))
	if (!(await rateLimit(`waitlist:ip:${ip}`, 10, 3_600))) {
		return Response.json({ error: "too many signups from here \\u2014 try again later" }, { status: 429 })
	}

	const isNew = await addOnce(MEMBERS, email)
	if (!isNew) {
		const existing = await getPosition(email)
		return Response.json({ position: existing, already: true, persisted: kvConfigured })
	}

	// Start at a number that reflects reality rather than flattering it.
	const position = await incr(COUNTER)
	await setPosition(email, position)

	return Response.json({ position, already: false, persisted: kvConfigured })
}

export async function GET() {
	return Response.json({ count: await setSize(MEMBERS), persisted: kvConfigured })
}

async function setPosition(email: string, position: number) {
	const { set } = await import("../../../lib/kv")
	await set(POSITION(email), String(position))
}

async function getPosition(email: string): Promise<number | null> {
	const { get } = await import("../../../lib/kv")
	const v = await get(POSITION(email))
	return v ? Number(v) : null
}
