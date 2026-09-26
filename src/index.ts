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
import type {} from '@deepseek-ai/dsh-settings'
import { Config, resolveOptions, snapshotConfig } from './config.js'
import type { LiveConfig } from './config.js'
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
  snapshotConfig,
} from './config.js'
export type { BaseUrlSource, LiveConfig } from './config.js'
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
 * Register the SearXNG search provider with `ctx.web`, and expose its
 * configuration to a browser half over the plugin's own endpoints.
 *
 * Every Config field is volatile (see `Config`), so `config` holds live
 * references that a settings edit updates in place. The provider and the
 * gateway both read through {@link snapshotConfig} per operation, so an edit
 * reaches the NEXT search without a restart.
 *
 * Nothing registers a settings section any more: 0.1.7-rc.2 deleted
 * `settings.installSection` along with the shared `settings.yaml`. The
 * settings service now finds this plugin by its profile entry id and derives
 * the form from the exported `Config` schema on its own.
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
 * @param config - this plugin row's live config.
 */
export function apply(ctx: Context, config: LiveConfig): void {
  const current = (): Config => snapshotConfig(config)

  ctx.web.registerSearchProvider(new SearxngSearchProvider(() => resolveOptions(current())))

  ctx.inject(['typert'], (tctx) => {
    tctx.plugin(SearxngConfigGateway, current)
    tctx.typert.register(searxngTypertContribution())
  })
}
