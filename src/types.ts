/**
 * SearXNG JSON wire shapes. Only the fields this provider reads are declared —
 * a SearXNG instance returns considerably more per result (`engine`, `score`,
 * `parsed_url`, `thumbnail`, …) and the set varies by engine, so every field
 * here is optional except `url`, which is the one thing a citeable source
 * cannot do without.
 *
 * @module dsh-web-search-searxng/types
 */

/** One entry of the instance's `results[]` array. */
export interface SearxngResult {
  /** Result URL. The only field this provider requires. */
  readonly url?: unknown
  /** Result title as the engine reported it. */
  readonly title?: unknown
  /** Engine-supplied excerpt. Becomes the source `snippet`. */
  readonly content?: unknown
  /**
   * Publication timestamp when the engine supplies one. Frequently absent —
   * general web engines rarely date their results, news engines usually do.
   */
  readonly publishedDate?: unknown
}

/**
 * The instance's `format=json` response body. `answers` and `infoboxes` are
 * present but usually empty; `unresponsive_engines` reports partial failures
 * the instance chose to serve around rather than fail on.
 */
export interface SearxngResponse {
  readonly results?: unknown
  readonly answers?: unknown
  readonly unresponsive_engines?: unknown
}
