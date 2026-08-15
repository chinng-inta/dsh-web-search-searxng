/**
 * Register a SearXNG-backed search provider in `ctx.web`.
 *
 * SearXNG is a self-hosted metasearch engine. One search is a plain retrieval
 * call against `{baseURL}/search?format=json`, so unlike the shipped DeepSeek
 * provider it costs no model turn and needs no API key.
 *
 * This is an implementation package: it registers a provider and does NOT
 * register a model-facing tool. `@deepseek-ai/dsh-tool-web` owns `web_search`.
 *
 * @module dsh-web-search-searxng
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  SEARXNG_DEFAULT_MAX_SNIPPET_CHARS,
  SEARXNG_DEFAULT_TIMEOUT_MS,
  SearxngSearchProvider,
} from './provider.js'
import type { SearxngSearchProviderOptions, SearxngTimeRange } from './provider.js'

export {
  SEARXNG_DEFAULT_MAX_SNIPPET_CHARS,
  SEARXNG_DEFAULT_TIMEOUT_MS,
  SEARXNG_PROVIDER_ID,
  SearxngSearchProvider,
  mapSearxngResponse,
} from './provider.js'
export type { SearxngSearchProviderOptions, SearxngTimeRange } from './provider.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-searxng'

/** The web seam this provider registers into. */
export const inject = ['web']

/**
 * Environment variable naming the instance, used when `baseURL` is omitted.
 * `SEARXNG_URL` is the name the wider SearXNG tooling ecosystem already uses.
 */
export const SEARXNG_BASE_URL_ENV = 'SEARXNG_URL'

/**
 * The settings namespace this plugin owns. Its section resolves as
 * schema defaults → the plugin row's `config` (composition base) → the user
 * layer in the harness settings document.
 */
export const SEARXNG_SETTINGS_NAMESPACE = settingsNamespace('web-search-searxng')

/**
 * Plugin config. Every search-shaping knob lives here rather than on the tool
 * schema: the seam's `WebSearchRequest` is deliberately just `query` +
 * `maxResults`, because provider-neutral controls (recency, domain filters,
 * search depth) are named deferred work upstream. Making them deployment
 * settings keeps this provider substitutable for the shipped ones.
 */
export interface Config {
  /** Instance base URL, e.g. `http://searxng.internal:8888`. Falls back to `$SEARXNG_URL`. */
  baseURL?: string
  /** `categories=` filter, e.g. `['news']`. Omitted leaves the instance default. */
  categories?: string[]
  /** `engines=` filter, e.g. `['duckduckgo', 'brave']`. */
  engines?: string[]
  /** `language=` filter, e.g. `ja`, `en-US`. */
  language?: string
  /** `time_range=` filter. */
  timeRange?: SearxngTimeRange
  /** `safesearch=` level: 0 off, 1 moderate, 2 strict. */
  safesearch?: 0 | 1 | 2
  /** Resource backstop in milliseconds. Defaults to 10000. */
  timeoutMs?: number
  /** Per-source snippet cap in characters. Defaults to 500. */
  maxSnippetChars?: number
  /** Extra request headers, e.g. for an instance behind an authenticating proxy. */
  headers?: Record<string, string>
}

export const Config: z<Config> = z.object({
  baseURL: z.string(),
  categories: z.array(z.string()),
  engines: z.array(z.string()),
  language: z.string(),
  timeRange: z.union(['day', 'week', 'month', 'year'] as const),
  safesearch: z.union([0, 1, 2] as const),
  timeoutMs: z.number().step(1).min(1).default(SEARXNG_DEFAULT_TIMEOUT_MS),
  maxSnippetChars: z.number().step(1).min(1).default(SEARXNG_DEFAULT_MAX_SNIPPET_CHARS),
  headers: z.dict(z.string()),
}) as z<Config>

/**
 * Project one resolved settings section into provider options.
 *
 * The `$SEARXNG_URL` fallback is applied HERE rather than once at `apply`, so
 * clearing `baseURL` in the settings document falls back to the environment
 * again instead of stranding the provider on a value it can no longer see.
 * @param config - the currently authoritative section.
 * @returns options for one operation.
 */
function resolveOptions(config: Config): SearxngSearchProviderOptions {
  const baseURL = config.baseURL ?? process.env[SEARXNG_BASE_URL_ENV]
  return {
    ...(baseURL === undefined || baseURL.length === 0 ? {} : { baseURL }),
    ...(config.categories === undefined ? {} : { categories: config.categories }),
    ...(config.engines === undefined ? {} : { engines: config.engines }),
    ...(config.language === undefined ? {} : { language: config.language }),
    ...(config.timeRange === undefined ? {} : { timeRange: config.timeRange }),
    ...(config.safesearch === undefined ? {} : { safesearch: config.safesearch }),
    ...(config.headers === undefined ? {} : { headers: config.headers }),
    timeoutMs: config.timeoutMs ?? SEARXNG_DEFAULT_TIMEOUT_MS,
    maxSnippetChars: config.maxSnippetChars ?? SEARXNG_DEFAULT_MAX_SNIPPET_CHARS,
  }
}

/**
 * Register the SearXNG search provider with `ctx.web`, reading its
 * configuration through the harness settings seam when one is mounted.
 *
 * `installSettingsSection` registers {@link SEARXNG_SETTINGS_NAMESPACE} with
 * this plugin row's `config` as the composition `base`, and points the source
 * thunk at the resolved scope. When no settings service is mounted — or one
 * goes away on reload — the thunk falls back to the composition entry, so the
 * plugin behaves exactly as composed. Nothing here is conditional on a
 * provider existing.
 *
 * The provider receives the thunk rather than a snapshot, so a settings edit
 * reaches the NEXT search without a restart while the registration stays put.
 *
 * The `registerSearchProvider` disposer is deliberately not captured:
 * registration is effect-scoped and unregisters with the calling fiber, so HMR
 * and plugin disposal clean up on their own.
 *
 * @param ctx - plugin context carrying the web seam.
 * @param config - this plugin row's composition entry config.
 */
export function apply(ctx: Context, config: Config): void {
  let current = (): Config => config
  installSettingsSection(ctx, SEARXNG_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // Nothing is memoized from the section: every operation projects it fresh,
    // so there is no derived state to re-judge on a change.
    onChange: () => {},
  })

  ctx.web.registerSearchProvider(new SearxngSearchProvider(() => resolveOptions(current())))
}
