"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { brand } from "../config/brand"
import { AuthButton } from "./auth/AuthButton"
import { FaucetButton } from "./FaucetButton"
import { ReferralCapture } from "./ReferralCapture"

/**
 * One nav for every /app surface.
 *
 * Four deliberate choices:
 *
 *   The environment label is not decoration. "test funds only" has to be visible
 *   on every screen where money appears, because a testnet app that looks like a
 *   mainnet app is a way of losing somebody's real money.
 *
 *   /app is an exact match while its children are prefix matches, so being on
 *   /app/rounds does not light up "live" as well.
 *
 *   THIS LIST ONLY CONTAINS ROUTES THAT EXIST. A nav that links to a 404 is
 *   worse than a nav with one fewer item: the dead link costs the user a page
 *   load and some trust, while the missing one costs them nothing they knew
 *   about. Add each line as its page lands -- never in advance.
 *
 *   ReferralCapture lives here rather than on the invite page because this header
 *   renders on every /app surface, and a referral link can point anywhere. It
 *   draws nothing.
 */
const LINKS: Array<{ href: string; label: string; exact: boolean }> = [
	{ href: "/app", label: "live", exact: true },
	{ href: "/app/rounds", label: "all rounds", exact: false },
	{ href: "/app/portfolio", label: "portfolio", exact: false },
	{ href: "/app/leaderboard", label: "leaderboard", exact: false },
	{ href: "/app/invite", label: "invite", exact: false },
]

export function AppNav() {
	const pathname = usePathname() ?? "/app"

	return (
		<header
			className="wrap"
			style={{
				display: "flex",
				gap: "var(--s4)",
				alignItems: "center",
				flexWrap: "wrap",
				paddingTop: "var(--s4)",
				paddingBottom: "var(--s3)",
				borderBottom: "1px solid var(--line)",
			}}
		>
			<ReferralCapture />

			<Link href="/" className="display" style={{ textDecoration: "none", letterSpacing: "0.02em" }}>
				{brand.wordmark}
			</Link>

			{LINKS.length > 1 ? (
				<nav style={{ display: "flex", gap: "var(--s3)", alignItems: "center" }}>
					{LINKS.map((l) => {
						const active = l.exact ? pathname === l.href : pathname.startsWith(l.href)
						return (
							<Link
								key={l.href}
								href={l.href}
								className="label"
								aria-current={active ? "page" : undefined}
								style={{
									color: active ? "var(--fg)" : undefined,
									textDecoration: active ? "underline" : "none",
									textUnderlineOffset: "4px",
								}}
							>
								{l.label}
							</Link>
						)
					})}
				</nav>
			) : (
				/* With a single destination there is nothing to navigate between, so a
				   one-item nav would be chrome pretending to be a menu. */
				<Link href="/app" className="label" aria-current={pathname === "/app" ? "page" : undefined}>
					live
				</Link>
			)}

			<span className="badge" style={{ marginLeft: "auto" }}>
				{brand.environmentLabel}
			</span>
			<FaucetButton />
			<AuthButton compact />
		</header>
	)
}
