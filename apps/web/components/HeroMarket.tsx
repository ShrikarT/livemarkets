import { HeroLive } from "./HeroLive"
import { readHero } from "../lib/hero"

/**
 * The landing hero: a real market, server-rendered.
 *
 * §4.2, and it is the single most important change in V2. The V1 landing page
 * opened with generated ASCII art and then argued about storage slots; a visitor
 * could reach the footer without ever seeing a question, a price or a countdown.
 * The product is a market. So the market is the first thing on the page.
 *
 * Server component on purpose: the first paint carries real prices and real
 * clocks in the HTML, so the page is meaningful with JavaScript still in flight,
 * and it is indexable. HeroLive then takes over and keeps it current.
 */
export async function HeroMarket() {
	const payload = await readHero()
	return <HeroLive initial={payload} />
}
