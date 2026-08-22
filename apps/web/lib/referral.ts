import { isAddress, type Address } from "viem"

import { addOnce, clientIp, get, hashIp, incr, kvConfigured, rateLimit } from "./kv"
import { publicClient } from "./market-client"

/**
 * Referrals.
 *
 * WHY THIS NEEDS A SIGNATURE
 *
 * The easy version is an endpoint that takes { referrer, referred } and bumps a
 * counter. That is forgeable with curl: anyone can script a POST claiming credit
 * for every address that has ever traded, and whoever posts first wins. It is the
 * same mistake the leaderboard deliberately avoids -- a number anyone can invent
 * is worse than no number, because it invites people to trust it.
 *
 * So the REFERRED address has to sign the attribution. Only the person who was
 * actually referred can credit their referrer, and the signature is checked
 * against the chain rather than against a session or a cookie.
 *
 * WHY THE CODE IS JUST AN ADDRESS
 *
 * A short random code needs a stored code -> address mapping, which means the
 * link stops working when KV is not configured, and it introduces collisions and
 * an expiry story. An address is already public, already unique, and needs no
 * storage to issue. ?ref=0x... works on a fresh clone with no accounts.
 */

const DAY = 86_400

/** One address cannot be credited to two referrers, ever. */
const CREDITED = "ref:credited"
const COUNT = (who: string) => `ref:count:${who.toLowerCase()}`

/**
 * The exact text the referred user signs. It is deliberately readable, because
 * this appears in a wallet dialog and "sign this opaque hex" is how people get
 * phished. It names both parties so a signature captured for one referrer cannot
 * be replayed to credit another, and it says plainly that no funds move.
 */
export function attributionMessage(args: { referrer: Address; referred: Address }): string {
	return [
		"livemarkets referral",
		"",
		`referred: ${args.referred.toLowerCase()}`,
		`referrer: ${args.referrer.toLowerCase()}`,
		"",
		"signing this credits the referrer above for bringing you here.",
		"it moves no funds and grants no permissions.",
	].join("\n")
}

/** Parse a ?ref= value. Returns null rather than throwing on junk. */
export function referralCode(raw: string | null | undefined): Address | null {
	if (!raw) return null
	const trimmed = raw.trim()
	return isAddress(trimmed) ? (trimmed as Address) : null
}

export type CreditResult =
	| { ok: true; count: number; persisted: boolean }
	| { ok: false; status: number; reason: string }

/**
 * Credit a referral.
 *
 * Order matters: cheap local checks first, then the rate limit, then the
 * signature (which costs an RPC call for smart-contract accounts), and only then
 * the atomic one-per-address write. There is no point verifying a signature for
 * an address that has already been credited.
 */
export async function creditReferral(args: {
	referrer: Address
	referred: Address
	signature: `0x${string}`
	req: Request
}): Promise<CreditResult> {
	const referrer = args.referrer.toLowerCase() as Address
	const referred = args.referred.toLowerCase() as Address

	// Self-referral is the first thing anyone tries.
	if (referrer === referred) {
		return { ok: false, status: 400, reason: "an address cannot refer itself" }
	}

	const ip = await hashIp(clientIp(args.req))
	if (!(await rateLimit(`ref:ip:${ip}`, 20, DAY))) {
		return { ok: false, status: 429, reason: "too many attributions from this address today" }
	}

	// The proof. publicClient.verifyMessage is used rather than the standalone
	// helper because it also validates ERC-1271 smart-contract-account signatures
	// -- and this app is passkey-first, so a lot of users will not have an EOA.
	let valid = false
	try {
		valid = await publicClient.verifyMessage({
			address: referred,
			message: attributionMessage({ referrer, referred }),
			signature: args.signature,
		})
	} catch {
		// A verification that could not run is not a verification that passed.
		return { ok: false, status: 502, reason: "could not check the signature" }
	}
	if (!valid) {
		return { ok: false, status: 401, reason: "that signature is not from the referred address" }
	}

	// Atomic: two simultaneous requests cannot both win this.
	const first = await addOnce(CREDITED, referred)
	if (!first) {
		return { ok: false, status: 409, reason: "this address has already been attributed" }
	}

	const count = await incr(COUNT(referrer))
	return { ok: true, count, persisted: kvConfigured }
}

export async function referralCount(who: Address): Promise<{ count: number; persisted: boolean }> {
	const raw = await get(COUNT(who))
	return { count: Number(raw ?? 0), persisted: kvConfigured }
}
