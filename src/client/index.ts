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
import { SEARXNG_LOCALE_NS, en, zh } from './locales.js'
import { SearxngCard } from './SearxngCard.tsx'
import { SearxngSettingsController } from './searxng-store.js'
import { installCardStyles } from './styles.js'

export { SEARXNG_LOCALE_NS } from './locales.js'
export { SearxngSettingsController, LANGUAGE_CHOICES } from './searxng-store.js'
export type { SearxngCardState, SearxngSettingsView } from './searxng-store.js'
export { SearxngCard } from './SearxngCard.tsx'
export type { SearxngCardInjected, SearxngCardProps } from './SearxngCard.tsx'

/**
 * The cell this card occupies.
 *
 * `settings.plugin.item` is a keyed slot: its owner enumerates the settings
 * namespaces the Host exposes and dispatches one key per namespace, so a card
 * is addressed by the namespace it edits. This must therefore equal
 * `SEARXNG_SETTINGS_NAMESPACE` in the host half. It is repeated as a literal
 * rather than imported because that module pulls in server-side packages that
 * have no place in a browser bundle.
 */
const SEARXNG_SETTINGS_KEY = 'web-search-searxng'

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
  // The card's class names match nothing until this lands: without it the card
  // still renders, just with browser defaults, which reads as a broken UI
  // rather than a missing stylesheet.
  ctx.effect(() => installCardStyles(), 'web-search-searxng: card styles')

  ctx.effect(
    () => ctx.locale.register(SEARXNG_LOCALE_NS, { zh, en }),
    'web-search-searxng: dictionaries',
  )

  const connection = ctx.get('connection')
  const controller = new SearxngSettingsController(connection.rpc)

  ctx.slots.inject('settings.plugin.item', function* () {
    // The `hooks` compartment is the sanctioned way to make a store reactive:
    // the renderer binds each entry to a selector hook and hands it over as
    // `use<Name>` — `searxngCard` arrives at the card as `useSearxngCard`.
    // Binding it here instead would mean reaching for a React binder the shell
    // no longer publishes to plugins.
    yield ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: SEARXNG_SETTINGS_KEY,
        locale: SEARXNG_LOCALE_NS,
        inject: () => ({ controller, hooks: { searxngCard: controller.store } }),
      },
      SearxngCard,
    )
  })
}
