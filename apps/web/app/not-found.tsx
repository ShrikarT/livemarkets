import Link from "next/link"

export const metadata = { title: "Lost" }

/**
 * 404.
 *
 * A dead link in a product about sixty-second markets should still feel like the
 * product, so it keeps the same type, the same palette and the same mono figure
 * language. The two exits are the two things anyone landing here actually wants.
 */
/*
 * The 404 used to render the generated ASCII wordmark. That component and its
 * noise field are deleted (spec §6): nobody asked for generated art and it
 * animated. What replaces it is a fixed, hand-written figure -- ASCII-only, so
 * it cannot shear when a glyph substitutes, and static, so it cannot distract.
 */
const LOST = `  +---------------------------------+
  |  404                            |
  |  no market at this address      |
  +---------------------------------+`

export default function NotFound() {
	return (
		<div className="theme-ink">
			<main className="wrap" style={ { paddingTop: "var(--s7)", paddingBottom: "var(--s8)" } }>
				<pre className="ascii ascii-selectable">{LOST}</pre>
				<h1 className="display" style={ { fontSize: "var(--t-h2)", margin: "var(--s5) 0 var(--s3)" } }>
					That round is gone
				</h1>
				<p className="prose" style={ { maxWidth: "var(--measure)" } }>
					Either the address is wrong, or you are looking at a market from a series that has already rolled over.
					Rounds are not deleted — every settled market stays readable onchain — but they do fall off the front page.
				</p>
				<div style={ { display: "flex", gap: "var(--s3)", marginTop: "var(--s5)", flexWrap: "wrap" } }>
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
