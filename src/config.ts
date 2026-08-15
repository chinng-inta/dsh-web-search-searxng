/**
 * The plugin's configuration vocabulary: the schema a settings surface renders,
 * the namespace it is stored under, and the projection into provider options.
 *
 * Split out of the plugin entry so the settings gateway can validate a patch
 * against the same schema without importing the entry back (a cycle).
 *
 * @module dsh-web-search-searxng/config
 */
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { SEARXNG_DEFAULT_MAX_SNIPPET_CHARS, SEARXNG_DEFAULT_TIMEOUT_MS } from './provider.js'
import type { SearxngSearchProviderOptions, SearxngTimeRange } from './provider.js'

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

/** Every key the schema declares; the gate a patch from the wire must pass. */
export const CONFIG_KEYS: readonly string[] = [
  'baseURL',
  'categories',
  'engines',
  'language',
  'timeRange',
  'safesearch',
  'timeoutMs',
  'maxSnippetChars',
  'headers',
]

/** Where the effective instance URL came from, for a configuration surface. */
export type BaseUrlSource = 'settings' | 'environment' | 'none'

/**
 * Resolve the effective instance URL and say which layer supplied it.
 *
 * A configuration surface needs the distinction: a deployment whose URL comes
 * from `$SEARXNG_URL` shows an empty field that is nonetheless working, and
 * saying "unset" there would be a lie.
 * @param config - the currently authoritative section.
 * @returns the effective URL (when any) and its origin.
 */
export function resolveBaseURL(config: Config): {
  baseURL: string | undefined
  source: BaseUrlSource
} {
  const configured = config.baseURL
  if (configured !== undefined && configured.length > 0) {
    return { baseURL: configured, source: 'settings' }
  }
  const ambient = process.env[SEARXNG_BASE_URL_ENV]
  if (ambient !== undefined && ambient.length > 0) return { baseURL: ambient, source: 'environment' }
  return { baseURL: undefined, source: 'none' }
}

/**
 * Project one resolved settings section into provider options.
 *
 * The `$SEARXNG_URL` fallback is applied HERE rather than once at `apply`, so
 * clearing `baseURL` in the settings document falls back to the environment
 * again instead of stranding the provider on a value it can no longer see.
 * @param config - the currently authoritative section.
 * @returns options for one operation.
 */
export function resolveOptions(config: Config): SearxngSearchProviderOptions {
  const { baseURL } = resolveBaseURL(config)
  return {
    ...(baseURL === undefined ? {} : { baseURL }),
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
