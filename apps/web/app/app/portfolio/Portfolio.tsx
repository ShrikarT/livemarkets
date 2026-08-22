"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import type { Address } from "viem"
import { useAccount, useWriteContract } from "wagmi"

import { protocol } from "../../../config/contracts"
import { OUTCOME, PHASE, marketAbi } from "../../../lib/abi"
import { publicClient, readSnapshot, type MarketSnapshot } from "../../../lib/market-client"
import { formatBps, formatWad, price } from "../../../lib/market-math"
import { settlementOf, type Settlement } from "../../../lib/settlement"

type Row = { tick: number; yes: bigint; no: bigint }

type Holding = {
	snap: MarketSnapshot
	rows: Row[]
	/** the one source of truth for what this position is worth */
	s: Settlement
}

/** Read in small groups: 24 parallel RPC calls is how you get rate limited. */
const CHUNK = 6

export function Portfolio({ addresses }: { addresses: string[] }) {
	const { address: account, isConnected } = useAccount()
	const { writeContractAsync } = useWriteContract()
	const [holdings, setHoldings] = useState<Holding[] | null>(null)
	const [busy, setBusy] = useState<string | null>(null)

	const load = useCallback(async () => {
		if (!account) {
			setHoldings(null)
			return
		}
		const found: Holding[] = []
		for (let i = 0; i < addresses.length; i += CHUNK) {
			const batch = addresses.slice(i, i + CHUNK)
			const settled = await Promise.allSettled(
				batch.map((a) => readSnapshot(a as Address, account)),
			)
			for (const r of settled) {
				// One unreachable market must not blank the whole page.
				if (r.status !== "fulfilled") continue
				const snap = r.value

				const rows: Row[] = []
				for (let t = 0; t < snap.yesPositions.length; t++) {
					const yes = snap.yesPositions[t] ?? 0n
					const no = snap.noPositions[t] ?? 0n
					if (yes === 0n && no === 0n) continue
					rows.push({ tick: t, yes, no })
				}
				if (rows.length === 0 && snap.balanceWei === 0n) continue

				// One shared fold, so this page, the result page and the share card can
				// never quote three different numbers for the same position.
				const s = settlementOf({
					outcome: snap.outcome,
					phase: snap.phase,
					yesPositions: snap.yesPositions,
					noPositions: snap.noPositions,
					feeBps: protocol.feeBps,
				})

				found.push({ snap, rows, s })
			}
		}
		setHoldings(found)
	}, [account, addresses])

	useEffect(() => {
		void load()
	}, [load])

	const collect = useCallback(
		async (market: Address) => {
			setBusy(market)
			try {
				// claimAndWithdraw is one signature for what is conceptually one act.
				// Claiming into an internal balance and then withdrawing it is an
				// implementation detail; making the user sign twice for it is not.
				const hash = await writeContractAsync({
					address: market,
					abi: marketAbi,
					functionName: "claimAndWithdraw",
				})
				await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
				await load()
			} catch {
				/* the row stays as it was; nothing was spent */
			} finally {
				setBusy(null)
			}
		},
		[writeContractAsync, load],
	)

	if (!isConnected) {
		return (
			<div className="panel" style={{ marginTop: "var(--s5)" }}>
				<div className="panel-head">
					<span className="label">not signed in</span>
				</div>
				<div className="panel-body">
					<p className="label" style={{ margin: 0, lineHeight: 1.6 }}>
						sign in to see your positions. watching a round never needs a wallet — only holding one does.
					</p>
				</div>
			</div>
		)
	}

	if (holdings === null) {
		return (
			<p className="label" style={{ marginTop: "var(--s5)" }}>
				reading {addresses.length} rounds…
			</p>
		)
	}

	if (holdings.length === 0) {
		return (
			<div className="panel" style={{ marginTop: "var(--s5)" }}>
				<div className="panel-head">
					<span className="label">nothing held</span>
				</div>
				<div className="panel-body">
					<p className="label" style={{ marginTop: 0, lineHeight: 1.6 }}>
						no fills in the last {addresses.length} rounds.
					</p>
					<Link className="btn" href="/app">
						find a live market
					</Link>
				</div>
			</div>
		)
	}

	const claimable = holdings.filter((h) => h.s.settled && h.s.netWei > 0n)
	const totalNet = claimable.reduce((s, h) => s + h.s.netWei, 0n)
	const idle = holdings.reduce((s, h) => s + h.snap.balanceWei, 0n)
	const realised = holdings.reduce((s, h) => s + h.s.pnlWei, 0n)

	return (
		<>
			{/*
			  THE HEADLINE IS MON, AND IT IS ALLOWED TO BE.

			  This used to read "winning shares" because quoting a MON figure meant
			  reimplementing the contract's fee and rounding arithmetic in the browser
			  and being wrong by dust -- and a portfolio that quotes a number you do
			  not receive is worse than one that quotes no number.

			  It is MON now because the arithmetic is no longer reimplemented. It goes
			  through lib/settlement, which folds market-math's netPayout PER TICK --
			  the same branch and the same round-down-per-tick that Market.claim uses.
			  market-math is parity-tested against contract-generated vectors, so this
			  is the contract's number, not an estimate of it.
			*/}
			<div
				style={{
					display: "flex",
					gap: "var(--s6)",
					flexWrap: "wrap",
					marginTop: "var(--s5)",
					paddingBottom: "var(--s4)",
					borderBottom: "1px solid var(--line)",
				}}
			>
				<div>
					<div className="num" style={{ fontSize: "var(--t-h1)", lineHeight: 1 }}>
						{formatWad(totalNet)}
					</div>
					<span className="label">MON to claim, after fees</span>
				</div>
				<div>
					<div className="num" style={{ fontSize: "var(--t-h3)", lineHeight: 1 }}>
						{holdings.length}
					</div>
					<span className="label">rounds with a position</span>
				</div>
				{/* Realised result across settled rounds. Shown even when negative --
				    a portfolio that can only display gains is not a portfolio. */}
				{claimable.length > 0 || realised !== 0n ? (
					<div>
						<div
							className={`num ${realised > 0n ? "yes" : realised < 0n ? "no" : ""}`}
							style={{ fontSize: "var(--t-h3)", lineHeight: 1 }}
						>
							{realised > 0n ? "+" : ""}
							{formatWad(realised)}
						</div>
						<span className="label">realised, settled rounds</span>
					</div>
				) : null}
				{idle > 0n ? (
					<div>
						<div className="num" style={{ fontSize: "var(--t-h3)", lineHeight: 1 }}>
							{formatWad(idle)}
						</div>
						<span className="label">MON idle in markets</span>
					</div>
				) : null}
			</div>

			{holdings.map((h) => {
				const settled = h.snap.phase === PHASE.Resolved
				const label = settled ? ["", "yes", "no", "void"][h.snap.outcome] : undefined
				return (
					<div className="panel" key={h.snap.address} style={{ marginTop: "var(--s5)" }}>
						<div className="panel-head">
							<Link className="label" href={`/app/m/${h.snap.address}`} style={{ color: "var(--fg)" }}>
								{h.snap.question}
							</Link>
							<span className="label">
								{settled ? `settled \u00b7 ${label}` : h.snap.phase === PHASE.Open ? "open" : "matching"}
							</span>
						</div>
						<div className="panel-body">
							<table className="table">
								<thead>
									<tr>
										<th>price</th>
										<th className="r">yes</th>
										<th className="r">no</th>
										{settled ? <th className="r">outcome</th> : null}
									</tr>
								</thead>
								<tbody>
									{h.rows.map((r) => {
										const won =
											h.snap.outcome === OUTCOME.Yes
												? r.yes
												: h.snap.outcome === OUTCOME.No
													? r.no
													: h.snap.outcome === OUTCOME.Void
														? r.yes + r.no
														: 0n
										return (
											<tr key={r.tick}>
												<td className="num">{formatBps(price(r.tick))}</td>
												<td className="r num yes">{r.yes > 0n ? formatWad(r.yes) : "\u00b7"}</td>
												<td className="r num no">{r.no > 0n ? formatWad(r.no) : "\u00b7"}</td>
												{settled ? (
													<td className="r num">
														{won > 0n ? <span className="yes">{formatWad(won)} won</span> : <span className="muted">—</span>}
													</td>
												) : null}
											</tr>
										)
									})}
								</tbody>
							</table>

							{/* Staked uses the contract's round-UP on debits. The previous version
							    divided down here, which quietly understated what you paid. */}
							<p className="label" style={{ marginTop: "var(--s3)" }}>
								staked {formatWad(h.s.stakedWei)} MON at the prices you paid
								{h.s.settled ? (
									<>
										{" \u00b7 "}
										{formatWad(h.s.netWei)} back after {formatWad(h.s.feeWei)} fee{" \u00b7 "}
										<span className={h.s.pnlWei > 0n ? "yes" : h.s.pnlWei < 0n ? "no" : "muted"}>
											{h.s.pnlWei > 0n ? "+" : ""}
											{formatWad(h.s.pnlWei)} MON
										</span>
									</>
								) : null}
							</p>

							<div style={{ display: "flex", gap: "var(--s3)", flexWrap: "wrap", alignItems: "center" }}>
								{h.s.netWei > 0n || h.snap.balanceWei > 0n ? (
									<button
										className="btn btn-yes"
										style={{ flex: 1, minWidth: "200px" }}
										disabled={busy === h.snap.address}
										onClick={() => void collect(h.snap.address)}
									>
										{busy === h.snap.address ? "collecting\u2026" : "claim and withdraw"}
									</button>
								) : null}
								{/* A result is worth sharing whether it went your way or not, and
								    the link renders its own card wherever it is pasted. */}
								{h.s.settled && h.s.ticksHeld > 0 && account ? (
									<Link className="btn btn-ghost" href={`/r/${h.snap.address}?who=${account}`}>
										share this result
									</Link>
								) : null}
							</div>
						</div>
					</div>
				)
			})}
		</>
	)
}
