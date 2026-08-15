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
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { Config, SEARXNG_SETTINGS_NAMESPACE, resolveOptions } from './config.js'
import { SearxngConfigGateway, searxngTypertContribution } from './gateway.js'
import { SearxngSearchProvider } from './provider.js'

export {
  SEARXNG_DEFAULT_MAX_SNIPPET_CHARS,
  SEARXNG_DEFAULT_TIMEOUT_MS,
  SEARXNG_PROVIDER_ID,
  SearxngSearchProvider,
  mapSearxngResponse,
} from './provider.js'
export type { SearxngSearchProviderOptions, SearxngTimeRange } from './provider.js'
export {
  Config,
  SEARXNG_BASE_URL_ENV,
  SEARXNG_SETTINGS_NAMESPACE,
  resolveBaseURL,
  resolveOptions,
} from './config.js'
export type { BaseUrlSource } from './config.js'
export {
  SEARXNG_GATEWAY_NAMESPACE,
  SEARXNG_GATEWAY_SERVICE,
  SearxngConfigGateway,
  searxngTypertContribution,
  validateConfigPatch,
} from './gateway.js'
export type { SearxngSettingsView } from './gateway.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-searxng'

/** The web seam this provider registers into. */
export const inject = ['web']

/**
 * Register the SearXNG search provider with `ctx.web`, reading its
 * configuration through the harness settings seam when one is mounted, and
 * expose that configuration to a browser half over the plugin's own endpoints.
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
 * The configuration gateway is mounted only where a typert registry exists (the
 * web app); a headless composition simply has no browser to serve, so its
 * absence is not an error.
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

  ctx.inject(['typert'], (tctx) => {
    tctx.plugin(SearxngConfigGateway, () => current())
    tctx.typert.register(searxngTypertContribution())
  })
}
