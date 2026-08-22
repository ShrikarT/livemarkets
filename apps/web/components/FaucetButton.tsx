"use client"

import { useCallback, useEffect, useState } from "react"
import { useAccount, useBalance } from "wagmi"

import { faucet } from "../config/contracts"
import { formatWad } from "../lib/market-math"

/**
 * Gets a new account its first test MON without leaving the app.
 *
 * WHY THIS REPLACED A LINK
 *
 * The old build sent people to an external faucet. That is the single worst
 * moment in the funnel: a first-time user who has just signed in is pushed to a
 * third-party page, told to solve something, and asked to come back -- and most
 * of them do not. It also made the app's usability depend on somebody else's
 * uptime.
 *
 * /api/faucet already implements four guards (per-IP rate limit on a hashed IP,
 * one lifetime drip per address, a zero-balance check, and a daily cap), so the
 * button is purely the honest surface for a facility that exists.
 *
 * IT RENDERS NOTHING WHEN IT CANNOT HELP
 *
 * Disabled buttons that explain nothing are worse than absent ones. If the
 * faucet is switched off, or you are not signed in, or you already hold MON,
 * there is nothing here at all -- because a funded user does not need a faucet
 * and should not be looking at a dead control.
 */
export function FaucetButton() {
	const { address, isConnected } = useAccount()
	const { data: balance, refetch } = useBalance({ address })
	const [busy, setBusy] = useState(false)
	const [message, setMessage] = useState<string | null>(null)
	const [enabled, setEnabled] = useState<boolean | null>(null)

	useEffect(() => {
		let live = true
		void (async () => {
			try {
				const res = await fetch("/api/faucet", { cache: "no-store" })
				const body = (await res.json()) as { enabled?: boolean }
				if (live) setEnabled(Boolean(body.enabled))
			} catch {
				if (live) setEnabled(false)
			}
		})()
		return () => {
			live = false
		}
	}, [])

	const drip = useCallback(async () => {
		if (!address) return
		setBusy(true)
		setMessage(null)
		try {
			const res = await fetch("/api/faucet", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ to: address }),
			})
			const body = (await res.json()) as { error?: string; hash?: string }
			if (!res.ok) {
				// Show the server's own words. It knows which of the four guards
				// refused, and a generic "something went wrong" would hide that.
				setMessage(body.error ?? "the faucet turned that down")
			} else {
				setMessage("sent \u00b7 arriving in a block or two")
				// The transfer needs a block to land, so re-read shortly rather than
				// immediately showing an unchanged balance.
				setTimeout(() => void refetch(), 2_000)
			}
		} catch {
			setMessage("could not reach the faucet")
		} finally {
			setBusy(false)
		}
	}, [address, refetch])

	const funded = (balance?.value ?? 0n) > 0n
	// Nothing useful to offer -> render nothing at all.
	if (!isConnected || enabled === false || enabled === null) return null
	if (funded && !message) return null

	return (
		<span style={{ display: "inline-flex", gap: "var(--s2)", alignItems: "center" }}>
			{!funded ? (
				<button className="btn btn-ghost" onClick={() => void drip()} disabled={busy}>
					{busy ? "sending\u2026" : `get ${formatWad(faucet.dripWei)} test MON`}
				</button>
			) : null}
			{message ? <span className="label">{message}</span> : null}
		</span>
	)
}
