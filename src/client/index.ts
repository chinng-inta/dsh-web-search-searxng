/**
 * Browser half: registers the SearXNG card into the settings
 * "plugin configuration" page (`settings.plugin.item`).
 *
 * The card reads and writes through the plugin's OWN endpoints
 * (`connection.rpc` → `/api/web-search-searxng/*`). The generic settings API
 * cannot serve a third-party namespace — `exposedNamespaces()` is an explicit
 * allowlist — so this channel is the sanctioned route, not a workaround.
 *
 * Only value imports listed in the bundle's externals may appear in this
 * graph; every other `@deepseek-ai/*` import must be type-only. Violating that
 * does not degrade this card — it fails the whole Web UI's plugin load.
 *
 * @module dsh-web-search-searxng/client
 */
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { SEARXNG_LOCALE_NS, en, zh } from './locales.js'
import { SearxngCard } from './SearxngCard.tsx'
import { SearxngSettingsController } from './searxng-store.js'

export { SEARXNG_LOCALE_NS } from './locales.js'
export { SearxngSettingsController, LANGUAGE_CHOICES } from './searxng-store.js'
export type { SearxngCardState, SearxngSettingsView } from './searxng-store.js'
export { SearxngCard } from './SearxngCard.tsx'
export type { SearxngCardInjected, SearxngCardProps } from './SearxngCard.tsx'

/**
 * Required client services. The card registration waits on the slot
 * declaration, so `slots` must be injected rather than read reflectively.
 */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the dictionaries and the card once the `settings.plugin.item`
 * declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: any): void {
  ctx.effect(
    () => ctx.locale.register(SEARXNG_LOCALE_NS, { zh, en }),
    'web-search-searxng: dictionaries',
  )

  const connection = ctx.get('connection')
  const controller = new SearxngSettingsController(connection.rpc)
  const useSnapshot = bindSnapshotSelector(controller.store)

  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register(
      {
        name: 'settings.plugin.item',
        id: 'web-search-searxng',
        order: 40,
        locale: SEARXNG_LOCALE_NS,
        inject: () => ({ controller, useSnapshot }),
      },
      SearxngCard,
    )
  })
}
