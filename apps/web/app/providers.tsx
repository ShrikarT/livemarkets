"use client"

import { PrivyProvider } from "@privy-io/react-auth"
import { WagmiProvider, createConfig } from "@privy-io/wagmi"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { useState } from "react"
import { http } from "viem"

import { activeChain } from "../config/chains"

/**
 * One chain object, handed to both viem/wagmi and Privy. Defining the chain twice
 * is how you end up with a wallet on the right network and an app that thinks it
 * is on the wrong one.
 */
const wagmiConfig = createConfig({
	chains: [activeChain],
	transports: { [activeChain.id]: http() },
})

export function Providers({ children }: { children: ReactNode }) {
	// One client per browser session, created inside the component so it is never
	// shared across requests on the server.
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						// A 60-second market has no use for stale data.
						staleTime: 0,
						gcTime: 30_000,
						retry: 1,
						refetchOnWindowFocus: true,
					},
				},
			}),
	)

	const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID

	// Watch mode is a first-class state. With no Privy app id configured the app
	// still renders every market, every book and every price — it just cannot sign.
	// Never gate reading a market behind a login wall.
	if (!appId) {
		return (
			<QueryClientProvider client={queryClient}>
				<WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
			</QueryClientProvider>
		)
	}

	return (
		<PrivyProvider
			appId={appId}
			config={{
				// An email login that silently provisions a wallet. The first market a
				// new user sees should be tradeable, not a wallet-install tutorial.
				loginMethods: ["email", "wallet", "google"],
				embeddedWallets: { createOnLogin: "users-without-wallets" },
				defaultChain: activeChain,
				supportedChains: [activeChain],
				appearance: {
					theme: "dark",
					accentColor: "#4C6BFF",
					showWalletLoginFirst: false,
				},
			}}
		>
			<QueryClientProvider client={queryClient}>
				<WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
			</QueryClientProvider>
		</PrivyProvider>
	)
}
