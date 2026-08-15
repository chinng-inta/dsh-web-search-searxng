/**
 * Host-side configuration gateway: the `/api/web-search-searxng/get|set|reset`
 * endpoints a browser half calls to read and edit this plugin's settings.
 *
 * Why a plugin-owned gateway rather than the generic settings API: the API
 * proxy serves `settings.describe`/`settings.update` only for an explicit
 * allowlist (`exposedNamespaces()` — model providers plus the product's own
 * namespaces), and its comment is deliberate: "a future registration does not
 * become remotely readable or writable by default". A third-party namespace is
 * therefore unreachable from the browser through that route. The wire-level
 * gate guards the proxy path only, so an in-process `ctx.settings.update` from
 * this plugin's own endpoint is the sanctioned way in — the same one
 * `dsh-llm-fallbacks` uses.
 *
 * Why `ctx.typert.register(...)` rather than `@Remote` markers: SRC discovery
 * reads a module-private WeakMap inside `@deepseek-ai/dsh-typert-protocol`, and
 * a plugin installed into the profile does not share that table with the host's
 * typert gateway — the endpoints would claim nothing and answer 404. The
 * explicit registry path writes invocation descriptors into `ctx.typert.local`,
 * which claim resolution checks first, so it works regardless of module
 * identity.
 *
 * @module dsh-web-search-searxng/gateway
 */
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import { CONFIG_KEYS, Config, SEARXNG_SETTINGS_NAMESPACE, resolveBaseURL } from './config.js'
import type { BaseUrlSource } from './config.js'

/** Cordis service key, and the wire namespace the endpoints are mounted under. */
export const SEARXNG_GATEWAY_SERVICE = 'webSearchSearxng'

/** Wire namespace: `/api/web-search-searxng/<method>`. */
export const SEARXNG_GATEWAY_NAMESPACE = 'web-search-searxng'

/** What one gateway read hands a configuration surface. */
export interface SearxngSettingsView {
  /** The resolved section: schema defaults → composition base → user layer. */
  readonly value: Config
  /** The instance URL actually in force, after the environment fallback. */
  readonly effectiveBaseURL?: string
  /** Which layer supplied {@link effectiveBaseURL}. */
  readonly baseURLSource: BaseUrlSource
  /** Name of the environment variable consulted when no layer sets `baseURL`. */
  readonly baseURLEnvVar: string
  /** False when no settings provider is mounted, or it is read-only. */
  readonly writable: boolean
}

/**
 * Reject a patch the settings service would otherwise merge through.
 *
 * The settings service is non-strict: an unknown key would be stored and then
 * silently ignored forever, which reads to a user as "the setting did nothing".
 * Validating against the schema also rejects a wrong-typed value before it
 * reaches storage.
 * @param patch - candidate partial section from the wire.
 */
export function validateConfigPatch(patch: unknown): asserts patch is Partial<Config> {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new Error('web-search-searxng: patch must be an object')
  }
  const unknown = Object.keys(patch).filter((key) => !CONFIG_KEYS.includes(key))
  if (unknown.length > 0) {
    throw new Error(`web-search-searxng: unknown setting(s): ${unknown.join(', ')}`)
  }
  // Schemastery schemas are callable validators; a wrong type throws here.
  Config(patch as Config)
}

/**
 * The `web-search-searxng` configuration endpoints.
 *
 * The class extends {@link TypertRemoteService} only for its `typertRemote`
 * binding, which the gateway's dispatch requires on the live service; the
 * endpoints themselves are declared by {@link searxngTypertContribution}.
 */
export class SearxngConfigGateway extends TypertRemoteService {
  /** Live settings seam while one is mounted; `undefined` otherwise. */
  private settings: Context['settings'] | undefined

  /**
   * @param ctx - plugin context owning this service.
   * @param current - thunk returning the currently authoritative section.
   */
  constructor(
    ctx: Context,
    private readonly current: () => Config,
  ) {
    super(ctx, SEARXNG_GATEWAY_SERVICE, { namespace: SEARXNG_GATEWAY_NAMESPACE })
    ctx.inject(['settings'], (sctx) => {
      this.settings = sctx.settings
      return () => {
        this.settings = undefined
      }
    })
  }

  /** Read the section as the runtime currently sees it. */
  get(): SearxngSettingsView {
    return this.view()
  }

  /**
   * Merge a patch into the user layer.
   * @param patch - partial section; unknown or wrong-typed keys are refused.
   * @returns the section as it stands after the write.
   */
  async set(patch: unknown): Promise<SearxngSettingsView> {
    validateConfigPatch(patch)
    if (Object.keys(patch).length === 0) return this.view()
    const settings = this.requireSettings()
    await settings.update(SEARXNG_SETTINGS_NAMESPACE, patch)
    return this.view()
  }

  /**
   * Clear the user layer so the section re-inherits the composition base and
   * schema defaults. `set` is merge-only and cannot express this: sending the
   * default VALUES back would pin today's defaults into the document.
   * @returns the section as it stands after the reset.
   */
  async reset(): Promise<SearxngSettingsView> {
    const settings = this.requireSettings()
    await settings.replace(SEARXNG_SETTINGS_NAMESPACE, {})
    return this.view()
  }

  /** The settings seam, or a diagnostic naming why configuration cannot be written. */
  private requireSettings(): NonNullable<Context['settings']> {
    const settings = this.settings
    if (settings === undefined) {
      throw new Error(
        'web-search-searxng: settings service is unavailable — configuration cannot be written',
      )
    }
    return settings
  }

  /** Project the live section into the wire view. */
  private view(): SearxngSettingsView {
    const value = this.current()
    const { baseURL, source } = resolveBaseURL(value)
    return {
      value,
      ...(baseURL === undefined ? {} : { effectiveBaseURL: baseURL }),
      baseURLSource: source,
      baseURLEnvVar: 'SEARXNG_URL',
      writable: this.settings?.writable ?? false,
    }
  }
}

/**
 * The invocation descriptors claiming `/api/web-search-searxng/*`.
 *
 * Registered explicitly through `ctx.typert.register` — see the module note on
 * why the decorator path cannot work for a profile-installed plugin. The
 * payload contract is one plain-object `args` field keyed by parameter name:
 * `get()` → `{ args: {} }`, `set(patch)` → `{ args: { patch } }`.
 * @returns the contribution to hand `ctx.typert.register`.
 */
export function searxngTypertContribution(): TypertContribution {
  const invocation = (method: string, parameters: unknown[]) => ({
    id: `dsh-web-search-searxng#${SEARXNG_GATEWAY_NAMESPACE}/${method}`,
    service: SEARXNG_GATEWAY_SERVICE,
    namespace: SEARXNG_GATEWAY_NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters,
    result: { mode: 'src-json' },
  })

  return {
    package: 'dsh-web-search-searxng',
    face: 'host',
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: [
      invocation('get', []),
      invocation('set', [{ name: 'patch', wire: 'patch', source: 'json', codec: { mode: 'src-json' } }]),
      invocation('reset', []),
    ],
  } as TypertContribution
}
