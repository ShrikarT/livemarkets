import Link from "next/link"

import { AsciiHero } from "../components/ascii/AsciiHero"

export const metadata = { title: "Lost" }

/**
 * 404.
 *
 * A dead link in a product about sixty-second markets should still feel like the
 * product, so it gets the same field as the landing page with a different word in
 * it. The two exits are the two things anyone landing here actually wants.
 */
export default function NotFound() {
	return (
		<div className="theme-ink">
			<main className="wrap" style={{ paddingTop: "var(--s7)", paddingBottom: "var(--s8)" }}>
				<AsciiHero word="LOST" rows={12} />
				<h1 className="display" style={{ fontSize: "var(--t-h2)", margin: "var(--s5) 0 var(--s3)" }}>
					That round is gone
				</h1>
				<p className="prose" style={{ maxWidth: "var(--measure)" }}>
					Either the address is wrong, or you are looking at a market from a series that has already rolled over.
					Rounds are not deleted — every settled market stays readable onchain — but they do fall off the front page.
				</p>
				<div style={{ display: "flex", gap: "var(--s3)", marginTop: "var(--s5)", flexWrap: "wrap" }}>
					<Link className="btn" href="/app">
						Live rounds
					</Link>
					<Link className="btn btn-ghost" href="/">
						How it works
					</Link>
				</div>
			</main>
		</div>
	)
}
