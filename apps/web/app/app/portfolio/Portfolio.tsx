"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import type { Address } from "viem"
import { useAccount, useWriteContract } from "wagmi"

import { OUTCOME, PHASE, marketAbi } from "../../../lib/abi"
import { publicClient, readSnapshot, type MarketSnapshot } from "../../../lib/market-client"
import { formatBps, formatWad, price } from "../../../lib/market-math"

type Row = { tick: number; yes: bigint; no: bigint }

type Holding = {
	snap: MarketSnapshot
	rows: Row[]
	/** unclaimed winning SHARES, not MON -- see the note on the headline below */
	winningShares: bigint
	/** what you put in, at the price you paid */
	staked: bigint
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
				let staked = 0n
				for (let t = 0; t < snap.yesPositions.length; t++) {
					const yes = snap.yesPositions[t] ?? 0n
					const no = snap.noPositions[t] ?? 0n
					if (yes === 0n && no === 0n) continue
					rows.push({ tick: t, yes, no })
					const p = price(t)
					// yes costs p, no costs 1 - p. Both legs at the tick's own price.
					staked += (yes * p) / 10_000n + (no * (10_000n - p)) / 10_000n
				}
				if (rows.length === 0 && snap.balanceWei === 0n) continue

				let winningShares = 0n
				if (snap.phase === PHASE.Resolved) {
					for (const row of rows) {
						if (snap.outcome === OUTCOME.Yes) winningShares += row.yes
						else if (snap.outcome === OUTCOME.No) winningShares += row.no
						else if (snap.outcome === OUTCOME.Void) winningShares += row.yes + row.no
					}
				}
				found.push({ snap, rows, winningShares, staked })
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
						sign in to see your positions. watching a round never needs a wallet \u2014 only holding one does.
					</p>
				</div>
			</div>
		)
	}

	if (holdings === null) {
		return (
			<p className="label" style={{ marginTop: "var(--s5)" }}>
				reading {addresses.length} rounds\u2026
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

	const claimable = holdings.filter((h) => h.winningShares > 0n)
	const totalWinning = claimable.reduce((s, h) => s + h.winningShares, 0n)
	const idle = holdings.reduce((s, h) => s + h.snap.balanceWei, 0n)

	return (
		<>
			{/*
			  THE HEADLINE IS SHARES, NOT MON, AND THAT IS ON PURPOSE.

			  A winning share pays out one unit minus the fee on the winnings, and the
			  exact figure depends on the contract's own rounding. Printing a
			  confident MON total here would mean reimplementing that arithmetic in
			  the browser and being wrong by dust -- and a portfolio that quotes you a
			  number you do not receive is worse than one that quotes no number. The
			  claim transaction reports the true amount.
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
						{formatWad(totalWinning)}
					</div>
					<span className="label">winning shares to claim</span>
				</div>
				<div>
					<div className="num" style={{ fontSize: "var(--t-h3)", lineHeight: 1 }}>
						{holdings.length}
					</div>
					<span className="label">rounds with a position</span>
				</div>
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
														{won > 0n ? <span className="yes">{formatWad(won)} won</span> : <span className="muted">\u2014</span>}
													</td>
												) : null}
											</tr>
										)
									})}
								</tbody>
							</table>

							<p className="label" style={{ marginTop: "var(--s3)" }}>
								staked {formatWad(h.staked)} MON at the prices you paid
							</p>

							{h.winningShares > 0n || h.snap.balanceWei > 0n ? (
								<button
									className="btn btn-yes"
									style={{ width: "100%" }}
									disabled={busy === h.snap.address}
									onClick={() => void collect(h.snap.address)}
								>
									{busy === h.snap.address ? "collecting\u2026" : "claim and withdraw"}
								</button>
							) : null}
						</div>
					</div>
				)
			})}
		</>
	)
}
