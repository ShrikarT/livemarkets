import { createWalletClient, http, isAddress, parseAbi, type Address } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import { activeChain } from "../../../config/chains"
import { faucet } from "../../../config/contracts"
import { addOnce, clientIp, get, hashIp, incr, kvConfigured, rateLimit, set } from "../../../lib/kv"
import { publicClient } from "../../../lib/market-client"

/**
 * POST /api/faucet  { address }
 *
 * Sends one small drip of test MON so a first-time visitor can place an order
 * without leaving the site, hunting for a faucet, solving a captcha and coming
 * back to find the round they wanted to trade has already settled.
 *
 * Guards, in order of how much they matter:
 *   1. The key never leaves the server and is never returned in a response.
 *   2. Zero-balance only. If you already have gas you do not need a handout.
 *   3. One drip per address, ever, enforced with an atomic set-add so two
 *      simultaneous requests cannot both win.
 *   4. A global daily cap, so the worst case for a leak is bounded and known.
 *   5. Per-IP rate limit on a hashed IP, so the log cannot be turned into a
 *      list of who visited.
 *
 * If FAUCET_PRIVATE_KEY is unset the route returns a clear 503 and the UI points
 * at faucet.monad.xyz instead. It never redirects the user off-site silently.
 */

export const runtime = "nodejs" // needs a real signer, not the edge runtime

const DAY = 86_400
const SPENT_KEY = () => `faucet:spent:${new Date().toISOString().slice(0, 10)}`
const DRIPPED = "faucet:dripped"

export async function POST(req: Request) {
	const key = process.env.FAUCET_PRIVATE_KEY
	if (!key) {
		return Response.json(
			{
				error: "the built-in faucet is not configured on this deployment",
				fallback: "https://faucet.monad.xyz",
			},
			{ status: 503 },
		)
	}

	let address: string
	try {
		const body = (await req.json()) as { address?: string }
		address = (body.address ?? "").trim()
	} catch {
		return Response.json({ error: "send a JSON body" }, { status: 400 })
	}

	if (!isAddress(address)) return Response.json({ error: "not a valid address" }, { status: 400 })
	const to = address as Address

	// hashed, salted, truncated — enough to rate limit, not enough to identify
	const ip = await hashIp(clientIp(req))
	if (!(await rateLimit(`faucet:ip:${ip}`, 3, DAY))) {
		return Response.json({ error: "this network has had its drips for today" }, { status: 429 })
	}

	// 2. Only fund empty accounts.
	const balance = await publicClient.getBalance({ address: to })
	if (balance > 0n) {
		return Response.json(
			{ error: "this address already holds MON, so it does not need a drip", balance: balance.toString() },
			{ status: 409 },
		)
	}

	// 3. One per address, forever. Atomic: the check *is* the write.
	const first = await addOnce(DRIPPED, to.toLowerCase())
	if (!first) {
		return Response.json(
			{ error: "this address has already been funded once", fallback: "https://faucet.monad.xyz" },
			{ status: 409 },
		)
	}

	// 4. Bounded daily loss.
	const spent = BigInt((await get(SPENT_KEY())) ?? "0")
	if (spent + faucet.dripWei > faucet.dailyCapWei) {
		return Response.json(
			{ error: "the faucet has hit its daily cap", fallback: "https://faucet.monad.xyz" },
			{ status: 429 },
		)
	}

	const account = privateKeyToAccount(key as `0x${string}`)
	const wallet = createWalletClient({ account, chain: activeChain, transport: http() })

	try {
		const hash = await wallet.sendTransaction({ to, value: faucet.dripWei })
		await set(SPENT_KEY(), String(spent + faucet.dripWei), DAY * 2)
		await incr("faucet:drips")
		return Response.json({
			hash,
			amount: faucet.dripWei.toString(),
			persisted: kvConfigured,
		})
	} catch (err) {
		// The address was already marked as dripped above. Leaving it marked on a
		// failed send is the safe direction to fail: worst case one address has to
		// use the public faucet, rather than one address draining this one.
		return Response.json(
			{
				error: "the drip could not be sent",
				detail: err instanceof Error ? err.message.slice(0, 200) : undefined,
				fallback: "https://faucet.monad.xyz",
			},
			{ status: 502 },
		)
	}
}

/** Public status, so the UI can hide the button instead of offering a dead one. */
export async function GET() {
	const spent = BigInt((await get(SPENT_KEY())) ?? "0")
	return Response.json({
		enabled: Boolean(process.env.FAUCET_PRIVATE_KEY),
		dripWei: faucet.dripWei.toString(),
		remainingTodayWei: (faucet.dailyCapWei - spent).toString(),
		persisted: kvConfigured,
	})
}

// parseAbi is imported to keep the surface obvious if this route ever needs to
// fund a contract call rather than a plain transfer.
void parseAbi
