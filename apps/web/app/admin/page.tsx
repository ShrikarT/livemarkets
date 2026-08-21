"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { useAccount, useWriteContract } from "wagmi"

import { Countdown } from "../../components/ascii/Countdown"
import { ToastProvider, useToast } from "../../components/ascii/Toast"
import { brand } from "../../config/brand"
import { explorerTx } from "../../config/chains"
import { trust } from "../../config/contracts"
import { OUTCOME, PHASE, marketAbi } from "../../lib/abi"
import { publicClient, readMarketList, type MarketSnapshot } from "../../lib/market-client"
import { formatBps } from "../../lib/market-math"

/**
 * Resolver console.
 *
 * This is the most dangerous page in the product, so it is built to feel that way.
 *
 * Authorisation is deliberately NOT a signature check against an env allowlist.
 * An allowlist in an env var only decides who sees the buttons; the contract
 * decides who can actually resolve, and it already checks msg.sender == resolver.
 * A second, weaker gate in front of a real one is theatre, and theatre is how you
 * end up trusting the wrong thing. So the page asks the chain: it reads each
 * market's resolver and shows controls only when the connected address matches.
 *
 * Every resolution needs the outcome typed out in full. Muscle memory should not
 * be able to settle a market.
 */

const POLL_MS = 2_000
const SCAN = 24

type Pending = {
	snap: MarketSnapshot
	resolver: string
}

function AdminInner() {
	const { address: account, isConnected } = useAccount()
	const { writeContractAsync } = useWriteContract()
	const toast = useToast()

	const [rows, setRows] = useState<Pending[]>([])
	const [typed, setTyped] = useState("")
	const [target, setTarget] = useState<{ address: string; outcome: number; word: string } | null>(null)
	const [busy, setBusy] = useState(false)

	const refetch = useCallback(async () => {
		try {
			const snaps = await readMarketList(SCAN, account)
			const withResolver = await Promise.all(
				snaps.map(async (snap) => ({
					snap,
					resolver: (await publicClient.readContract({
						address: snap.address,
						abi: marketAbi,
						functionName: "resolver",
					})) as string,
				})),
			)
			setRows(withResolver)
		} catch {
			/* the empty state below covers it */
		}
	}, [account])

	useEffect(() => {
		void refetch()
		const t = setInterval(() => {
			if (!document.hidden) void refetch()
		}, POLL_MS)
		return () => clearInterval(t)
	}, [refetch])

	const mine = rows.filter((r) => account && r.resolver.toLowerCase() === account.toLowerCase())
	const awaiting = mine.filter((r) => r.snap.outcome === OUTCOME.Unresolved && r.snap.phase !== PHASE.Open)
	const notMine = rows.length - mine.length

	const resolve = useCallback(async () => {
		if (!target || typed.trim().toLowerCase() !== target.word) return
		setBusy(true)
		try {
			const hash = await writeContractAsync({
				address: target.address as `0x${string}`,
				abi: marketAbi,
				functionName: "resolve",
				args: [target.outcome],
			})
			toast.push({ title: `Resolved ${target.word}`, body: "sent", tone: "yes", href: explorerTx(hash) })
			await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
			setTarget(null)
			setTyped("")
			await refetch()
		} catch (err) {
			toast.push({
				title: "Not resolved",
				body: err instanceof Error && /TooEarly/.test(err.message) ? "the resolve window has not opened" : "reverted",
				tone: "no",
			})
		} finally {
			setBusy(false)
		}
	}, [refetch, target, toast, typed, writeContractAsync])

	const pause = useCallback(
		async (address: string, next: boolean) => {
			setBusy(true)
			try {
				const hash = await writeContractAsync({
					address: address as `0x${string}`,
					abi: marketAbi,
					functionName: "setTradingPaused",
					args: [next],
				})
				toast.push({ title: next ? "Trading paused" : "Trading resumed", tone: "info", href: explorerTx(hash) })
				await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
				await refetch()
			} finally {
				setBusy(false)
			}
		},
		[refetch, toast, writeContractAsync],
	)

	return (
		<div className="theme-ink">
			<header className="wrap" style={{ display: "flex", gap: "var(--s4)", alignItems: "center", paddingTop: "var(--s4)" }}>
				<Link href="/app" className="display" style={{ fontSize: "var(--t-lead)", letterSpacing: "0.14em", textDecoration: "none" }}>
					{brand.wordmark}
				</Link>
				<span className="badge no">resolver console</span>
				<Link className="btn btn-ghost" href="/app" style={{ marginLeft: "auto" }}>
					Back to rounds
				</Link>
			</header>

			<main className="wrap" style={{ paddingTop: "var(--s6)", paddingBottom: "var(--s8)" }}>
				<div className="panel" style={{ borderColor: "var(--no)" }}>
					<div className="panel-head">
						<span className="label">this is the centralisation risk</span>
					</div>
					<div className="panel-body prose">
						<p style={{ margin: 0 }}>
							{trust.detail} Resolving is final: <code>resolve()</code> reverts if the market is already settled, so
							there is no undo. {trust.roadmap[1]?.label} is next.
						</p>
					</div>
				</div>

				{!isConnected ? (
					<p className="label" style={{ marginTop: "var(--s5)" }}>
						Connect the resolver wallet. Nothing on this page works from any other address — the contract checks,
						not the page.
					</p>
				) : mine.length === 0 ? (
					<p className="label" style={{ marginTop: "var(--s5)" }}>
						This address does not resolve any of the {rows.length} recent markets. Nothing for you to do here.
					</p>
				) : (
					<>
						<h2 className="display" style={{ fontSize: "var(--t-h3)", margin: "var(--s6) 0 var(--s3)" }}>
							Awaiting an outcome ({awaiting.length})
						</h2>
						{awaiting.length === 0 ? (
							<p className="label">Every locked market you control is settled.</p>
						) : (
							<div style={{ display: "grid", gap: "var(--s4)" }}>
								{awaiting.map((r) => (
									<div className="panel" key={r.snap.address}>
										<div className="panel-head">
											<span className="label">{r.snap.address}</span>
											<span className="label num">{formatBps(r.snap.impliedBps)} implied</span>
										</div>
										<div className="panel-body" style={{ display: "grid", gap: "var(--s3)" }}>
											<strong style={{ fontSize: "var(--t-lead)" }}>{r.snap.question}</strong>
											<Countdown phase={r.snap.phase} openUntil={r.snap.openUntil} resolveAfter={r.snap.resolveAfter} />

											<div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
												<button
													className="btn btn-yes"
													disabled={busy}
													onClick={() => {
														setTyped("")
														setTarget({ address: r.snap.address, outcome: OUTCOME.Yes, word: "yes" })
													}}
												>
													Yes
												</button>
												<button
													className="btn btn-no"
													disabled={busy}
													onClick={() => {
														setTyped("")
														setTarget({ address: r.snap.address, outcome: OUTCOME.No, word: "no" })
													}}
												>
													No
												</button>
												<button
													className="btn btn-ghost"
													disabled={busy}
													onClick={() => {
														setTyped("")
														setTarget({ address: r.snap.address, outcome: OUTCOME.Void, word: "void" })
													}}
													title="Void refunds both legs at the price they paid and charges no fee"
												>
													Void
												</button>
												<button
													className="btn btn-ghost"
													disabled={busy}
													style={{ marginLeft: "auto" }}
													onClick={() => void pause(r.snap.address, true)}
												>
													Pause trading
												</button>
											</div>

											{target?.address === r.snap.address ? (
												<div className="panel" style={{ borderColor: "var(--no)" }}>
													<div className="panel-body" style={{ display: "grid", gap: "var(--s2)" }}>
														<span className="label">
															Type <strong>{target.word}</strong> to settle this market permanently
														</span>
														<div style={{ display: "flex", gap: "var(--s2)" }}>
															<input
																className="input"
																value={typed}
																autoFocus
																onChange={(e) => setTyped(e.target.value)}
																placeholder={target.word}
															/>
															<button
																className="btn btn-no"
																disabled={busy || typed.trim().toLowerCase() !== target.word}
																onClick={() => void resolve()}
															>
																{busy ? "signing…" : `Settle ${target.word}`}
															</button>
															<button className="btn btn-ghost" onClick={() => setTarget(null)}>
																Cancel
															</button>
														</div>
													</div>
												</div>
											) : null}
										</div>
									</div>
								))}
							</div>
						)}

						<p className="label" style={{ marginTop: "var(--s5)" }}>
							{notMine} of the {rows.length} recent markets are resolved by another address and are not shown.
						</p>
					</>
				)}
			</main>
		</div>
	)
}

export default function AdminPage() {
	return (
		<ToastProvider>
			<AdminInner />
		</ToastProvider>
	)
}
