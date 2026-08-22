"use client"

import { PrivyProvider } from "@privy-io/react-auth"
import { WagmiProvider, createConfig } from "@privy-io/wagmi"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createContext, useContext, useMemo, type ReactNode } from "react"
import { http } from "viem"

import { activeChain } from "../config/chains"

/**
 * WATCH MODE IS THE DEFAULT, NOT A FALLBACK
 *
 * Without a Privy app id the app still runs: every price, every countdown and
 * every book is readable with no account at all. That is deliberate. A prediction
 * market that shows a wallet gate before it shows a price has buried the only
 * thing that makes someone want an account.
 *
 * The awkward part is that Privy's hooks THROW when rendered outside its
 * provider -- they do not return null. So "is sign-in available" cannot be
 * answered by trying and catching, and it cannot be answered by calling the hook
 * conditionally either, because conditional hooks break the rules of hooks. The
 * answer has to come from outside React's hook system: a plain context that says
 * whether the provider is there, letting consumers pick a COMPONENT rather than
 * pick a hook call.
 */
const SignInAvailable = createContext(false)

export function useSignInAvailable(): boolean {
	return useContext(SignInAvailable)
}

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID

const wagmiConfig = createConfig({
	chains: [activeChain],
	transports: { [activeChain.id]: http() },
})

export function Providers({ children }: { children: ReactNode }) {
	const queryClient = useMemo(() => new QueryClient(), [])

	if (!appId) {
		// Read-only. Everything renders; nothing can be signed.
		return (
			<SignInAvailable.Provider value={false}>
				<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
			</SignInAvailable.Provider>
		)
	}

	return (
		<SignInAvailable.Provider value={true}>
			<PrivyProvider
				appId={appId}
				config={{
					/**
					 * Passkey first, on purpose.
					 *
					 * The market lives sixty seconds. Anything that takes longer than that
					 * to sign up for has already cost the user the round they arrived for:
					 * installing an extension, writing down a seed phrase, funding from an
					 * exchange. A passkey is Face ID and then you are in, with an embedded
					 * wallet already provisioned -- which is the only onboarding that fits
					 * inside the product's own clock.
					 *
					 * `wallet` stays last rather than being removed: someone who already
					 * has one should not be forced through an embedded wallet they do not
					 * want.
					 */
					loginMethods: ["passkey", "email", "google", "wallet"],
					embeddedWallets: { createOnLogin: "users-without-wallets" },
					defaultChain: activeChain,
					supportedChains: [activeChain],
					appearance: {
						// Match the app rather than announcing a third party inside it.
						theme: "dark",
						accentColor: "#e8552f",
						showWalletLoginFirst: false,
					},
				}}
			>
				<QueryClientProvider client={queryClient}>
					<WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
				</QueryClientProvider>
			</PrivyProvider>
		</SignInAvailable.Provider>
	)
}
