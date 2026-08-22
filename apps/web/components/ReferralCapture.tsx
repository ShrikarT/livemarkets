"use client"

import { useEffect } from "react"

/** Where a captured ?ref= lives until the visitor has an address to attach it to. */
export const REF_KEY = "lm:ref"

/**
 * Renders nothing. Its whole job is to catch ?ref=0x... on arrival and remember
 * it, because the visitor almost never has a wallet at the moment they click the
 * link -- they sign in first, which navigates away and would otherwise drop the
 * code.
 *
 * Reads window.location rather than useSearchParams on purpose: useSearchParams
 * opts the surrounding subtree into dynamic rendering and wants a Suspense
 * boundary, which is a lot of machinery for reading one query param once.
 *
 * FIRST LINK WINS. If someone already arrived through a referral, a later ?ref=
 * does not overwrite it -- otherwise the last person to send you a link steals
 * the credit from whoever actually introduced you.
 */
export function ReferralCapture() {
	useEffect(() => {
		try {
			const raw = new URLSearchParams(window.location.search).get("ref")
			if (!raw) return
			const candidate = raw.trim().toLowerCase()
			if (!/^0x[0-9a-f]{40}$/.test(candidate)) return
			if (window.localStorage.getItem(REF_KEY)) return
			window.localStorage.setItem(REF_KEY, candidate)
		} catch {
			/* private mode blocks storage; referrals are not worth breaking a page over */
		}
	}, [])

	return null
}
