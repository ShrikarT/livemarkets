import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"

import { brand } from "../config/brand"
import { Providers } from "./providers"
import "./globals.css"

export const metadata: Metadata = {
	metadataBase: new URL(brand.url),
	title: {
		default: `${brand.name} — ${brand.tagline}`,
		template: `%s — ${brand.name}`,
	},
	description: brand.description,
	applicationName: brand.name,
	openGraph: {
		title: brand.name,
		description: brand.description,
		url: brand.url,
		siteName: brand.name,
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		site: brand.handles.x,
		title: brand.name,
		description: brand.description,
	},
	robots: { index: true, follow: true },
}

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	// The palette is deliberate; let the browser chrome match the page it is on.
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#F2EFE6" },
		{ media: "(prefers-color-scheme: dark)", color: "#0B0B0C" },
	],
}

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body>
				{/*
				  Duotone separation filter, defined once for the whole app.
				  Photographs and engravings get pushed through this so they land in the
				  palette instead of dragging their own colours in. Layer order across the
				  product is always: duotone plate -> halftone screen -> ASCII on top.
				*/}
				<svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
					<defs>
						<filter id="duotone" colorInterpolationFilters="sRGB">
							{/* flatten to luminance, then remap black->ink, white->paper */}
							<feColorMatrix
								type="matrix"
								values="0.2126 0.7152 0.0722 0 0
								        0.2126 0.7152 0.0722 0 0
								        0.2126 0.7152 0.0722 0 0
								        0      0      0      1 0"
							/>
							<feComponentTransfer>
								{/* #0B1E7A -> #F2EFE6 */}
								<feFuncR type="table" tableValues="0.043 0.949" />
								<feFuncG type="table" tableValues="0.118 0.937" />
								<feFuncB type="table" tableValues="0.478 0.902" />
							</feComponentTransfer>
						</filter>
						<filter id="duotone-riso" colorInterpolationFilters="sRGB">
							<feColorMatrix
								type="matrix"
								values="0.2126 0.7152 0.0722 0 0
								        0.2126 0.7152 0.0722 0 0
								        0.2126 0.7152 0.0722 0 0
								        0      0      0      1 0"
							/>
							<feComponentTransfer>
								<feFuncR type="table" tableValues="0.839 0.949" />
								<feFuncG type="table" tableValues="0.271 0.937" />
								<feFuncB type="table" tableValues="0.169 0.902" />
							</feComponentTransfer>
						</filter>
					</defs>
				</svg>

				<Providers>{children}</Providers>
			</body>
		</html>
	)
}
