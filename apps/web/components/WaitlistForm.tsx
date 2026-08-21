"use client"

import { useState } from "react"

/**
 * Waitlist.
 *
 * Returns the caller's queue position, because "thanks, we'll be in touch" tells
 * you nothing and feels like a form that went nowhere. A number is a receipt.
 */
export function WaitlistForm() {
	const [email, setEmail] = useState("")
	const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle")
	const [position, setPosition] = useState<number | null>(null)
	const [message, setMessage] = useState<string | null>(null)

	async function submit(e: React.FormEvent) {
		e.preventDefault()
		if (state === "sending") return
		setState("sending")
		setMessage(null)
		try {
			const res = await fetch("/api/waitlist", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email }),
			})
			const body = (await res.json()) as { position?: number; error?: string }
			if (!res.ok) throw new Error(body.error ?? "could not join")
			setPosition(body.position ?? null)
			setState("done")
		} catch (err) {
			setState("error")
			setMessage(err instanceof Error ? err.message : "could not join")
		}
	}

	if (state === "done") {
		return (
			<div className="panel" style={{ padding: "var(--s4)" }}>
				<div className="ascii" style={{ color: "var(--yes)" }}>
					{position !== null ? `you're #${position} in the queue` : "you're on the list"}
				</div>
				<p className="label" style={{ marginTop: "var(--s2)", marginBottom: 0 }}>
					Testnet is open to everyone right now — the queue is for mainnet.
				</p>
			</div>
		)
	}

	return (
		<form onSubmit={submit} style={{ display: "grid", gap: "var(--s2)" }}>
			<label className="label" htmlFor="lm-email">
				Get told when mainnet opens
			</label>
			<div style={{ display: "flex", gap: "var(--s2)" }}>
				<input
					id="lm-email"
					className="input"
					type="email"
					required
					autoComplete="email"
					placeholder="you@example.com"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
				/>
				<button className="btn" type="submit" disabled={state === "sending"}>
					{state === "sending" ? "…" : "Join"}
				</button>
			</div>
			{message ? (
				<span className="label" style={{ color: "var(--no)" }}>
					{message}
				</span>
			) : null}
		</form>
	)
}
