/**
 * The character cell, measured instead of asserted.
 *
 * V1 hardcoded `--cell-w: 8px` and then divided pixel widths by 8 to get column
 * counts. The mono stack resolves to a different font on every platform and a
 * 13px glyph advances about 7.8px, so a 170-column field accumulated roughly 34px
 * of drift. That drift was the ragged right edge on the V1 landing page.
 *
 * Two rules, in order of preference:
 *
 *   1. PREFER `ch`. Anything whose width is a character count should be sized in
 *      the current font -- `width: 44ch` -- and never converted to pixels at all.
 *      `1ch` is by definition one advance of "0", which is exactly the unit meant.
 *      See .ascii-block / .depth-ladder in globals.css.
 *
 *   2. Where a component genuinely needs the pixel value -- canvas sampling,
 *      hit-testing a cell from a pointer position -- measure it once with the
 *      function below and write it back as a custom property so CSS and JS agree.
 *
 * The `--cell-w: 8px` in :root stays as the pre-measurement default so nothing
 * renders at zero width during the first paint.
 */

export type Cell = { cellW: number; cellH: number }

/** Fallback, matching the :root defaults. Used on the server and before layout. */
export const DEFAULT_CELL: Cell = { cellW: 8, cellH: 16 }

/**
 * Real advance width and line height of one character in the resolved mono stack,
 * as it renders inside `host`.
 *
 * Averaged over 100 glyphs so a sub-pixel advance does not round to a lie, then
 * written back onto the host as --cell-w / --cell-h.
 */
export function measureCell(host: HTMLElement): Cell {
	const probe = document.createElement("span")
	probe.className = "ascii"
	probe.textContent = "0".repeat(100)
	probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;top:0;left:0"
	host.appendChild(probe)
	const rect = probe.getBoundingClientRect()
	probe.remove()

	// A detached or display:none host measures zero. Refuse to write a zero back.
	if (rect.width <= 0 || rect.height <= 0) return DEFAULT_CELL

	const cellW = rect.width / 100
	const cellH = rect.height
	host.style.setProperty("--cell-w", `${cellW}px`)
	host.style.setProperty("--cell-h", `${cellH}px`)
	return { cellW, cellH }
}

/**
 * Keep a host's cell measurement honest.
 *
 * Re-measures on resize (zoom changes the advance) and once the font stack has
 * settled, because the first paint may be measuring a fallback that is about to
 * be replaced. Returns a teardown function.
 */
export function watchCell(host: HTMLElement, onChange?: (cell: Cell) => void): () => void {
	let raf = 0

	const remeasure = () => {
		cancelAnimationFrame(raf)
		raf = requestAnimationFrame(() => {
			onChange?.(measureCell(host))
		})
	}

	remeasure()
	window.addEventListener("resize", remeasure)

	// document.fonts may not exist in a test environment.
	const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
	if (fonts?.ready) void fonts.ready.then(remeasure).catch(() => {})

	return () => {
		cancelAnimationFrame(raf)
		window.removeEventListener("resize", remeasure)
	}
}

/**
 * How many whole characters fit across `pxWidth`, given a measured cell.
 *
 * Exists so the one remaining pixels-to-columns conversion in the codebase is in
 * a single reviewable place, uses a measured value, and floors rather than rounds
 * -- a column that only half fits is a column that shears the line.
 */
export function columnsFor(pxWidth: number, cell: Cell = DEFAULT_CELL, min = 8): number {
	if (!(pxWidth > 0) || !(cell.cellW > 0)) return min
	return Math.max(min, Math.floor(pxWidth / cell.cellW))
}
