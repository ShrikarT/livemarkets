import Link from "next/link"
import { notFound } from "next/navigation"
import { isAddress, type Address } from "viem"

import { brand } from "../../../config/brand"
import { explorerAddress } from "../../../config/chains"
import { protocol } from "../../../config/contracts"
import { readSnapshot } from "../../../lib/market-client"
import { formatBps, formatWad } from "../../../lib/market-math"
import { settlementOf } from "../../../lib/settlement"

/**
 * /r/0xMARKET?who=0xTRADER — a result you can paste.
 *
 * WHY A PAGE AND NOT A SHARE BUTTON
 *
 * A share button only works on the surface that has it, and it hands the reader
 * a screenshot they cannot verify. A URL renders its own card in every chat app,
 * and lands the reader on something they can check: the market address, the
 * outcome, and a link into the live book. The claim in the image is auditable
 * from the page it came from.
 *
 * This sits OUTSIDE /app on purpose. It is a public artifact for people who are
 * not signed in and may never have used the product, so it carries no app nav
 * and requires no wallet.
 */

export const dynamic = "force-dynamic"
export const revalidate = 0

type Params = { params: Promise<{ address: string }>; searchParams: Promise<{ who?: string }> }

export async function generateMetadata({ params, searchParams }: Params) {
	const { address } = await params
	const { who } = await searchParams
	const qs = who && isAddress(who) ? `?who=${who}` : ""
	const image = `/api/og/result/${address}${qs}`

	return {
		title: `result \u00b7 ${brand.wordmark.toLowerCase()}`,
		description: brand.tagline,
		openGraph: { images: [{ url: image, width: 1200, height: 630 }] },
		twitter: { card: "summary_large_image" as const, images: [image] },
	}
}

function short(a: string) {
	return `${a.slice(0, 6)}\u2026${a.slice(-4)}`
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "yes" | "no" | "muted" }) {
	return (
		<tr>
			<td className="label">{label}</td>
			<td className={`r num${tone ? ` ${tone}` : ""}`}>{value}</td>
		</tr>
	)
}

export default async function ResultPage({ params, searchParams }: Params) {
	const { address } = await params
	const { who: whoRaw } = await searchParams
	if (!isAddress(address)) notFound()

	const who = whoRaw && isAddress(whoRaw) ? (whoRaw as Address) : null

	let snap
	try {
		snap = who ? await readSnapshot(address as Address, who) : await readSnapshot(address as Address)
	} catch {
		// An unreachable RPC is not a missing market, and saying "not found" would
		// be a lie the reader cannot distinguish from the truth.
		return (
			<div className="theme-ink">
				<main className="wrap" style={{ paddingTop: "var(--s6)", paddingBottom: "var(--s8)" }}>
					<Link href="/" className="display" style={{ textDecoration: "none" }}>
						{brand.wordmark}
					</Link>
					<div className="panel" style={{ marginTop: "var(--s5)" }}>
						<div className="panel-head">
							<span className="label">could not reach the chain</span>
						</div>
						<div className="panel-body">
							<p className="label" style={{ margin: 0, lineHeight: 1.6 }}>
								the market may be fine \u2014 the rpc is not answering. it is still readable on the explorer.
							</p>
							<p style={{ marginTop: "var(--s3)", marginBottom: 0 }}>
								<a className="label" href={explorerAddress(address)} target="_blank" rel="noreferrer">
									{short(address)} on the explorer
								</a>
							</p>
						</div>
					</div>
				</main>
			</div>
		)
	}

	const s = settlementOf({
		outcome: snap.outcome,
		phase: snap.phase,
		yesPositions: snap.yesPositions,
		noPositions: snap.noPositions,
		feeBps: protocol.feeBps,
	})

	const label = s.outcome === "yes" ? "yes" : s.outcome === "no" ? "no" : s.outcome === "void" ? "void" : "open"
	const hasPosition = who !== null && s.ticksHeld > 0
	const won = s.settled && hasPosition && s.pnlWei > 0n

	return (
		<div className="theme-ink">
			<main className="wrap" style={{ paddingTop: "var(--s6)", paddingBottom: "var(--s8)" }}>
				<div style={{ display: "flex", alignItems: "center", gap: "var(--s4)", flexWrap: "wrap" }}>
					<Link href="/" className="display" style={{ textDecoration: "none", letterSpacing: "0.02em" }}>
						{brand.wordmark}
					</Link>
					<span className={`badge${s.settled ? "" : " badge-live"}`}>{s.settled ? `settled ${label}` : "still open"}</span>
					<span className="badge" style={{ marginLeft: "auto" }}>
						{brand.environmentLabel}
					</span>
				</div>

				<h1 className="display" style={{ fontSize: "var(--t-h2)", marginTop: "var(--s5)", marginBottom: 0 }}>
					{snap.question}
				</h1>

				{/* The headline number, chosen to match whatever the card claims. */}
				<div style={{ display: "flex", alignItems: "flex-end", gap: "var(--s3)", marginTop: "var(--s5)" }}>
					<span
						className={`display ${won ? "yes" : s.settled && hasPosition ? "no" : ""}`}
						style={{ fontSize: "var(--t-h1)", lineHeight: 1 }}
					>
						{!s.settled
							? formatBps(snap.impliedBps)
							: hasPosition
								? `${s.pnlWei > 0n ? "+" : ""}${formatWad(s.pnlWei)}`
								: label}
					</span>
					<span className="label">
						{!s.settled ? "implied probability of yes" : hasPosition ? "MON" : "final outcome"}
					</span>
				</div>

				{hasPosition ? (
					<div className="panel" style={{ marginTop: "var(--s5)", maxWidth: 520 }}>
						<div className="panel-head">
							<span className="label">{short(who as string)}</span>
						</div>
						<div className="panel-body">
							<table className="table">
								<tbody>
									<Row label="staked" value={`${formatWad(s.stakedWei)} MON`} />
									{s.settled ? (
										<>
											<Row label="payout before fee" value={`${formatWad(s.grossWei)} MON`} />
											{/* Shown, not hidden. A fee you cannot see is a fee you distrust. */}
											<Row label={`fee (${protocol.feeBps / 100}%)`} value={`${formatWad(s.feeWei)} MON`} tone="muted" />
											<Row label="received" value={`${formatWad(s.netWei)} MON`} />
											<Row
												label="result"
												value={`${s.pnlWei > 0n ? "+" : ""}${formatWad(s.pnlWei)} MON`}
												tone={s.pnlWei > 0n ? "yes" : "no"}
											/>
										</>
									) : (
										<Row label="ticks held" value={String(s.ticksHeld)} tone="muted" />
									)}
								</tbody>
							</table>
							{s.settled && s.winningShares > 0n ? (
								<p className="label" style={{ marginTop: "var(--s3)", marginBottom: 0, lineHeight: 1.6 }}>
									claiming is permissionless and has to be done by the holder \u2014 open the market to collect.
								</p>
							) : null}
						</div>
					</div>
				) : null}

				<div style={{ display: "flex", gap: "var(--s3)", marginTop: "var(--s5)", flexWrap: "wrap" }}>
					<Link href={`/app/m/${address}`} className="btn">
						{s.settled ? "open the market" : "trade this market"}
					</Link>
					<Link href="/app" className="btn btn-ghost">
						see what is live now
					</Link>
				</div>

				{/* The reader can verify every number above from here. */}
				<p className="label" style={{ marginTop: "var(--s4)", lineHeight: 1.6 }}>
					<a href={explorerAddress(address)} target="_blank" rel="noreferrer">
						{short(address)} on the explorer
					</a>{" "}
					\u00b7 every figure here is read from that contract
				</p>
			</main>
		</div>
	)
}
