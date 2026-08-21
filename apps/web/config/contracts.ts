import { activeChain } from "./chains"
import deployments from "../../../packages/contracts/deployments/10143.json"

/**
 * Deployed addresses come from the file `forge script Deploy` writes, committed to
 * the repo. Reading them from env at runtime means a stale Vercel variable can
 * silently point the app at a dead deployment; reading them from a committed file
 * means the address is reviewable in a diff.
 *
 * The ONE thing that stays in env is the resolver allowlist, since that is a
 * privileged operational secret rather than a fact about the deployment.
 */
type Deployment = {
	chainId: number
	factory: `0x${string}`
	naiveBook: `0x${string}`
	resolver: `0x${string}`
	series: Array<{ address: `0x${string}`; question: string }>
}

const d = deployments as Deployment

if (d.chainId !== activeChain.id) {
	throw new Error(
		`deployment/chain mismatch: addresses are for chain ${d.chainId} but the app is configured for ${activeChain.id}`,
	)
}

export const contracts = {
	factory: d.factory,
	naiveBook: d.naiveBook,
	resolver: d.resolver,
	series: d.series,
} as const

/** Protocol parameters. Mirrors the values the factory was deployed with. */
export const protocol = {
	feeBps: 100, // 1% on winnings
	crankShareBps: 1_000, // 10% of the fee to whoever cranked the tick
	numTicks: 19,
	tickStepBps: 500,
	openSeconds: 45,
	roundSeconds: 60,
	/** anti-dust floor, must match Market.MIN_SHARES */
	minShares: 10n ** 15n,
} as const

/**
 * Trust ladder. Shown, not hidden. v1 is a single resolver key and the UI says so
 * on every market.
 */
export const trust = {
	stage: "v1" as "v1" | "v2" | "v3",
	label: "single resolver",
	detail:
		"One key decides the outcome of every market. That is a real centralisation risk and it is the weakest part of the system today.",
	roadmap: [
		{ stage: "v1", label: "single resolver", status: "live" },
		{ stage: "v2", label: "3-of-5 committee behind a multisig", status: "next" },
		{ stage: "v3", label: "optimistic: propose, challenge with a bond, finalise", status: "planned" },
	],
} as const

/** Faucet limits. Enforced server-side; duplicated here only for copy. */
export const faucet = {
	dripWei: 10n ** 17n, // 0.1 MON, enough for many rounds of test orders
	dailyCapWei: 50n * 10n ** 18n,
	perAddressLifetimeDrips: 1,
} as const

/** House maker limits. The bot takes real risk, so the caps are not optional. */
export const houseMaker = {
	enabled: true,
	spreadBps: 500, // quote one tick either side of the seed probability
	sizePerLegWei: 2n * 10n ** 18n,
	maxExposurePerRoundWei: 10n * 10n ** 18n,
	maxDailyLossWei: 50n * 10n ** 18n,
} as const
