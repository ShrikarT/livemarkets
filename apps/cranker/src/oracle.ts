import type { Address, PublicClient } from "viem"

/**
 * Outcome derivation.
 *
 * The rule here is narrow and deliberate: this function only answers questions it
 * can prove from chain data. Everything else returns null and waits for a human
 * in the resolver console.
 *
 * A bot that guesses is worse than a market that settles a minute late. Guessing
 * once, wrongly, destroys the only thing a prediction market sells.
 *
 * Adding a question type means adding a matcher here with a real data source —
 * not a heuristic on the wording.
 */

export const OUTCOME = { Unresolved: 0, Yes: 1, No: 2, Void: 3 } as const

type Deriver = {
	name: string
	/** does this handler recognise the question? */
	match: (question: string) => RegExpMatchArray | null
	/** returns an Outcome, or null to defer to a human */
	decide: (pub: PublicClient, m: RegExpMatchArray, market: Address) => Promise<number | null>
}

const derivers: Deriver[] = [
	{
		// "Next block above 2M gas?" / "next block over 2,000,000 gas"
		name: "block-gas",
		match: (q) => q.match(/block\\s+(?:above|over)\\s+([\\d.,]+)\\s*(m|k)?\\s*gas/i),
		decide: async (pub, m) => {
			const raw = Number(m[1]!.replace(/,/g, ""))
			const unit = (m[2] ?? "").toLowerCase()
			const threshold = BigInt(Math.round(raw * (unit === "m" ? 1e6 : unit === "k" ? 1e3 : 1)))
			const block = await pub.getBlock({ blockTag: "latest" })
			return block.gasUsed > threshold ? OUTCOME.Yes : OUTCOME.No
		},
	},
	{
		// "Will block N be above 2M gas?" — a specific, already-final block
		name: "specific-block-gas",
		match: (q) => q.match(/block\\s+#?(\\d{4,})\\b.*?(?:above|over)\\s+([\\d.,]+)\\s*(m|k)?\\s*gas/i),
		decide: async (pub, m) => {
			const number = BigInt(m[1]!)
			const raw = Number(m[2]!.replace(/,/g, ""))
			const unit = (m[3] ?? "").toLowerCase()
			const threshold = BigInt(Math.round(raw * (unit === "m" ? 1e6 : unit === "k" ? 1e3 : 1)))
			try {
				const block = await pub.getBlock({ blockNumber: number })
				return block.gasUsed > threshold ? OUTCOME.Yes : OUTCOME.No
			} catch {
				// The block does not exist and never will — nobody can win this, so
				// refund rather than pick a side.
				const head = await pub.getBlockNumber()
				return head > number + 100n ? OUTCOME.Void : null
			}
		},
	},
	{
		// "More than N transactions in the next block?"
		name: "block-txs",
		match: (q) => q.match(/(?:more than|above|over)\\s+([\\d,]+)\\s+transactions?/i),
		decide: async (pub, m) => {
			const threshold = Number(m[1]!.replace(/,/g, ""))
			const block = await pub.getBlock({ blockTag: "latest", includeTransactions: false })
			return block.transactions.length > threshold ? OUTCOME.Yes : OUTCOME.No
		},
	},
]

/**
 * @returns an Outcome to submit, or null when this question needs a person.
 */
export async function deriveOutcome(pub: PublicClient, question: string, market: Address): Promise<number | null> {
	for (const d of derivers) {
		const m = d.match(question)
		if (!m) continue
		try {
			const outcome = await d.decide(pub, m, market)
			if (outcome !== null) {
				console.log(`[oracle] ${d.name} decided ${["", "yes", "no", "void"][outcome]} for "${question.slice(0, 40)}"`)
			}
			return outcome
		} catch (err) {
			// A failed read is not evidence of anything. Defer.
			console.warn(`[oracle] ${d.name} failed:`, err instanceof Error ? err.message.slice(0, 100) : err)
			return null
		}
	}
	return null
}

/** Exposed so the resolver console can show which questions settle themselves. */
export function isDerivable(question: string): boolean {
	return derivers.some((d) => d.match(question) !== null)
}
