import { OUTCOME } from "./abi"
import { cost, netPayout, NUM_TICKS, type Outcome } from "./market-math"

/**
 * What one address actually got out of one market.
 *
 * This exists so the share card, the result page and the portfolio cannot drift
 * apart. Three surfaces quoting three slightly different numbers for the same
 * settled position is how a product loses the benefit of the doubt on money.
 *
 * The fee is applied PER TICK, not once on the total, because Market.claim
 * branches per tick and rounds the fee down each time. Summing per-tick results
 * is therefore wei-exact against the contract; taking the fee on a grand total
 * would be off by up to one wei per tick held.
 */

/** Map the on-chain uint8 onto market-math's string union. */
export function outcomeName(outcome: number): Outcome {
	switch (outcome) {
		case OUTCOME.Yes:
			return "yes"
		case OUTCOME.No:
			return "no"
		case OUTCOME.Void:
			return "void"
		default:
			return "unresolved"
	}
}

export type Settlement = {
	outcome: Outcome
	settled: boolean
	/** payout before the protocol fee */
	grossWei: bigint
	/** fee taken on winnings -- surfaced because a fee you cannot see is a fee you distrust */
	feeWei: bigint
	/** what the address receives on claim */
	netWei: bigint
	/** collateral this address put in across every tick it holds */
	stakedWei: bigint
	/** net minus staked. Negative is a loss, and the UI must be willing to say so. */
	pnlWei: bigint
	/** winning shares, kept for the settled-but-unclaimed headline */
	winningShares: bigint
	/** number of ticks this address holds anything at */
	ticksHeld: number
}

const ZERO_SETTLEMENT: Settlement = {
	outcome: "unresolved",
	settled: false,
	grossWei: 0n,
	feeWei: 0n,
	netWei: 0n,
	stakedWei: 0n,
	pnlWei: 0n,
	winningShares: 0n,
	ticksHeld: 0,
}

/**
 * Fold a snapshot's positions into one settlement.
 *
 * `feeBps` is passed in rather than read from config so the caller can use the
 * market's own feeBps() when it has it. A market deployed before a config change
 * keeps charging what it was deployed with, and this must show that number, not
 * today's default.
 */
export function settlementOf(args: {
	outcome: number
	phase: number
	yesPositions: readonly bigint[]
	noPositions: readonly bigint[]
	feeBps: number
}): Settlement {
	const name = outcomeName(args.outcome)
	const settled = name !== "unresolved"

	const ticks = Math.min(NUM_TICKS, Math.max(args.yesPositions.length, args.noPositions.length))
	if (ticks === 0) return { ...ZERO_SETTLEMENT, outcome: name, settled }

	let gross = 0n
	let fee = 0n
	let net = 0n
	let staked = 0n
	let winning = 0n
	let held = 0

	for (let t = 0; t < ticks; t++) {
		const yes = args.yesPositions[t] ?? 0n
		const no = args.noPositions[t] ?? 0n
		if (yes === 0n && no === 0n) continue
		held += 1

		// What it cost to acquire these shares, using the same round-UP the
		// contract charges on every debit.
		staked += cost(t, yes, true) + cost(t, no, false)

		if (name === "yes") winning += yes
		else if (name === "no") winning += no

		if (settled) {
			const r = netPayout(t, yes, no, name, args.feeBps)
			gross += r.gross
			fee += r.fee
			net += r.net
		}
	}

	return {
		outcome: name,
		settled,
		grossWei: gross,
		feeWei: fee,
		netWei: net,
		stakedWei: staked,
		// Only meaningful once settled. An open position has no realised result,
		// and inventing one would be the same lie as a fabricated benchmark.
		pnlWei: settled ? net - staked : 0n,
		winningShares: winning,
		ticksHeld: held,
	}
}
