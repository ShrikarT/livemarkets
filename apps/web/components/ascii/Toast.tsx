"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

/**
 * Toasts, drawn in box characters.
 *
 * A 60-second market cannot afford a modal. Confirmations, fills and failures all
 * arrive as a stack of mono boxes in the corner, auto-dismissing after 4 seconds,
 * with the transaction hash always available because "it worked" is not evidence.
 */

export type ToastTone = "info" | "yes" | "no"

export type Toast = {
	id: number
	title: string
	body?: string
	tone: ToastTone
	href?: string
}

const LIFETIME_MS = 4_000
const WIDTH = 34

type Ctx = {
	push: (t: Omit<Toast, "id">) => void
}

const ToastCtx = createContext<Ctx | null>(null)

export function useToast(): Ctx {
	const ctx = useContext(ToastCtx)
	// Never throw from a hook used in a render path that also runs in the static
	// design previews; a no-op is fine there.
	return ctx ?? { push: () => {} }
}

export function ToastProvider({ children }: { children: ReactNode }) {
	const [items, setItems] = useState<Toast[]>([])

	const push = useCallback((t: Omit<Toast, "id">) => {
		const id = Date.now() + Math.random()
		setItems((prev) => [...prev.slice(-3), { ...t, id }])
	}, [])

	const value = useMemo(() => ({ push }), [push])

	return (
		<ToastCtx.Provider value={value}>
			{children}
			<div
				aria-live="polite"
				style={{
					position: "fixed",
					right: "var(--s5)",
					bottom: "var(--s5)",
					display: "grid",
					gap: "var(--s2)",
					zIndex: 40,
				}}
			>
				{items.map((t) => (
					<ToastBox key={t.id} toast={t} onDone={() => setItems((p) => p.filter((x) => x.id !== t.id))} />
				))}
			</div>
		</ToastCtx.Provider>
	)
}

export function ToastBox({ toast, onDone }: { toast: Toast; onDone: () => void }) {
	useEffect(() => {
		const id = setTimeout(onDone, LIFETIME_MS)
		return () => clearTimeout(id)
	}, [onDone])

	const color = toast.tone === "yes" ? "var(--yes)" : toast.tone === "no" ? "var(--no)" : "var(--fg)"
	const pad = (s: string) => s.slice(0, WIDTH - 2).padEnd(WIDTH - 2, " ")

	return (
		<div className="ascii" style={{ color, background: "var(--bg)", borderRadius: "var(--radius)" }}>
			<div>{`┌${"─".repeat(WIDTH - 2)}┐`}</div>
			<div>{`│${pad(` ${toast.title}`)}│`}</div>
			{toast.body ? <div className="muted">{`│${pad(` ${toast.body}`)}│`}</div> : null}
			{toast.href ? (
				<div>
					{"│"}
					<a href={toast.href} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
						{pad(" view transaction")}
					</a>
					{"│"}
				</div>
			) : null}
			<div>{`└${"─".repeat(WIDTH - 2)}┘`}</div>
		</div>
	)
}
