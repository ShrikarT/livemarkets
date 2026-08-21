"use client"

import { useMemo, useState } from "react"

import {
	MIN_SHARES,
	WAD,
	formatBps,
	formatMultiple,
	formatWad,
	parseWad,
	price,
	quote,
} from "../../lib/market-math"

/**
 * The order ticket.
 *
 * The single most important rule in this component: every number shown here is
 * computed with the same integer arithmetic the contract uses, in bigint, from
 * lib/market-math.ts, which is pinned to Market.sol by a 9,120-case parity test.
 * No floats, no "approximately", no rounding for display that leaks back into the
 * amount being signed. If the ticket says 59.40, the contract charges 59.40.
 *
 * Second rule: the ticket refuses locally anything the contract would revert on
 * (sub-dust size, closed market, no balance). Users should never pay gas to be
 * told no.
 */

export type OrderTicketProps = {
	tick: number
	isYes: boolean
	feeBps: number
	/** the user's collateral balance inside the market, in wei */
	balanceWei?: bigint
	/** false once the market locks */
	open: boolean
	busy?: boolean
	canSign: boolean
	onSideChange: (isYes: boolean) => void
	onSubmit: (args: { tick: number; shares: bigint; isYes: boolean; costWei: bigint }) => void
}

const PRESETS = ["1", "5", "25", "100"]

export function OrderTicket({
	tick,
	isYes,
	feeBps,
	balanceWei = 0n,
	open,
	busy = false,
	canSign,
	onSideChange,
	onSubmit,
}: OrderTicketProps) {
	const [raw, setRaw] = useState("5")

	const shares = useMemo(() => parseWad(raw), [raw])
	const q = useMemo(() => quote({ tick, shares, isYes, feeBps }), [tick, shares, isYes, feeBps])

	// Everything that can stop this order, decided here rather than onchain.
	const reason = !open
		? "market is locked"
		: shares === 0n
			? null // nothing typed yet: no error, just no action
			: q.tooSmall
				? `minimum order is ${formatWad(MIN_SHARES, 4)} shares`
				: null

	const ready = open && shares > 0n && !q.tooSmall && !busy

	return (
		<div className="panel">
			<div className="panel-head">
				<span className="label">Order</span>
				<span className="label">
					tick <span style={{ color: "var(--fg)" }}>{formatBps(price(tick))}</span>
				</span>
			</div>

			<div className="panel-body" style={{ display: "grid", gap: "var(--s4)" }}>
				{/* side. two buttons, each carrying its own colour and its own price. */}
				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s2)" }}>
					<button
						type="button"
						className={isYes ? "btn btn-yes" : "btn btn-ghost"}
						onClick={() => onSideChange(true)}
						aria-pressed={isYes}
					>
						Yes {formatBps(price(tick))}
					</button>
					<button
						type="button"
						className={!isYes ? "btn btn-no" : "btn btn-ghost"}
						onClick={() => onSideChange(false)}
						aria-pressed={!isYes}
					>
						No {formatBps(10_000n - price(tick))}
					</button>
				</div>

				{/* size */}
				<div>
					<label className="label" htmlFor="lm-shares" style={{ display: "block", marginBottom: "var(--s2)" }}>
						Shares
					</label>
					<input
						id="lm-shares"
						className="input"
						inputMode="decimal"
						autoComplete="off"
						value={raw}
						onChange={(e) => setRaw(e.target.value.replace(/[^\d.]/g, ""))}
						placeholder="0.00"
					/>
					<div style={{ display: "flex", gap: "var(--s2)", marginTop: "var(--s2)" }}>
						{PRESETS.map((p) => (
							<button key={p} type="button" className="badge" onClick={() => setRaw(p)}>
								{p}
							</button>
						))}
					</div>
				</div>

				{/* the quote. wei-exact, straight from the shared math. */}
				<table className="table" style={{ fontSize: "var(--t-small)" }}>
					<tbody>
						<Row k="Cost" v={`${formatWad(q.cost)} MON`} strong />
						<Row k="Max payout" v={`${formatWad(q.maxPayout)} MON`} />
						<Row k="Max profit" v={`${formatWad(q.maxProfit)} MON`} tone={isYes ? "yes" : "no"} />
						<Row k="Return" v={formatMultiple(q.payoutMultipleWad)} />
						<Row k="Break-even" v={formatBps(q.breakEvenBps)} />
						<Row k="Fee on winnings" v={`${(feeBps / 100).toFixed(2)}%`} />
					</tbody>
				</table>

				{/*
				  Balance is shown, not enforced: place() is payable, so a user with no
				  internal balance simply sends the collateral with the transaction. That
				  is one signature instead of deposit-then-place.
				*/}
				{balanceWei > 0n ? (
					<p className="label" style={{ margin: 0 }}>
						{formatWad(balanceWei)} MON already in the market
						{balanceWei >= q.cost ? " · covers this order" : " · the rest is sent with the tx"}
					</p>
				) : null}

				{reason ? (
					<p className="label" style={{ margin: 0, color: "var(--no)" }}>
						{reason}
					</p>
				) : null}

				<button
					type="button"
					className={`btn ${isYes ? "btn-yes" : "btn-no"}`}
					disabled={!ready}
					onClick={() => onSubmit({ tick, shares, isYes, costWei: q.cost })}
				>
					{busy
						? "signing…"
						: !canSign
							? "sign in to trade"
							: `Buy ${isYes ? "yes" : "no"} · ${formatWad(q.cost)} MON`}
				</button>

				<p className="label" style={{ margin: 0, lineHeight: 1.5 }}>
					Limit order at one price. It rests until someone takes the other side, and you can
					cancel it for an exact refund any time before the market locks.
				</p>
			</div>
		</div>
	)
}

function Row({
	k,
	v,
	strong,
	tone,
}: {
	k: string
	v: string
	strong?: boolean
	tone?: "yes" | "no"
}) {
	return (
		<tr>
			<td className="label" style={{ border: 0, paddingLeft: 0 }}>
				{k}
			</td>
			<td
				className="r"
				style={{
					border: 0,
					paddingRight: 0,
					fontSize: strong ? "var(--t-lead)" : undefined,
					color: tone === "yes" ? "var(--yes)" : tone === "no" ? "var(--no)" : undefined,
				}}
			>
				{v}
			</td>
		</tr>
	)
}

/** Exported for the static design previews, which render without a wallet. */
export const TICKET_DEMO = { shares: 60n * WAD }
