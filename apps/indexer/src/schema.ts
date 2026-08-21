import { relations } from "drizzle-orm"
import {
	bigint,
	boolean,
	index,
	integer,
	numeric,
	pgTable,
	primaryKey,
	smallint,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core"

/**
 * Indexer schema.
 *
 * The contracts deliberately keep no history — no global volume counter, no
 * cumulative arrays, nothing that every trader would have to write to. That is
 * what makes 19 simultaneous matchTick() transactions possible, and it is why
 * history has to live off-chain. This is that off-chain half.
 *
 * Two rules everywhere below:
 *
 *   1. Every row is keyed by (blockNumber, logIndex) or an equivalent natural
 *      key, so re-indexing the same range twice changes nothing. Reorg handling
 *      is then just "re-scan the last N blocks", not a bespoke rollback path.
 *   2. Token amounts are numeric(78,0), not bigint. Postgres bigint is 64-bit
 *      and a uint256 is not; storing wei in a bigint column is a silent
 *      truncation bug waiting for a whale.
 */

const wei = (name: string) => numeric(name, { precision: 78, scale: 0 })

export const markets = pgTable(
	"markets",
	{
		address: text("address").primaryKey(),
		question: text("question").notNull(),
		series: text("series"),
		round: integer("round"),
		openUntil: timestamp("open_until", { withTimezone: true }).notNull(),
		resolveAfter: timestamp("resolve_after", { withTimezone: true }).notNull(),
		/** 0 unresolved · 1 yes · 2 no · 3 void */
		outcome: smallint("outcome").notNull().default(0),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
		/** denormalised so the landing page is one row read, not a scan */
		matchedWei: wei("matched_wei").notNull().default("0"),
		tradeCount: integer("trade_count").notNull().default(0),
		traderCount: integer("trader_count").notNull().default(0),
		finalImpliedBps: integer("final_implied_bps"),
		createdBlock: bigint("created_block", { mode: "bigint" }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(t) => [
		index("markets_created_idx").on(t.createdAt),
		index("markets_outcome_idx").on(t.outcome),
		index("markets_series_idx").on(t.series, t.round),
	],
)

export const orders = pgTable(
	"orders",
	{
		market: text("market").notNull(),
		maker: text("maker").notNull(),
		tick: smallint("tick").notNull(),
		isYes: boolean("is_yes").notNull(),
		indexInBook: integer("index_in_book").notNull(),
		shares: wei("shares").notNull(),
		paid: wei("paid").notNull(),
		blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
		logIndex: integer("log_index").notNull(),
		txHash: text("tx_hash").notNull(),
		at: timestamp("at", { withTimezone: true }).notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.blockNumber, t.logIndex] }),
		index("orders_market_idx").on(t.market, t.tick),
		index("orders_maker_idx").on(t.maker, t.at),
	],
)

export const matches = pgTable(
	"matches",
	{
		market: text("market").notNull(),
		tick: smallint("tick").notNull(),
		shares: wei("shares").notNull(),
		tickTotal: wei("tick_total").notNull(),
		matcher: text("matcher").notNull(),
		blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
		logIndex: integer("log_index").notNull(),
		txHash: text("tx_hash").notNull(),
		at: timestamp("at", { withTimezone: true }).notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.blockNumber, t.logIndex] }),
		index("matches_market_idx").on(t.market, t.at),
		// The parallelism proof: count distinct matchers and distinct txs that
		// landed in one block for one market.
		index("matches_block_idx").on(t.blockNumber, t.market),
		index("matches_matcher_idx").on(t.matcher),
	],
)

export const claims = pgTable(
	"claims",
	{
		market: text("market").notNull(),
		who: text("who").notNull(),
		net: wei("net").notNull(),
		fee: wei("fee").notNull(),
		blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
		logIndex: integer("log_index").notNull(),
		txHash: text("tx_hash").notNull(),
		at: timestamp("at", { withTimezone: true }).notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.blockNumber, t.logIndex] }),
		index("claims_who_idx").on(t.who, t.at),
		index("claims_market_idx").on(t.market),
	],
)

/**
 * Running per-address totals. Recomputed by the indexer rather than trusted from
 * the client, and deliberately not stored onchain — a leaderboard onchain is a
 * shared counter, and a shared counter is the thing this whole design exists to
 * avoid.
 */
export const traders = pgTable(
	"traders",
	{
		address: text("address").primaryKey(),
		stakedWei: wei("staked_wei").notNull().default("0"),
		returnedWei: wei("returned_wei").notNull().default("0"),
		feesPaidWei: wei("fees_paid_wei").notNull().default("0"),
		roundsTraded: integer("rounds_traded").notNull().default(0),
		roundsWon: integer("rounds_won").notNull().default(0),
		cranksLanded: integer("cranks_landed").notNull().default(0),
		firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
		lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
		/** who sent this address here, if anyone */
		referrer: text("referrer"),
	},
	(t) => [index("traders_referrer_idx").on(t.referrer), index("traders_last_seen_idx").on(t.lastSeen)],
)

/**
 * Referral attributions. Written by the web app on first visit with ?ref=, read
 * by the leaderboard. Kept append-only with a unique constraint on the invitee so
 * the first referrer wins and nobody can steal an existing user.
 */
export const referrals = pgTable(
	"referrals",
	{
		invitee: text("invitee").primaryKey(),
		referrer: text("referrer").notNull(),
		claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(),
		/** only counts once the invitee has actually traded */
		qualified: boolean("qualified").notNull().default(false),
	},
	(t) => [uniqueIndex("referrals_pair_idx").on(t.referrer, t.invitee)],
)

/** One row. Where the indexer got to, so a restart resumes instead of re-scanning. */
export const cursor = pgTable("cursor", {
	id: text("id").primaryKey(),
	blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
})

export const marketRelations = relations(markets, ({ many }) => ({
	orders: many(orders),
	matches: many(matches),
	claims: many(claims),
}))

export type Market = typeof markets.$inferSelect
export type Order = typeof orders.$inferSelect
export type Match = typeof matches.$inferSelect
export type Claim = typeof claims.$inferSelect
export type Trader = typeof traders.$inferSelect
