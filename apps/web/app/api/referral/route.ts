import { isAddress, type Address } from "viem"

import { attributionMessage, creditReferral, referralCount } from "../../../lib/referral"

/**
 * POST /api/referral  -- credit a referral, proven by a signature from the
 *                        REFERRED address. See lib/referral.ts for why a
 *                        signature is required rather than a bare counter.
 * GET  /api/referral?who=0x...  -- how many people this address has brought in.
 * GET  /api/referral?who=0x...&ref=0x...  -- also returns the exact message to
 *                        sign, so the client never has to construct it and the
 *                        two sides cannot drift.
 */

export const runtime = "nodejs"

export async function POST(req: Request) {
	let body: unknown
	try {
		body = await req.json()
	} catch {
		return Response.json({ error: "expected json" }, { status: 400 })
	}

	const { referrer, referred, signature } = (body ?? {}) as {
		referrer?: string
		referred?: string
		signature?: string
	}

	if (!referrer || !isAddress(referrer)) {
		return Response.json({ error: "referrer must be an address" }, { status: 400 })
	}
	if (!referred || !isAddress(referred)) {
		return Response.json({ error: "referred must be an address" }, { status: 400 })
	}
	if (!signature || !signature.startsWith("0x")) {
		return Response.json({ error: "signature required" }, { status: 400 })
	}

	const result = await creditReferral({
		referrer: referrer as Address,
		referred: referred as Address,
		signature: signature as `0x${string}`,
		req,
	})

	if (!result.ok) {
		return Response.json({ error: result.reason }, { status: result.status })
	}
	return Response.json({ credited: true, count: result.count, persisted: result.persisted })
}

export async function GET(req: Request) {
	const url = new URL(req.url)
	const who = url.searchParams.get("who")
	const ref = url.searchParams.get("ref")

	if (!who || !isAddress(who)) {
		return Response.json({ error: "who must be an address" }, { status: 400 })
	}

	const { count, persisted } = await referralCount(who as Address)

	// Handing back the message keeps one definition of it on the server.
	const message =
		ref && isAddress(ref) && ref.toLowerCase() !== who.toLowerCase()
			? attributionMessage({ referrer: ref as Address, referred: who as Address })
			: undefined

	return Response.json(
		{ who: who.toLowerCase(), count, persisted, message },
		{ headers: { "cache-control": "no-store" } },
	)
}
