"use client"

import { useCallback, useEffect, useState } from "react"
import { useAccount, useSignMessage } from "wagmi"

import { REF_KEY } from "./ReferralCapture"

/**
 * The client half of referrals.
 *
 * The signature is the point. Crediting a referral requires the REFERRED address
 * to sign, so nobody can claim credit for strangers by scripting POSTs. See
 * lib/referral.ts.
 *
 * The message is fetched from the server rather than rebuilt here. If the client
 * composed its own copy, one stray character would make every signature fail
 * verification for reasons nobody could see.
 */

type Status = { count: number; persisted: boolean; message?: string }

export function ReferralPanel() {
	const { address, isConnected } = useAccount()
	const { signMessageAsync } = useSignMessage()

	const [pending, setPending] = useState<string | null>(null)
	const [status, setStatus] = useState<Status | null>(null)
	const [origin, setOrigin] = useState<string>("")
	const [busy, setBusy] = useState<boolean>(false)
	const [note, setNote] = useState<string | null>(null)
	const [credited, setCredited] = useState<boolean>(false)

	useEffect(() => {
		try {
			setPending(window.localStorage.getItem(REF_KEY))
			setOrigin(window.location.origin)
		} catch {
			/* storage unavailable */
		}
	}, [])

	const me = address ? address.toLowerCase() : null
	const selfReferral = Boolean(pending && me && pending === me)
	const attributable = Boolean(pending && me && pending !== me && !credited)

	const load = useCallback(async () => {
		if (!me) return
		const qs = new URLSearchParams({ who: me })
		if (pending && pending !== me) qs.set("ref", pending)
		try {
			const res = await fetch(`/api/referral?${qs.toString()}`, { cache: "no-store" })
			if (res.ok) setStatus((await res.json()) as Status)
		} catch {
			/* the empty state covers it */
		}
	}, [me, pending])

	useEffect(() => {
		void load()
	}, [load])

	const link = me ? `${origin}/app?ref=${me}` : ""

	const copy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(link)
			setNote("link copied")
		} catch {
			setNote("could not copy \u2014 select the link and copy it")
		}
	}, [link])

	const credit = useCallback(async () => {
		if (!me || !pending || !status?.message) return
		setBusy(true)
		setNote(null)
		try {
			const signature = await signMessageAsync({ message: status.message })
			const res = await fetch("/api/referral", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ referrer: pending, referred: me, signature }),
			})
			const body = (await res.json()) as { error?: string }
			if (!res.ok) {
				setNote(body.error ?? "could not credit that referral")
				return
			}
			setCredited(true)
			setNote("credited")
			await load()
		} catch {
			// A refused signature is a normal thing to do, not an error to shout about.
			setNote("not signed \u2014 nothing was sent")
		} finally {
			setBusy(false)
		}
	}, [load, me, pending, signMessageAsync, status])

	if (!isConnected || !me) {
		return (
			<div className="panel">
				<div className="panel-head">
					<span className="label">invite</span>
				</div>
				<div className="panel-body prose">
					<p style={{ margin: 0 }}>
						Sign in to get your invite link. Your link is just your address, so there is no code to lose and
						nothing to sign up for.
					</p>
					{pending ? (
						<p className="label" style={{ marginBottom: 0 }}>
							You arrived through {pending}. That is remembered until you sign in.
						</p>
					) : null}
				</div>
			</div>
		)
	}

	return (
		<div style={{ display: "grid", gap: "var(--s4)" }}>
			<div className="panel">
				<div className="panel-head">
					<span className="label">your invite link</span>
					<span className="label num">{status ? `${status.count} joined` : "reading\u2026"}</span>
				</div>
				<div className="panel-body" style={{ display: "grid", gap: "var(--s3)" }}>
					<code className="num" style={{ wordBreak: "break-all" }}>
						{link}
					</code>
					<div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap", alignItems: "center" }}>
						<button className="btn" onClick={() => void copy()}>
							Copy link
						</button>
						{note ? <span className="label">{note}</span> : null}
					</div>
					{status && status.persisted === false ? (
						<p className="label" style={{ margin: 0 }}>
							Not persisted: this deployment has no KV configured, so counts reset when the server restarts.
						</p>
					) : null}
				</div>
			</div>

			{attributable && status?.message ? (
				<div className="panel">
					<div className="panel-head">
						<span className="label">someone invited you</span>
					</div>
					<div className="panel-body" style={{ display: "grid", gap: "var(--s3)" }}>
						<p className="prose" style={{ margin: 0 }}>
							Credit <code>{pending}</code> for bringing you here. You sign a message so that only you can do
							this on your own behalf. It moves no funds and grants no permissions.
						</p>
						<pre className="ascii ascii-selectable" style={{ margin: 0 }}>
							{status.message}
						</pre>
						<div>
							<button className="btn btn-yes" disabled={busy} onClick={() => void credit()}>
								{busy ? "signing\u2026" : "Sign and credit"}
							</button>
						</div>
					</div>
				</div>
			) : selfReferral ? (
				<p className="label">That invite link was your own, so there is nothing to credit.</p>
			) : null}
		</div>
	)
}
