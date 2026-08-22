/**
 * The web app's door onto the shared stream model.
 *
 * The types and the delay logic live in packages/shared so the indexer writer,
 * the /admin form and the frontend cannot disagree about what a valid market is.
 * This file exists so app code imports "../lib/stream" like everything else and
 * only one path in the repo reaches across workspaces.
 */

export * from "../../../packages/shared/src/stream"
