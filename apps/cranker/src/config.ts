import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { defineChain, type Address } from "viem"

/**
 * Cranker configuration.
 *
 * Addresses come from the same committed deployment file the web app reads, so
 * the bot and the UI can never disagree about which factory is live. Keys come
 * from the environment and are never written anywhere.
 *
 * Three separate keys, on purpose:
 *   CRANK_PRIVATE_KEY     matches ticks, earns crank rewards. Hot, low value.
 *   MAKER_PRIVATE_KEY     quotes both legs. Holds real risk capital.
 *   RESOLVER_PRIVATE_KEY  settles outcomes. The only privileged one.
 *
 * Splitting them means a leaked cranker key costs a few cents of gas, not the
 * ability to settle a market you are trading.
 */

const here = dirname(fileURLToPath(import.meta.url))
const deploymentPath = join(here, "../../../packages/contracts/deployments/10143.json")

type Deployment = {
	chainId: number
	factory: Address
	naiveBook: Address
	resolver: Address
	series: Array<{ address: Address; question: string }>
}

function loadDeployment(): Deployment {
	try {
		return JSON.parse(readFileSync(deploymentPath, "utf8")) as Deployment
	} catch {
		throw new Error(`no deployment at ${deploymentPath} \u2014 run \`npm run deploy\` first`)
	}
}

const deployment = loadDeployment()

function requireKey(name: string): `0x${string}` {
	const v = process.env[name]
	if (!v) throw new Error(`${name} is not set. See .env.example.`)
	if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} does not look like a private key`)
	return v as `0x${string}`
}

function optionalKey(name: string): `0x${string}` | undefined {
	const v = process.env[name]
	if (!v) return undefined
	if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} does not look like a private key`)
	return v as `0x${string}`
}

/**
 * Must stay in step with apps/web/config/chains.ts. Duplicated rather than
 * imported because this is a plain Node process and that file is compiled by
 * Next with its own env handling; the chain id is asserted against the
 * deployment below so a mismatch fails immediately instead of silently sending
 * transactions to the wrong network.
 */
export const chain = defineChain({
	id: 10143,
	name: "Monad Testnet",
	nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
	rpcUrls: { default: { http: [process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz"] } },
	blockExplorers: { default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" } },
	testnet: true,
})

if (deployment.chainId !== chain.id) {
	throw new Error(`deployment is for chain ${deployment.chainId}, cranker is configured for ${chain.id}`)
}

export const config = {
	rpcUrl: process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz",
	factory: deployment.factory,
	naiveBook: deployment.naiveBook,
	crankKey: requireKey("CRANK_PRIVATE_KEY"),
	makerKey: optionalKey("MAKER_PRIVATE_KEY"),
	resolverKey: optionalKey("RESOLVER_PRIVATE_KEY"),
	/** one full parallel sweep per interval; 600ms is 1.5 Monad blocks */
	intervalMs: Number(process.env.CRANK_INTERVAL_MS ?? 600),
	houseMaker: {
		enabled: process.env.HOUSE_MAKER !== "off",
		spreadBps: Number(process.env.MAKER_SPREAD_BPS ?? 500),
		sizePerLegWei: BigInt(process.env.MAKER_SIZE_WEI ?? 2n * 10n ** 18n),
		maxExposurePerRoundWei: BigInt(process.env.MAKER_MAX_ROUND_WEI ?? 10n * 10n ** 18n),
		maxDailyLossWei: BigInt(process.env.MAKER_MAX_DAILY_LOSS_WEI ?? 50n * 10n ** 18n),
	},
} as const
