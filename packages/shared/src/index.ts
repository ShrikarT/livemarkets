/**
 * Shared surface.
 *
 * Everything here is imported by the web app, the cranker AND the indexer, so it
 * is deliberately dependency-free: types, pure functions and constants only. The
 * moment this package needs viem or a database client it stops being shared and
 * starts being a third copy of the same logic drifting from the other two.
 */

export * from "./stream.js"
