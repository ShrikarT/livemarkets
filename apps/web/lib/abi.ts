/**
 * Hand-written ABIs, kept as `const` so viem infers exact argument and return
 * types at the call site.
 *
 * Only the surface the app actually touches is here. Every entry was transcribed
 * from src/*.sol rather than from a build artifact, so the repo can be read
 * end-to-end without running the compiler first — but `forge build` output in
 * out/ is the source of truth if the two ever disagree.
 */

/** enum Phase { Open, Locked, Resolved } */
export const PHASE = { Open: 0, Locked: 1, Resolved: 2 } as const

/** enum Outcome { Unresolved, Yes, No, Void } */
export const OUTCOME = { Unresolved: 0, Yes: 1, No: 2, Void: 3 } as const

export const OUTCOME_LABEL = ["unresolved", "yes", "no", "void"] as const
export const PHASE_LABEL = ["open", "locked", "resolved"] as const

/** struct Tick — the shard. Shared by book(), ticks() and snapshot(). */
const TICK_COMPONENTS = [
	{ name: "openYes", type: "uint128" },
	{ name: "openNo", type: "uint128" },
	{ name: "matched", type: "uint128" },
	{ name: "feeAcc", type: "uint128" },
	{ name: "crankAcc", type: "uint128" },
	{ name: "yesCursor", type: "uint32" },
	{ name: "noCursor", type: "uint32" },
	{ name: "cranker", type: "address" },
] as const

export const marketAbi = [
	// ---------------------------------------------------------------- pricing
	{
		type: "function",
		name: "price",
		stateMutability: "pure",
		inputs: [{ name: "tick", type: "uint8" }],
		outputs: [{ type: "uint256" }],
	},
	{
		type: "function",
		name: "legPrice",
		stateMutability: "pure",
		inputs: [
			{ name: "tick", type: "uint8" },
			{ name: "isYes", type: "bool" },
		],
		outputs: [{ type: "uint256" }],
	},
	{
		type: "function",
		name: "cost",
		stateMutability: "pure",
		inputs: [
			{ name: "tick", type: "uint8" },
			{ name: "shares", type: "uint128" },
			{ name: "isYes", type: "bool" },
		],
		outputs: [{ type: "uint256" }],
	},

	// -------------------------------------------------------------- lifecycle
	{ type: "function", name: "phase", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
	{ type: "function", name: "outcome", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
	{ type: "function", name: "question", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
	{ type: "function", name: "openUntil", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
	{ type: "function", name: "resolveAfter", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
	{ type: "function", name: "resolver", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
	{ type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
	{
		type: "function",
		name: "crankShareBps",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "uint16" }],
	},
	{ type: "function", name: "tradingPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
	{
		type: "function",
		name: "balance",
		stateMutability: "view",
		inputs: [{ name: "who", type: "address" }],
		outputs: [{ type: "uint256" }],
	},

	// ------------------------------------------------------------------ reads
	{
		type: "function",
		name: "book",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "tuple[]", components: TICK_COMPONENTS }],
	},
	{
		type: "function",
		name: "ticks",
		stateMutability: "view",
		inputs: [{ name: "tick", type: "uint8" }],
		outputs: [{ type: "tuple", components: TICK_COMPONENTS }],
	},
	{ type: "function", name: "impliedBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
	{
		type: "function",
		name: "positionsOf",
		stateMutability: "view",
		inputs: [{ name: "who", type: "address" }],
		outputs: [
			{ name: "yes_", type: "uint128[]" },
			{ name: "no_", type: "uint128[]" },
		],
	},
	{
		type: "function",
		name: "orderCounts",
		stateMutability: "view",
		inputs: [{ name: "tick", type: "uint8" }],
		outputs: [{ type: "uint256" }, { type: "uint256" }],
	},
	{
		type: "function",
		name: "openOrdersOf",
		stateMutability: "view",
		inputs: [
			{ name: "tick", type: "uint8" },
			{ name: "isYes", type: "bool" },
			{ name: "who", type: "address" },
		],
		outputs: [
			{ name: "indices", type: "uint32[]" },
			{ name: "remaining", type: "uint128[]" },
		],
	},
	/** Everything for one market in a single eth_call. This is what watch mode uses. */
	{
		type: "function",
		name: "snapshot",
		stateMutability: "view",
		inputs: [{ name: "who", type: "address" }],
		outputs: [
			{ name: "q", type: "string" },
			{ name: "ph", type: "uint8" },
			{ name: "oc", type: "uint8" },
			{ name: "openUntil_", type: "uint64" },
			{ name: "resolveAfter_", type: "uint64" },
			{ name: "implied", type: "uint256" },
			{ name: "userBalance", type: "uint256" },
			{ name: "levels", type: "tuple[]", components: TICK_COMPONENTS },
			{ name: "yesPositions", type: "uint128[]" },
			{ name: "noPositions", type: "uint128[]" },
		],
	},

	// ----------------------------------------------------------------- writes
	{ type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
	{
		type: "function",
		name: "withdraw",
		stateMutability: "nonpayable",
		inputs: [{ name: "amount", type: "uint256" }],
		outputs: [],
	},
	{
		type: "function",
		name: "place",
		stateMutability: "payable",
		inputs: [
			{ name: "tick", type: "uint8" },
			{ name: "shares", type: "uint128" },
			{ name: "isYes", type: "bool" },
		],
		outputs: [{ name: "index", type: "uint32" }],
	},
	{
		type: "function",
		name: "matchTick",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "tick", type: "uint8" },
			{ name: "maxSteps", type: "uint32" },
		],
		outputs: [{ name: "filledTotal", type: "uint128" }],
	},
	{
		type: "function",
		name: "matchTicks",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "tickList", type: "uint8[]" },
			{ name: "maxSteps", type: "uint32" },
		],
		outputs: [{ name: "total", type: "uint128" }],
	},
	{
		type: "function",
		name: "withdrawOrder",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "tick", type: "uint8" },
			{ name: "isYes", type: "bool" },
			{ name: "index", type: "uint32" },
		],
		outputs: [{ name: "refund", type: "uint256" }],
	},
	{
		type: "function",
		name: "withdrawOrdersAt",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "tick", type: "uint8" },
			{ name: "isYes", type: "bool" },
		],
		outputs: [{ name: "refund", type: "uint256" }],
	},
	{
		type: "function",
		name: "resolve",
		stateMutability: "nonpayable",
		inputs: [{ name: "o", type: "uint8" }],
		outputs: [],
	},
	{
		type: "function",
		name: "setTradingPaused",
		stateMutability: "nonpayable",
		inputs: [{ name: "p", type: "bool" }],
		outputs: [],
	},
	{
		type: "function",
		name: "claim",
		stateMutability: "nonpayable",
		inputs: [{ name: "tickList", type: "uint8[]" }],
		outputs: [{ name: "net", type: "uint256" }],
	},
	{ type: "function", name: "claimAll", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }] },
	{
		type: "function",
		name: "claimAndWithdraw",
		stateMutability: "nonpayable",
		inputs: [],
		outputs: [{ name: "amount", type: "uint256" }],
	},
	{
		type: "function",
		name: "payCrankReward",
		stateMutability: "nonpayable",
		inputs: [{ name: "tick", type: "uint8" }],
		outputs: [{ name: "amt", type: "uint256" }],
	},
	{
		type: "function",
		name: "sweepFees",
		stateMutability: "nonpayable",
		inputs: [{ name: "tickList", type: "uint8[]" }],
		outputs: [{ name: "amt", type: "uint256" }],
	},

	// ----------------------------------------------------------------- events
	{
		type: "event",
		name: "Matched",
		inputs: [
			{ name: "tick", type: "uint8", indexed: true },
			{ name: "shares", type: "uint128", indexed: false },
			{ name: "tickTotal", type: "uint128", indexed: false },
			{ name: "matcher", type: "address", indexed: true },
		],
	},
	{
		type: "event",
		name: "Resolved",
		inputs: [{ name: "outcome", type: "uint8", indexed: false }],
	},
	{
		type: "event",
		name: "Claimed",
		inputs: [
			{ name: "who", type: "address", indexed: true },
			{ name: "net", type: "uint256", indexed: false },
			{ name: "fee", type: "uint256", indexed: false },
		],
	},
	{
		type: "event",
		name: "TradingPaused",
		inputs: [{ name: "paused", type: "bool", indexed: false }],
	},
	{
		type: "event",
		name: "CrankRewardPaid",
		inputs: [
			{ name: "tick", type: "uint8", indexed: true },
			{ name: "to", type: "address", indexed: true },
			{ name: "amount", type: "uint256", indexed: false },
		],
	},

	// ----------------------------------------------------------------- errors
	// Declared so viem can decode a revert into a sentence a user can act on.
	{ type: "error", name: "NotOpen", inputs: [] },
	{ type: "error", name: "TooEarly", inputs: [] },
	{ type: "error", name: "NotResolved", inputs: [] },
	{ type: "error", name: "AlreadyResolved", inputs: [] },
	{ type: "error", name: "BadTick", inputs: [] },
	{ type: "error", name: "TooSmall", inputs: [] },
	{ type: "error", name: "NotYours", inputs: [] },
	{ type: "error", name: "NoBalance", inputs: [] },
	{ type: "error", name: "TransferFailed", inputs: [] },
	{ type: "error", name: "Paused", inputs: [] },
] as const

export const factoryAbi = [
	{ type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
	{ type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
	{ type: "function", name: "count", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
	{ type: "function", name: "seriesCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
	{ type: "function", name: "allSeries", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
	{
		type: "function",
		name: "markets",
		stateMutability: "view",
		inputs: [{ name: "i", type: "uint256" }],
		outputs: [{ type: "address" }],
	},
	/** newest first — the app's single discovery entry point */
	{
		type: "function",
		name: "recent",
		stateMutability: "view",
		inputs: [{ name: "n", type: "uint256" }],
		outputs: [{ type: "address[]" }],
	},
	{
		type: "function",
		name: "create",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "question", type: "string" },
			{ name: "openSeconds", type: "uint64" },
			{ name: "resolveSeconds", type: "uint64" },
		],
		outputs: [{ type: "address" }],
	},
	{
		type: "event",
		name: "MarketCreated",
		inputs: [
			{ name: "market", type: "address", indexed: true },
			{ name: "question", type: "string", indexed: false },
			{ name: "openUntil", type: "uint64", indexed: false },
			{ name: "resolveAfter", type: "uint64", indexed: false },
		],
	},
	{
		type: "event",
		name: "SeriesRegistered",
		inputs: [
			{ name: "series", type: "address", indexed: true },
			{ name: "question", type: "string", indexed: false },
		],
	},
] as const

export const seriesAbi = [
	{ type: "function", name: "question", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
	{ type: "function", name: "current", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
	{ type: "function", name: "count", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
	{ type: "function", name: "pokeable", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
	{ type: "function", name: "nextStart", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
	{ type: "function", name: "stopped", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
	{ type: "function", name: "roundSeconds", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
	{
		type: "function",
		name: "recent",
		stateMutability: "view",
		inputs: [{ name: "n", type: "uint256" }],
		outputs: [{ type: "address[]" }],
	},
	{ type: "function", name: "poke", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "address" }] },
	{
		type: "function",
		name: "setStopped",
		stateMutability: "nonpayable",
		inputs: [{ name: "s", type: "bool" }],
		outputs: [],
	},
	{
		type: "event",
		name: "RoundStarted",
		inputs: [
			{ name: "round", type: "uint256", indexed: true },
			{ name: "market", type: "address", indexed: false },
			{ name: "startedAt", type: "uint64", indexed: false },
			{ name: "nextStart", type: "uint64", indexed: false },
		],
	},
] as const

/**
 * Map a contract revert name onto something a person can act on. A raw
 * "execution reverted" in a 60-second market is useless.
 */
export const ERROR_COPY: Record<string, string> = {
	NotOpen: "This market has closed. Wait for the next round.",
	TooEarly: "Too early — the resolve window has not opened yet.",
	NotResolved: "The outcome is not in yet, so there is nothing to claim.",
	AlreadyResolved: "This market is already settled.",
	BadTick: "That price is outside the 0.05–0.95 range.",
	TooSmall: "Order is below the minimum size.",
	NotYours: "That order belongs to another address.",
	NoBalance: "Nothing to withdraw.",
	TransferFailed: "The transfer failed. Your balance is still credited — try withdrawing again.",
	Paused: "Trading is paused on this market.",
}
