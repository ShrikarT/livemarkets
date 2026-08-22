"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { brand } from "../config/brand"
import { AuthButton } from "./auth/AuthButton"
import { FaucetButton } from "./FaucetButton"

/**
 * One nav for every /app surface.
 *
 * Three deliberate choices:
 *
 *   The environment label is not decoration. "test funds only" has to be visible
 *   on every screen where money appears, because a testnet app that looks like a
 *   mainnet app is a way of losing somebody's real money.
 *
 *   /app is an exact match while its children are prefix matches, so being on
 *   /app/rounds does not light up "live" as well.
 *
 *   There is no leaderboard link. The page does not exist yet, and a nav that
 *   links to a 404 is worse than a nav with one fewer item.
 */
const LINKS = [
	{ href: "/app", label: "live", exact: true },
	{ href: "/app/rounds", label: "all rounds", exact: false },
	{ href: "/app/portfolio", label: "portfolio", exact: false },
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
			<Link href="/" className="display" style={{ textDecoration: "none", letterSpacing: "0.02em" }}>
				{brand.wordmark}
			</Link>

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

			<span className="badge" style={{ marginLeft: "auto" }}>
				{brand.environmentLabel}
			</span>
			<FaucetButton />
			<AuthButton compact />
		</header>
	)
}
