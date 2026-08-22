"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { Address } from "viem"
import { useAccount, useWriteContract } from "wagmi"

import { Clocks } from "./ascii/Clocks"
import { DepthLadder } from "./ascii/DepthLadder"
import { OrderTicket } from "./ascii/OrderTicket"
import { useToast } from "./ascii/Toast"
import { StreamPanel } from "./stream/StreamPanel"
import { explorerAddress, explorerTx } from "../config/chains"
import { protocol, trust } from "../config/contracts"
import { ERROR_COPY, OUTCOME, PHASE, marketAbi } from "../lib/abi"
import { toTickLevels, useLiveMarket, type SerialisedLevel, type SerialisedSnapshot } from "../lib/live"
import { publicClient, readSnapshot, type MarketSnapshot } from "../lib/market-client"
import { formatBps, formatWad, legPrice, price, tickForBps, type TickLevel } from "../lib/market-math"
import { useMyOrders } from "../lib/orders"
import type { StreamMeta } from "../lib/stream"

/**
 * The trading room. Mounted both at /app/m/<address> and, full size, at /app.
 *
 * Three rules shaped this component:
 *
 *   1. Reading is never gated behind a wallet. You can watch a round settle with
 *      no connection at all.
 *   2. Nothing is optimistic that could be wrong. The countdowns and the ladder
 *      come from the chain; only the "sent" toast is local.
 *   3. Every refusal is explained before it costs gas. If the market is shut or
 *      the size is below the floor, the button says so instead of letting the
 *      user pay to be reverted.
 *
 * WHAT CHANGED -- and why it is the same shape, not a rewrite:
 *
 * The room used to poll readSnapshot once a second for everything, which put the
 * whole order book on a per-visitor RPC budget. Ten people watching one market
 * cost ten times as much as one person watching it, for identical data. So the
 * two kinds of state are now split by who owns them:
 *
 *   THE BOOK is the same object for every viewer -- prices, depth, phase,
 *   outcome. It arrives over one server-sent stream shared by everyone watching
 *   this market (lib/watcher.ts), so the tenth viewer is free.
 *
 *   YOUR POSITION is yours alone -- balance, fills, resting orders. It cannot be
 *   shared, so it is still polled, but four times slower, because unlike the book
 *   it only changes when you act.
 */

function humanError(err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err)
	for (const [name, copy] of Object.entries(ERROR_COPY)) {
		if (msg.includes(name)) return copy
	}
	if (/User rejected|denied/i.test(msg)) return "Cancelled in your wallet."
	if (/insufficient funds/i.test(msg)) return "Not enough MON for this order plus gas."
	return "That did not go through. Nothing was spent."
}

/** Personal data changes only when you act, so it does not need a fast clock. */
const ME_POLL_MS = 4_000
const COACH_KEY = "lm:coached"

export type MarketRoomProps = {
	address: Address
	/** rendered on the server so the question is readable before any JS runs */
	initialQuestion: string
	initialPhase: number
	initialOpenUntil: number
	initialResolveAfter: number
	initialImpliedBps?: string
	initialLevels?: SerialisedLevel[]
	/**
	 * Server clock at render time.
	 *
	 * Passed rather than read from Date.now() so the first paint agrees on both
	 * sides of hydration, and so a device with a badly wrong clock cannot be shown
	 * a market as tradeable when it is not.
	 */
	serverNow: number
	/**
	 * The live surface for this market, resolved on the server.
	 *
	 * null is a real state, not an error: it means nobody authored a stream row,
	 * which /admin is supposed to prevent. The room says so plainly instead of
	 * rendering an empty 16:9 hole.
	 */
	streamMeta: StreamMeta | null
	/** other rounds, rendered above the question when this is the /app home */
	strip?: ReactNode
	backHref?: string
	backLabel?: string
	/** false when the page already supplies its own nav */
	chrome?: boolean
}

export function MarketRoom(props: MarketRoomProps) {
	const { address, chrome = true } = props
	const { address: account, isConnected } = useAccount()
	const { writeContractAsync } = useWriteContract()
	const toast = useToast()

	// ---- the shared half: the book, over one stream per market ----------------
	const initialSnapshot: SerialisedSnapshot | null = useMemo(
		() =>
			props.initialLevels
				? {
						address,
						question: props.initialQuestion,
						phase: props.initialPhase,
						outcome: OUTCOME.Unresolved,
						openUntil: props.initialOpenUntil,
						resolveAfter: props.initialResolveAfter,
						impliedBps: props.initialImpliedBps ?? "5000",
						levels: props.initialLevels,
						at: props.serverNow,
					}
				: null,
		[address],
	)
	const live = useLiveMarket(address, initialSnapshot)

	// ---- the private half: balance, fills, resting orders ---------------------
	const [me, setMe] = useState<MarketSnapshot | null>(null)
	const [busy, setBusy] = useState(false)

	const refetchMe = useCallback(async () => {
		if (!account) {
			setMe(null)
			return
		}
		try {
			setMe(await readSnapshot(address, account))
		} catch {
			// The book is still streaming; a failed personal read is not an outage.
		}
	}, [address, account])

	useEffect(() => {
		void refetchMe()
		if (!account) return
		let timer: ReturnType<typeof setInterval> | null = null
		const start = () => {
			if (!timer) timer = setInterval(() => void refetchMe(), ME_POLL_MS)
		}
		const stop = () => {
			if (timer) clearInterval(timer)
			timer = null
		}
		// A backgrounded tab is not a viewer. Stop spending on it.
		const onVis = () => {
			if (document.hidden) stop()
			else {
				void refetchMe()
				start()
			}
		}
		document.addEventListener("visibilitychange", onVis)
		if (!document.hidden) start()
		return () => {
			stop()
			document.removeEventListener("visibilitychange", onVis)
		}
	}, [refetchMe, account])

	// ---- one ticket, driven by one tap on the ladder --------------------------
	const [tick, setTick] = useState<number>(9) // 0.50 until the book says otherwise
	const [isYes, setIsYes] = useState(true)
	const pickedRef = useRef(false)

	const snapLevels: TickLevel[] = useMemo(
		() => (live.snapshot ? toTickLevels(live.snapshot.levels) : (me?.levels ?? [])),
		[live.snapshot, me],
	)
	const impliedBps = live.snapshot ? BigInt(live.snapshot.impliedBps) : (me?.impliedBps ?? 5_000n)
	const phase = live.snapshot?.phase ?? me?.phase ?? props.initialPhase
	const outcome = live.snapshot?.outcome ?? me?.outcome ?? OUTCOME.Unresolved
	const openUntil = live.snapshot?.openUntil ?? me?.openUntil ?? props.initialOpenUntil
	const resolveAfter = live.snapshot?.resolveAfter ?? me?.resolveAfter ?? props.initialResolveAfter

	// Land the ticket on the market price once, so it never yanks the user's own
	// selection out from under them mid-typing.
	useEffect(() => {
		if (pickedRef.current) return
		if (!live.snapshot && !me) return
		setTick(tickForBps(impliedBps))
		pickedRef.current = true
	}, [impliedBps, live.snapshot, me])

	const myOrders = useMyOrders(address, account, {
		enabled: isConnected && phase !== PHASE.Resolved,
		focusTick: tick,
	})

	// ---- the tradeability gate -----------------------------------------------
	//
	// A market must stop being tradeable the moment the interval it is ABOUT
	// begins -- not when openUntil elapses. Those are different instants, and the
	// gap between them is exactly where somebody watching a forty-second broadcast
	// delay can bet on something that has already happened. openUntil is the
	// contract's guard; resolvingStartsAt is the honest one, and it is stricter.
	const [now, setNow] = useState(props.serverNow)
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now() + live.skewMs), 500)
		return () => clearInterval(t)
	}, [live.skewMs])

	const resolvingStartsAt = props.streamMeta?.resolvingStartsAt
	const resolvingStarted = typeof resolvingStartsAt === "number" && now >= resolvingStartsAt * 1_000
	const open = phase === PHASE.Open && !resolvingStarted

	// ---- transactions --------------------------------------------------------
	const send = useCallback(
		async (
			title: string,
			run: () => Promise<`0x${string}`>,
			opts: { tone?: "info" | "yes" | "no"; touchedTick?: number } = {},
		) => {
			setBusy(true)
			try {
				const hash = await run()
				toast.push({
					title,
					body: "sent \u00b7 waiting for the block",
					tone: opts.tone ?? "info",
					href: explorerTx(hash),
				})
				const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
				if (receipt.status === "success") {
					toast.push({ title, body: "confirmed", tone: opts.tone ?? "yes", href: explorerTx(hash) })
				} else {
					toast.push({ title, body: "reverted onchain", tone: "no", href: explorerTx(hash) })
				}
				await refetchMe()
				myOrders.refresh(opts.touchedTick)
			} catch (err) {
				toast.push({ title, body: humanError(err), tone: "no" })
			} finally {
				setBusy(false)
			}
		},
		[refetchMe, toast, myOrders],
	)

	const [coached, setCoached] = useState(true)
	useEffect(() => {
		try {
			setCoached(window.localStorage.getItem(COACH_KEY) === "1")
		} catch {
			setCoached(true)
		}
	}, [])
	const dismissCoach = useCallback(() => {
		setCoached(true)
		try {
			window.localStorage.setItem(COACH_KEY, "1")
		} catch {
			/* private browsing; the mark simply returns next time */
		}
	}, [])

	const onSubmit = useCallback(
		(a: { tick: number; shares: bigint; isYes: boolean; costWei: bigint }) => {
			const have = me?.balanceWei ?? 0n
			// place() is payable, so top up the difference in the same transaction
			// rather than making the user deposit first. One signature, not two.
			const value = a.costWei > have ? a.costWei - have : 0n
			dismissCoach()
			void send(
				`Buy ${a.isYes ? "yes" : "no"} at ${formatBps(legPrice(a.tick, a.isYes))}`,
				() =>
					writeContractAsync({
						address,
						abi: marketAbi,
						functionName: "place",
						args: [a.tick, a.shares, a.isYes],
						value,
					}),
				{ tone: a.isYes ? "yes" : "no", touchedTick: a.tick },
			)
		},
		[address, send, me, writeContractAsync, dismissCoach],
	)

	const positions = useMemo(() => {
		if (!me) return [] as Array<{ tick: number; yes: bigint; no: bigint }>
		const rows: Array<{ tick: number; yes: bigint; no: bigint }> = []
		for (let i = 0; i < protocol.numTicks; i++) {
			const yes = me.yesPositions[i] ?? 0n
			const no = me.noPositions[i] ?? 0n
			if (yes > 0n || no > 0n) rows.push({ tick: i, yes, no })
		}
		return rows
	}, [me])

	const resolved = phase === PHASE.Resolved
	const wonAt = useCallback(
		(p: { yes: bigint; no: bigint }) => {
			if (outcome === OUTCOME.Yes) return p.yes
			if (outcome === OUTCOME.No) return p.no
			if (outcome === OUTCOME.Void) return p.yes + p.no
			return 0n
		},
		[outcome],
	)

	const restingHere = (isYes ? myOrders.yes[tick] : myOrders.no[tick]) ?? 0n

	const body = (
		<>
			{props.strip}

			<h1 className="display" style={{ fontSize: "var(--t-h2)", margin: "var(--s4) 0", maxWidth: "34ch" }}>
				{live.snapshot?.question ?? props.initialQuestion}
			</h1>

			{/*
			  TWO CLOCKS, and both prices rather than one implied number.

			  ORDERS CLOSE decides whether you may trade. RESOLVES decides when you
			  get paid. A single countdown is what lets somebody on a delayed feed
			  believe they still have time on a round whose outcome already happened.
			*/}
			<div style={{ display: "flex", gap: "var(--s6)", alignItems: "baseline", flexWrap: "wrap" }}>
				<div style={{ display: "flex", gap: "var(--s5)", alignItems: "baseline" }}>
					<div>
						<div className="num yes" style={{ fontSize: "var(--t-h1)", lineHeight: 1 }}>
							{formatBps(impliedBps)}
						</div>
						<span className="label">yes</span>
					</div>
					<div>
						<div className="num no" style={{ fontSize: "var(--t-h3)", lineHeight: 1 }}>
							{formatBps(10_000n - impliedBps)}
						</div>
						<span className="label">no</span>
					</div>
				</div>
				<div style={{ minWidth: "260px" }}>
					<Clocks
						phase={phase}
						openUntil={openUntil}
						resolveAfter={resolveAfter}
						resolvingStartsAt={resolvingStartsAt}
						windowSec={protocol.openSeconds}
						size="stack"
						outcomeLabel={outcome !== OUTCOME.Unresolved ? ["", "yes", "no", "void"][outcome] : undefined}
					/>
				</div>
				{/* Say so when the picture is not the authority. */}
				{live.status === "polling" ? <span className="badge">reconnecting \u00b7 falling back to polling</span> : null}
				{resolvingStarted && phase === PHASE.Open ? (
					<span className="badge no">orders closed \u00b7 the resolving window has started</span>
				) : null}
			</div>

			{/*
			  62/38, and the stream sits ABOVE the book in the same column rather than
			  beside it. That is what keeps the book the primary object: the player is
			  capped, never full-bleed, and the ladder is directly under it.
			*/}
			<div className="market-grid" style={{ marginTop: "var(--s6)" }}>
				<section style={{ display: "grid", gap: "var(--s4)" }}>
					{props.streamMeta ? (
						<div className="stream-sticky">
							<StreamPanel meta={props.streamMeta} badge={open ? "live" : undefined} />
						</div>
					) : (
						<div className="panel">
							<div className="panel-head">
								<span className="label">no live surface for this market</span>
							</div>
							<div className="panel-body">
								<p className="label" style={{ margin: 0, lineHeight: 1.5 }}>
									every market is meant to carry exactly one stream row and this one has none. the book below is
									still live and both clocks are still authoritative, but a market nobody can watch should not
									have been created. add one in /admin.
								</p>
							</div>
						</div>
					)}

					<DepthLadder
						levels={snapLevels}
						impliedBps={impliedBps}
						selectedTick={tick}
						selectedSide={isYes}
						interactive={open}
						phase={phase}
						mineYes={isConnected ? myOrders.yes : undefined}
						mineNo={isConnected ? myOrders.no : undefined}
						flashTicks={live.flashed}
						/* One gesture: the cell you touched is the order you get. */
						onPick={(t: number, side: boolean) => {
							pickedRef.current = true
							setTick(t)
							setIsYes(side)
						}}
					/>

					{/* Anyone can crank. The reward is why this needs no privileged keeper. */}
					<div style={{ display: "flex", gap: "var(--s3)", flexWrap: "wrap" }}>
						<button
							className="btn btn-ghost"
							disabled={!isConnected || busy}
							onClick={() =>
								void send(
									`Match tick ${tick}`,
									() =>
										writeContractAsync({
											address,
											abi: marketAbi,
											functionName: "matchTick",
											args: [tick, 64],
										}),
									{ touchedTick: tick },
								)
							}
							title={`Crank tick ${tick} and take ${protocol.crankShareBps / 100}% of the fee it generates`}
						>
							Match tick {tick} \u00b7 earn {protocol.crankShareBps / 100}% of the fee
						</button>

						{/*
						  Cancelling only makes sense while the book is open AND you actually
						  have something resting at this price. Showing it otherwise is an
						  invitation to pay gas for a no-op.
						*/}
						{open && restingHere > 0n ? (
							<button
								className="btn btn-ghost"
								disabled={busy}
								onClick={() =>
									void send(
										`Cancel resting ${isYes ? "yes" : "no"} orders at ${formatBps(legPrice(tick, isYes))}`,
										() =>
											writeContractAsync({
												address,
												abi: marketAbi,
												functionName: "withdrawOrdersAt",
												args: [tick, isYes],
											}),
										{ touchedTick: tick },
									)
								}
							>
								Cancel my {formatWad(restingHere)} unfilled here
							</button>
						) : null}
					</div>
				</section>

				<aside className="market-right">
					{/* First-run coach mark. One sentence, gone forever after your first
					    order -- not a tour, not a modal, not a second time. */}
					{!coached && open ? (
						<div className="panel" style={{ borderColor: "var(--accent)" }}>
							<div className="panel-body" style={{ display: "flex", gap: "var(--s3)", alignItems: "flex-start" }}>
								<p style={{ margin: 0, fontSize: "var(--t-small)", lineHeight: 1.5 }}>
									pick a side, set a price, place an order. settles in {protocol.roundSeconds} seconds.
								</p>
								<button className="btn btn-ghost" onClick={dismissCoach} style={{ marginLeft: "auto" }}>
									got it
								</button>
							</div>
						</div>
					) : null}

					{/* On a phone the ticket pins to the bottom edge, so a side can be
					    taken without scrolling back past the book. */}
					<div className="ticket-sticky">
						<OrderTicket
							tick={tick}
							isYes={isYes}
							feeBps={protocol.feeBps}
							balanceWei={me?.balanceWei ?? 0n}
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
							{me && me.balanceWei > 0n ? (
								<span className="label num">{formatWad(me.balanceWei)} MON idle</span>
							) : null}
						</div>
						<div className="panel-body">
							{positions.length === 0 ? (
								<p className="label" style={{ margin: 0 }}>
									{isConnected
										? "Nothing filled yet at any price."
										: "Sign in to see your fills. Watching needs no wallet."}
								</p>
							) : (
								<table className="table">
									<thead>
										<tr>
											<th>price</th>
											<th className="r">yes</th>
											<th className="r">no</th>
											{resolved ? <th className="r">claim</th> : null}
										</tr>
									</thead>
									<tbody>
										{positions.map((p) => (
											<tr key={p.tick}>
												<td className="num">{formatBps(price(p.tick))}</td>
												<td className="r num yes">{p.yes > 0n ? formatWad(p.yes) : "\u00b7"}</td>
												<td className="r num no">{p.no > 0n ? formatWad(p.no) : "\u00b7"}</td>
												{/* Claim from the row you are already looking at. Making
												    people hunt for a separate screen is how winnings go
												    uncollected. */}
												{resolved ? (
													<td className="r">
														{wonAt(p) > 0n ? (
															<button
																className="btn btn-yes"
																disabled={busy}
																onClick={() =>
																	void send(
																		`Claim ${formatBps(price(p.tick))}`,
																		() =>
																			writeContractAsync({
																				address,
																				abi: marketAbi,
																				functionName: "claim",
																				args: [[p.tick]],
																			}),
																		{ tone: "yes" },
																	)
																}
															>
																claim
															</button>
														) : (
															<span className="muted">\u2014</span>
														)}
													</td>
												) : null}
											</tr>
										))}
									</tbody>
								</table>
							)}

							{resolved && positions.length > 0 ? (
								<button
									className="btn btn-yes"
									style={{ marginTop: "var(--s3)", width: "100%" }}
									disabled={busy}
									onClick={() =>
										void send(
											"Claim and withdraw",
											() => writeContractAsync({ address, abi: marketAbi, functionName: "claimAndWithdraw" }),
											{ tone: "yes" },
										)
									}
								>
									Claim everything and withdraw
								</button>
							) : null}

							{me && me.balanceWei > 0n && !resolved ? (
								<button
									className="btn btn-ghost"
									style={{ marginTop: "var(--s3)", width: "100%" }}
									disabled={busy}
									onClick={() =>
										void send("Withdraw idle balance", () =>
											writeContractAsync({
												address,
												abi: marketAbi,
												functionName: "withdraw",
												args: [me.balanceWei],
											}),
										)
									}
								>
									Withdraw {formatWad(me.balanceWei)} MON
								</button>
							) : null}
						</div>
					</div>

					<p className="label" style={{ margin: 0 }}>
						One key decides this outcome ({trust.stage}). The fee is {protocol.feeBps / 100}% on winnings only, and
						nothing is charged on a void.
					</p>
				</aside>
			</div>
		</>
	)

	if (!chrome) {
		return (
			<main className="wrap" style={{ paddingTop: "var(--s5)", paddingBottom: "var(--s8)" }}>
				{body}
			</main>
		)
	}

	return (
		<div className="theme-ink">
			<header
				className="wrap"
				style={{ display: "flex", gap: "var(--s3)", alignItems: "center", paddingTop: "var(--s4)", flexWrap: "wrap" }}
			>
				{/* Back to the directory, not to /app -- the room is sometimes mounted
				    ON /app, where a link to /app would be a link to itself. */}
				<Link className="btn btn-ghost" href={props.backHref ?? "/app/rounds"}>
					\u2190 {props.backLabel ?? "all rounds"}
				</Link>
				<a className="label" href={explorerAddress(address)} target="_blank" rel="noreferrer">
					{address}
				</a>
				<span className="badge" style={{ marginLeft: "auto" }} title={trust.detail}>
					{trust.label}
				</span>
			</header>
			<main className="wrap" style={{ paddingTop: "var(--s5)", paddingBottom: "var(--s8)" }}>
				{body}
			</main>
		</div>
	)
}
