import { defineChain } from "viem"

/**
 * The chain is defined ONCE, here, and the same object is handed to viem, to
 * wagmi and to Privy. Two definitions drifting apart is a full afternoon of
 * confusing bugs, so there is exactly one.
 *
 * Nothing downstream may hardcode a chain id or an RPC URL. Going to mainnet is
 * a change to this file plus swapping the faucet step for an onramp link.
 */
export const monadTestnet = defineChain({
	id: 10143,
	name: "Monad Testnet",
	nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
	rpcUrls: {
		default: {
			http: [process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz"],
			webSocket: process.env.NEXT_PUBLIC_MONAD_WS_URL ? [process.env.NEXT_PUBLIC_MONAD_WS_URL] : undefined,
		},
	},
	blockExplorers: {
		default: {
			name: "Monad Explorer",
			url: process.env.NEXT_PUBLIC_MONAD_EXPLORER ?? "https://testnet.monadexplorer.com",
		},
	},
	testnet: true,
	contracts: {
		multicall3: process.env.NEXT_PUBLIC_MULTICALL3
			? { address: process.env.NEXT_PUBLIC_MULTICALL3 as `0x${string}` }
			: undefined,
	},
})

/** The chain the app is pointed at. One switch, one place. */
export const activeChain = monadTestnet

/**
 * Monad's timing characteristics. These drive the UI cadence, not magic numbers
 * sprinkled through components: the countdown ticks, the crank interval and the
 * optimistic-UI reconcile window are all derived from here.
 */
export const chainTiming = {
	blockMs: 400,
	finalityMs: 800,
	/** how often the cranker fires a full parallel batch */
	crankIntervalMs: 600,
} as const

export function explorerAddress(address: string): string {
	return `${activeChain.blockExplorers?.default.url}/address/${address}`
}

export function explorerTx(hash: string): string {
	return `${activeChain.blockExplorers?.default.url}/tx/${hash}`
}
