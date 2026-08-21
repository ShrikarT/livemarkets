/**
 * The slice of the contract surface the bots use. Kept separate from the web
 * app's ABI file so the cranker can run as a plain Node process with no Next
 * build step in the way.
 */

const TICK = [
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
	{ type: "function", name: "phase", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
	{ type: "function", name: "outcome", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
	{ type: "function", name: "question", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
	{ type: "function", name: "openUntil", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
	{ type: "function", name: "resolveAfter", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
	{ type: "function", name: "impliedBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
	{
		type: "function",
		name: "book",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "tuple[]", components: TICK }],
	},
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
			{ name: "levels", type: "tuple[]", components: TICK },
			{ name: "yesPositions", type: "uint128[]" },
			{ name: "noPositions", type: "uint128[]" },
		],
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
		outputs: [{ type: "uint32" }],
	},
	{
		type: "function",
		name: "matchTick",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "tick", type: "uint8" },
			{ name: "maxSteps", type: "uint32" },
		],
		outputs: [{ type: "uint128" }],
	},
	{
		type: "function",
		name: "matchTicks",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "tickList", type: "uint8[]" },
			{ name: "maxSteps", type: "uint32" },
		],
		outputs: [{ type: "uint128" }],
	},
	{
		type: "function",
		name: "withdrawOrdersAt",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "tick", type: "uint8" },
			{ name: "isYes", type: "bool" },
		],
		outputs: [{ type: "uint256" }],
	},
	{
		type: "function",
		name: "payCrankReward",
		stateMutability: "nonpayable",
		inputs: [{ name: "tick", type: "uint8" }],
		outputs: [{ type: "uint256" }],
	},
	{
		type: "function",
		name: "resolve",
		stateMutability: "nonpayable",
		inputs: [{ name: "o", type: "uint8" }],
		outputs: [],
	},
	{ type: "function", name: "claimAndWithdraw", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }] },
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
] as const

export const factoryAbi = [
	{
		type: "function",
		name: "recent",
		stateMutability: "view",
		inputs: [{ name: "n", type: "uint256" }],
		outputs: [{ type: "address[]" }],
	},
	{ type: "function", name: "allSeries", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
	{ type: "function", name: "count", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
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
] as const

export const seriesAbi = [
	{ type: "function", name: "pokeable", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
	{ type: "function", name: "poke", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "address" }] },
	{ type: "function", name: "current", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
	{ type: "function", name: "question", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
	{ type: "function", name: "count", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const

export const naiveBookAbi = [
	{
		type: "function",
		name: "place",
		stateMutability: "payable",
		inputs: [
			{ name: "tick", type: "uint8" },
			{ name: "shares", type: "uint128" },
			{ name: "isYes", type: "bool" },
		],
		outputs: [{ type: "uint32" }],
	},
	{
		type: "function",
		name: "matchAll",
		stateMutability: "nonpayable",
		inputs: [{ name: "maxSteps", type: "uint32" }],
		outputs: [{ type: "uint128" }],
	},
] as const
