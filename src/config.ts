/**
 * The plugin's configuration vocabulary: the schema a settings surface renders,
 * the namespace it is stored under, and the projection into provider options.
 *
 * Split out of the plugin entry so the settings gateway can validate a patch
 * against the same schema without importing the entry back (a cycle).
 *
 * @module dsh-web-search-searxng/config
 */
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SEARXNG_DEFAULT_MAX_SNIPPET_CHARS, SEARXNG_DEFAULT_TIMEOUT_MS } from './provider.js'
import type { SearxngSearchProviderOptions, SearxngTimeRange } from './provider.js'

/**
 * Environment variable naming the instance, used when `baseURL` is omitted.
 * `SEARXNG_URL` is the name the wider SearXNG tooling ecosystem already uses.
 */
export const SEARXNG_BASE_URL_ENV = 'SEARXNG_URL'

/**
 * The profile entry id this plugin's settings are written under.
 *
 * Since 0.1.7-rc.2 the settings service addresses a plugin by its profile
 * ENTRY id and writes edits into the active profile's patch; the shared
 * `settings.yaml` document and the per-plugin namespace registration
 * (`settings.installSection`) are gone. This therefore must equal the row id
 * `cordis.patch.yml` inserts — renaming one without the other makes every
 * write fail with `No configurable plugin entry`.
 */
export const SEARXNG_SETTINGS_NAMESPACE = 'web-search-searxng'

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

/**
 * The config `apply` actually receives: every field is `.volatile()`, so the
 * loader hands over a live reference per field instead of a value. A settings
 * edit updates the reference in place — the plugin is NOT restarted — which is
 * why the provider reads through {@link snapshotConfig} on every operation.
 */
export type LiveConfig = { readonly [K in keyof Config]-?: Volatile<Config[K] | undefined> }

/**
 * Every field is `.volatile()`. That is not a style choice: the settings
 * service refuses to write a field that is not (`Config field "…" is not
 * volatile`), and refuses an entry with none at all (`has no volatile fields`).
 *
 * The declared type is the plain {@link Config} shape, because that is what
 * the schema validates when called directly (the gateway's patch check); the
 * loader-side projection into references is {@link LiveConfig}.
 */
export const Config: z<Config> = z.object({
  baseURL: z.string().volatile(),
  categories: z.array(z.string()).volatile(),
  engines: z.array(z.string()).volatile(),
  language: z.string().volatile(),
  timeRange: z.union(['day', 'week', 'month', 'year'] as const).volatile(),
  safesearch: z.union([0, 1, 2] as const).volatile(),
  timeoutMs: z.number().step(1).min(1).default(SEARXNG_DEFAULT_TIMEOUT_MS).volatile(),
  maxSnippetChars: z.number().step(1).min(1).default(SEARXNG_DEFAULT_MAX_SNIPPET_CHARS).volatile(),
  headers: z.dict(z.string()).volatile(),
}) as unknown as z<Config>

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

/**
 * Read every live reference once, dropping the unset ones, so one operation
 * sees one consistent section even if an edit lands mid-flight.
 * @param live - the config `apply` received.
 * @returns the section as it stands now.
 */
export function snapshotConfig(live: LiveConfig): Config {
  const section: Record<string, unknown> = {}
  for (const key of CONFIG_KEYS as readonly (keyof Config)[]) {
    const value = live[key].get()
    if (value !== undefined) section[key] = value
  }
  return section as Config
}

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
