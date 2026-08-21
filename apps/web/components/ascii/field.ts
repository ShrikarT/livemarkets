/**
 * The generated ASCII field.
 *
 * A flow field of characters that the cursor pushes through, and which resolves
 * into a wordmark where the pointer has been. Used three times:
 *   - the landing hero            (word: LIVEMARKETS)
 *   - the 404 page                (word: LOST)
 *   - the app's first paint       (word: LOADING)
 *
 * Deliberately hand-built rather than a shader or a GIF:
 *   - it is text, so it costs nothing to ship and scales to any viewport
 *   - it is sized in whole character cells, so it lands on the same grid as the
 *     depth ladder and the countdown instead of floating over them
 *   - it degrades to a static frame with reduced motion, and to a plain mask
 *     server-side, so there is no flash of empty hero
 *
 * No React in this file. The driving component owns the frame loop.
 */

/** Dark to light. Index into this with a 0..1 intensity. */
export const RAMP = " .:-=+*#%@"

/** The 30fps cap. A field that repaints every frame is a battery bug. */
export const FRAME_MS = 1000 / 30

export type Pointer = { col: number; row: number; active: boolean }

/**
 * A 5x7 bitmap font, so the wordmark mask can be built with no canvas at all.
 * This is what runs during server rendering and in the reduced-motion path.
 * Only the glyphs the three words need.
 */
const GLYPHS: Record<string, string[]> = {
	A: [" ### ", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
	D: ["#### ", "#   #", "#   #", "#   #", "#   #", "#   #", "#### "],
	E: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#####"],
	G: [" ### ", "#   #", "#    ", "#  ##", "#   #", "#   #", " ### "],
	I: ["#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "#####"],
	K: ["#   #", "#  # ", "# #  ", "##   ", "# #  ", "#  # ", "#   #"],
	L: ["#    ", "#    ", "#    ", "#    ", "#    ", "#    ", "#####"],
	M: ["#   #", "## ##", "# # #", "#   #", "#   #", "#   #", "#   #"],
	N: ["#   #", "##  #", "# # #", "#  ##", "#   #", "#   #", "#   #"],
	O: [" ### ", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
	R: ["#### ", "#   #", "#   #", "#### ", "# #  ", "#  # ", "#   #"],
	S: [" ####", "#    ", "#    ", " ### ", "    #", "    #", "#### "],
	T: ["#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  "],
	V: ["#   #", "#   #", "#   #", "#   #", "#   #", " # # ", "  #  "],
	" ": ["     ", "     ", "     ", "     ", "     ", "     ", "     "],
}

const GLYPH_W = 5
const GLYPH_H = 7

/**
 * Build a boolean mask of `word`, centred in a cols x rows character grid.
 * Scales the bitmap font up in whole characters only — a half-cell glyph would
 * break the grid alignment that the whole design depends on.
 */
export function buildWordMask(word: string, cols: number, rows: number): Uint8Array {
	const mask = new Uint8Array(cols * rows)
	const letters = word.toUpperCase().split("")
	const known = letters.filter((c) => GLYPHS[c])
	if (known.length === 0 || cols < GLYPH_W || rows < GLYPH_H) return mask

	// widest whole-number scale that still fits, with a 2-cell margin
	const naturalW = known.length * (GLYPH_W + 1) - 1
	const scale = Math.max(1, Math.min(Math.floor((cols - 4) / naturalW), Math.floor((rows - 2) / GLYPH_H)))

	const wordW = naturalW * scale
	const wordH = GLYPH_H * scale
	const x0 = Math.floor((cols - wordW) / 2)
	const y0 = Math.floor((rows - wordH) / 2)

	let penX = x0
	for (const ch of known) {
		const glyph = GLYPHS[ch]!
		for (let gy = 0; gy < GLYPH_H; gy++) {
			const line = glyph[gy]!
			for (let gx = 0; gx < GLYPH_W; gx++) {
				if (line[gx] !== "#") continue
				for (let sy = 0; sy < scale; sy++) {
					for (let sx = 0; sx < scale; sx++) {
						const x = penX + gx * scale + sx
						const y = y0 + gy * scale + sy
						if (x >= 0 && x < cols && y >= 0 && y < rows) mask[y * cols + x] = 1
					}
				}
			}
		}
		penX += (GLYPH_W + 1) * scale
	}
	return mask
}

/** How many whole character cells fit in a box. The grid is never fractional. */
export function measureGrid(widthPx: number, heightPx: number, cellW: number, cellH: number) {
	return {
		cols: Math.max(8, Math.floor(widthPx / cellW)),
		rows: Math.max(6, Math.floor(heightPx / cellH)),
	}
}

export class FieldEngine {
	readonly cols: number
	readonly rows: number
	private mask: Uint8Array
	private buf: string[]

	constructor(opts: { cols: number; rows: number; word: string }) {
		this.cols = opts.cols
		this.rows = opts.rows
		this.mask = buildWordMask(opts.word, opts.cols, opts.rows)
		this.buf = new Array(opts.rows).fill("")
	}

	/**
	 * One frame.
	 *
	 * @param t       elapsed milliseconds
	 * @param pointer where the cursor is, in cells. Resolves the wordmark locally.
	 * @param still   render the flow field frozen (reduced motion / SSR)
	 */
	render(t: number, pointer?: Pointer, still = false): string {
		const { cols, rows, mask } = this
		const time = still ? 0 : t / 1000
		// radius of the cursor's influence, in cells
		const reach = Math.max(10, Math.min(cols, rows) * 0.55)

		for (let y = 0; y < rows; y++) {
			let line = ""
			for (let x = 0; x < cols; x++) {
				// A cheap, stable plasma. Three sines at different scales so it never
				// reads as a repeating tile.
				const nx = x / cols
				const ny = y / rows
				let v =
					Math.sin((nx * 7 + time * 0.35) * Math.PI) * 0.5 +
					Math.sin((ny * 5 - time * 0.22) * Math.PI) * 0.3 +
					Math.sin(((nx + ny) * 4 + time * 0.14) * Math.PI) * 0.2
				v = (v + 1) / 2 // 0..1

				// The wordmark is always faintly present, and resolves where the
				// pointer is. Discovery, not decoration.
				if (mask[y * cols + x]) {
					let reveal = 0.34
					if (pointer?.active) {
						const dx = x - pointer.col
						const dy = (y - pointer.row) * 2 // cells are 1:2, keep the falloff round
						const d = Math.sqrt(dx * dx + dy * dy)
						reveal = Math.max(reveal, 1 - Math.min(1, d / reach))
					}
					v = v * (1 - reveal) + reveal
				}

				const i = Math.max(0, Math.min(RAMP.length - 1, Math.round(v * (RAMP.length - 1))))
				line += RAMP[i]
			}
			this.buf[y] = line
		}
		return this.buf.join("\n")
	}

	/** The frame rendered server-side, so the hero is never blank on first paint. */
	still(): string {
		return this.render(0, undefined, true)
	}
}
