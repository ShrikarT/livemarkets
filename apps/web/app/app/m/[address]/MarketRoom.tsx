"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Address } from "viem"
import { useAccount, useWriteContract } from "wagmi"

import { Clocks } from "../../../../components/ascii/Clocks"
import { DepthLadder } from "../../../../components/ascii/DepthLadder"
import { OrderTicket } from "../../../../components/ascii/OrderTicket"
import { useToast } from "../../../../components/ascii/Toast"
import { StreamPanel } from "../../../../components/stream/StreamPanel"
import type { StreamMeta } from "../../../../lib/stream"
import { explorerAddress, explorerTx } from "../../../../config/chains"
import { protocol, trust } from "../../../../config/contracts"
import { ERROR_COPY, OUTCOME, PHASE, marketAbi } from "../../../../lib/abi"
import { publicClient, readSnapshot, type MarketSnapshot } from "../../../../lib/market-client"
import { formatBps, formatWad, legPrice, price, tickForBps } from "../../../../lib/market-math"

/**
 * The trading room.
 *
 * One market, polled once a second, with the whole book on screen. Three rules
 * shaped this component:
 *
 *   1. Reading is never gated behind a wallet. You can watch a round settle with
 *      no connection at all.
 *   2. Nothing is optimistic that could be wrong. The countdown and the ladder
 *      come from the chain; only the "sent" toast is local.
 *   3. Every refusal is explained before it costs gas. If the market is locked or
 *      the size is below the floor, the button says so instead of letting the
 *      user pay to be reverted.
 */

const POLL_MS = 1_000

function humanError(err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err)
	for (const [name, copy] of Object.entries(ERROR_COPY)) {
		if (msg.includes(name)) return copy
	}
	if (/User rejected|denied/i.test(msg)) return "Cancelled in your wallet."
	if (/insufficient funds/i.test(msg)) return "Not enough MON for this order plus gas."
	return "That did not go through. Nothing was spent."
}

export type MarketRoomProps = {
	address: Address
	/** rendered on the server so the question is visible before any JS runs */
	initialQuestion: string
	initialPhase: number
	initialOpenUntil: number
	initialResolveAfter: number
	/**
	 * The live surface for this market, resolved on the server (§3.1).
	 *
	 * null is a real state, not an error: it means nobody authored a stream row,
	 * which §3.2 says should never have got past /admin. The room says so plainly
	 * instead of rendering an empty 16:9 hole.
	 */
	streamMeta: StreamMeta | null
}

export function MarketRoom(props: MarketRoomProps) {
	const { address } = props
	const { address: account, isConnected } = useAccount()
	const { writeContractAsync } = useWriteContract()
	const toast = useToast()

	const [snap, setSnap] = useState<MarketSnapshot | null>(null)
	const [tick, setTick] = useState<number>(9) // 0.50 until the book says otherwise
	const [isYes, setIsYes] = useState(true)
	const [busy, setBusy] = useState(false)
	const [stale, setStale] = useState(false)
	const pickedRef = useRef(false)

	const refetch = useCallback(async () => {
		try {
			const s = await readSnapshot(address, account)
			setSnap(s)
			setStale(false)
			// Land the ticket on the market price the first time only, so it never
			// yanks the user's selection out from under them mid-typing.
			if (!pickedRef.current) {
				setTick(tickForBps(s.impliedBps))
				pickedRef.current = true
			}
		} catch {
			setStale(true)
		}
	}, [address, account])

	useEffect(() => {
		void refetch()
		let timer: ReturnType<typeof setInterval> | null = null
		const start = () => {
			if (!timer) timer = setInterval(() => void refetch(), POLL_MS)
		}
		const stop = () => {
			if (timer) clearInterval(timer)
			timer = null
		}
		const onVis = () => (document.hidden ? stop() : (void refetch(), start()))
		document.addEventListener("visibilitychange", onVis)
		if (!document.hidden) start()
		return () => {
			stop()
			document.removeEventListener("visibilitychange", onVis)
		}
	}, [refetch])

	const phase = snap?.phase ?? props.initialPhase
	const outcome = snap?.outcome ?? OUTCOME.Unresolved
	const open = phase === PHASE.Open

	/** Send a transaction, narrate it, then re-read the chain rather than guessing. */
	const send = useCallback(
		async (
			title: string,
			run: () => Promise<`0x${string}`>,
			opts: { tone?: "info" | "yes" | "no" } = {},
		) => {
			setBusy(true)
			try {
				const hash = await run()
				toast.push({ title, body: "sent · waiting for the block", tone: opts.tone ?? "info", href: explorerTx(hash) })
				const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
				if (receipt.status === "success") {
					toast.push({ title, body: "confirmed", tone: opts.tone ?? "yes", href: explorerTx(hash) })
				} else {
					toast.push({ title, body: "reverted onchain", tone: "no", href: explorerTx(hash) })
				}
				await refetch()
			} catch (err) {
				toast.push({ title, body: humanError(err), tone: "no" })
			} finally {
				setBusy(false)
			}
		},
		[refetch, toast],
	)

	const onSubmit = useCallback(
		({ tick: t, shares, isYes: side, costWei }: { tick: number; shares: bigint; isYes: boolean; costWei: bigint }) => {
			const have = snap?.balanceWei ?? 0n
			// place() is payable, so top up the difference in the same transaction
			// instead of making the user deposit first. One signature, not two.
			const value = costWei > have ? costWei - have : 0n
			void send(
				`Buy ${side ? "yes" : "no"} at ${formatBps(legPrice(t, side))}`,
				() =>
					writeContractAsync({
						address,
						abi: marketAbi,
						functionName: "place",
						args: [t, shares, side],
						value,
					}),
				{ tone: side ? "yes" : "no" },
			)
		},
		[address, send, snap?.balanceWei, writeContractAsync],
	)

	const positions = useMemo(() => {
		if (!snap) return []
		const rows: Array<{ tick: number; yes: bigint; no: bigint }> = []
		for (let i = 0; i < protocol.numTicks; i++) {
			const yes = snap.yesPositions[i] ?? 0n
			const no = snap.noPositions[i] ?? 0n
			if (yes > 0n || no > 0n) rows.push({ tick: i, yes, no })
		}
		return rows
	}, [snap])

	const claimable = phase === PHASE.Resolved && positions.length > 0

	return (
		<div className="theme-ink">
			<header
				className="wrap"
				style={ { display: "flex", gap: "var(--s3)", alignItems: "center", paddingTop: "var(--s4)", flexWrap: "wrap" } }
			>
				<Link className="btn btn-ghost" href="/app">
					← All rounds
				</Link>
				<a className="label" href={explorerAddress(address)} target="_blank" rel="noreferrer">
					{address}
				</a>
				{stale ? <span className="badge no">rpc unreachable · showing last known book</span> : null}
				<span className="badge" style={ { marginLeft: "auto" } } title={trust.detail}>
					{trust.label}
				</span>
			</header>

			<main className="wrap" style={ { paddingTop: "var(--s5)", paddingBottom: "var(--s8)" } }>
				<h1 className="display" style={ { fontSize: "var(--t-h2)", margin: "0 0 var(--s4)", maxWidth: "34ch" } }>
					{snap?.question ?? props.initialQuestion}
				</h1>

				{/*
				  TWO CLOCKS (§3.4), and both prices rather than one implied number.

				  ORDERS CLOSE decides whether you may trade. RESOLVES decides when you
				  get paid. A single countdown is what lets somebody on a delayed feed
				  believe they still have time on a round whose outcome has already
				  happened on a faster one.
				*/}
				<div style={ { display: "flex", gap: "var(--s6)", alignItems: "baseline", flexWrap: "wrap" } }>
					<div style={ { display: "flex", gap: "var(--s5)", alignItems: "baseline" } }>
						<div>
							<div className="num yes" style={ { fontSize: "var(--t-h1)", lineHeight: 1 } }>
								{formatBps(snap?.impliedBps ?? 5_000n)}
							</div>
							<span className="label">yes</span>
						</div>
						<div>
							<div className="num no" style={ { fontSize: "var(--t-h3)", lineHeight: 1 } }>
								{formatBps(10_000n - (snap?.impliedBps ?? 5_000n))}
							</div>
							<span className="label">no</span>
						</div>
					</div>
					<div style={ { minWidth: "260px" } }>
						<Clocks
							phase={phase}
							openUntil={snap?.openUntil ?? props.initialOpenUntil}
							resolveAfter={snap?.resolveAfter ?? props.initialResolveAfter}
							resolvingStartsAt={props.streamMeta?.resolvingStartsAt}
							windowSec={protocol.openSeconds}
							size="stack"
							outcomeLabel={outcome !== OUTCOME.Unresolved ? ["", "yes", "no", "void"][outcome] : undefined}
						/>
					</div>
				</div>

				{/*
				  §3.3: 62/38, and the stream sits ABOVE the book in the same column
				  rather than beside it. That is what keeps the book the primary object --
				  the player is capped at 62% of the row, is never full-bleed, and the
				  ladder is directly under it at the same width.
				*/}
				<div className="market-grid" style={ { marginTop: "var(--s6)" } }>
					<section style={ { display: "grid", gap: "var(--s4)" } }>
						{props.streamMeta ? (
							/* On a phone this pins to the top so the picture stays visible while
							   you scroll the book. It is dismissible and the choice persists. */
							<div className="stream-sticky">
								<StreamPanel meta={props.streamMeta} badge={open ? "live" : undefined} />
							</div>
						) : (
							<div className="panel">
								<div className="panel-head">
									<span className="label">no live surface for this market</span>
								</div>
								<div className="panel-body">
									<p className="label" style={ { margin: 0, lineHeight: 1.5 } }>
										every market is meant to carry exactly one stream row and this one has none. the book
										below is still live and both clocks are still authoritative, but a market nobody can watch
										should not have been created. add one in /admin.
									</p>
								</div>
							</div>
						)}

						<DepthLadder
							levels={snap?.levels ?? []}
							impliedBps={snap?.impliedBps ?? 5_000n}
							selectedTick={tick}
							interactive={open}
							onPickTick={(t) => {
								pickedRef.current = true
								setTick(t)
							}}
						/>

						{/* Anyone can crank. The reward is why this works without a
						    privileged keeper. */}
						<div style={ { display: "flex", gap: "var(--s3)", marginTop: "var(--s4)", flexWrap: "wrap" } }>
							<button
								className="btn btn-ghost"
								disabled={!isConnected || busy}
								onClick={() =>
									void send(`Match tick ${tick}`, () =>
										writeContractAsync({
											address,
											abi: marketAbi,
											functionName: "matchTick",
											args: [tick, 64],
										}),
									)
								}
								title={`Crank tick ${tick} and take ${protocol.crankShareBps / 100}% of the fee it generates`}
							>
								Match tick {tick} · earn {protocol.crankShareBps / 100}% of the fee
							</button>
							<button
								className="btn btn-ghost"
								disabled={!isConnected || busy}
								onClick={() =>
									void send(`Cancel resting ${isYes ? "yes" : "no"} orders at tick ${tick}`, () =>
										writeContractAsync({
											address,
											abi: marketAbi,
											functionName: "withdrawOrdersAt",
											args: [tick, isYes],
										}),
									)
								}
							>
								Cancel my unfilled orders here
							</button>
						</div>
					</section>

					<aside className="market-right">
						{/* On a phone the ticket pins to the bottom edge, so a side can be taken
						    without scrolling back past the book. */}
						<div className="ticket-sticky">
							<OrderTicket
								tick={tick}
								isYes={isYes}
								feeBps={protocol.feeBps}
								balanceWei={snap?.balanceWei ?? 0n}
								open={open}
								busy={busy}
								canSign={isConnected}
								onSideChange={setIsYes}
								onSubmit={onSubmit}
							/>
						</div>

						<div className="panel">
							<div className="panel-head">
								<span className="label">your position</span>
								{snap && snap.balanceWei > 0n ? (
									<span className="label num">{formatWad(snap.balanceWei)} MON idle</span>
								) : null}
							</div>
							<div className="panel-body">
								{positions.length === 0 ? (
									<p className="label" style={ { margin: 0 } }>
										{isConnected ? "Nothing filled yet at any price." : "Connect to see your fills. Watching needs no wallet."}
									</p>
								) : (
									<table className="table">
										<thead>
											<tr>
												<th>price</th>
												<th className="r">yes</th>
												<th className="r">no</th>
											</tr>
										</thead>
										<tbody>
											{positions.map((p) => (
												<tr key={p.tick}>
													<td className="num">{formatBps(price(p.tick))}</td>
													<td className="r num yes">{p.yes > 0n ? formatWad(p.yes) : "·"}</td>
													<td className="r num no">{p.no > 0n ? formatWad(p.no) : "·"}</td>
												</tr>
											))}
										</tbody>
									</table>
								)}

								{claimable ? (
									<button
										className="btn btn-yes"
										style={ { marginTop: "var(--s3)", width: "100%" } }
										disabled={busy}
										onClick={() =>
											void send(
												"Claim and withdraw",
												() =>
													writeContractAsync({
														address,
														abi: marketAbi,
														functionName: "claimAndWithdraw",
													}),
												{ tone: "yes" },
											)
										}
									>
										Claim winnings and withdraw
									</button>
								) : null}

								{snap && snap.balanceWei > 0n && !claimable ? (
									<button
										className="btn btn-ghost"
										style={ { marginTop: "var(--s3)", width: "100%" } }
										disabled={busy}
										onClick={() =>
											void send("Withdraw idle balance", () =>
												writeContractAsync({
													address,
													abi: marketAbi,
													functionName: "withdraw",
													args: [snap.balanceWei],
												}),
											)
										}
									>
										Withdraw {formatWad(snap.balanceWei)} MON
									</button>
								) : null}
							</div>
						</div>

						<p className="label" style={ { margin: 0 } }>
							One key decides this outcome ({trust.stage}). Fee is {protocol.feeBps / 100}% on winnings only, and
							nothing is charged on a void.
						</p>
					</aside>
				</div>
			</main>
		</div>
	)
}
