/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,

	// The contracts package is imported for ABIs, deployment addresses and the
	// shared cost vectors. Next needs to know it is part of the monorepo.
	transpilePackages: [],

	experimental: {
		// deployments/*.json and the ABIs live outside apps/web
		externalDir: true,
	},

	// A prediction market must never be served stale. Every price-bearing route
	// opts out of caching explicitly at the route level; this is belt and braces
	// for the shell.
	headers: async () => [
		{
			source: "/api/:path*",
			headers: [
				{ key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" },
				{ key: "X-Content-Type-Options", value: "nosniff" },
				{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
			],
		},
		{
			source: "/:path*",
			headers: [
				{ key: "X-Frame-Options", value: "DENY" },
				{ key: "X-Content-Type-Options", value: "nosniff" },
			],
		},
	],
}

export default nextConfig
