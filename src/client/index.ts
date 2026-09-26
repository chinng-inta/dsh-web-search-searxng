/**
 * Browser half: registers the SearXNG settings page on the Plugins page
 * (`plugins.row.config`). The bundle page lists this package's
 * `web-search-searxng` row, and the row gains a configure control that opens
 * {@link SearxngCard} as a full page.
 *
 * 0.1.7-rc.2 deleted the settings "plugin configuration" page and its
 * `settings.plugin.item` slot outright. The registration is wrapped in
 * `ctx.slots.inject`, which waits for the slot declaration, so against a shell
 * that lacks the slot the page silently never appears; the rest of the UI
 * survives.
 *
 * The card reads and writes through the plugin's OWN endpoints
 * (`connection.rpc` -> `/api/web-search-searxng/*`).
 *
 * Only value imports listed in the bundle's externals may appear in this
 * graph; every other `@deepseek-ai/*` import must be type-only. Violating that
 * does not degrade this card: it fails the whole Web UI's plugin load.
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
 * The cell on the Plugins page: `plugins.row.config` is keyed by
 * `<package name>#<row id>`, with the row id exactly as `cordis.patch.yml`
 * inserts it. Renaming either side without the other leaves the row without a
 * configure control. Repeated as a literal rather than imported from the host
 * half, whose modules pull in server-side packages that have no place in a
 * browser bundle.
 */
const SEARXNG_ROW_CONFIG_KEY = 'dsh-web-search-searxng#web-search-searxng'

/**
 * Required client services. The card registration waits on the slot
 * declaration, so `slots` must be injected rather than read reflectively.
 */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the dictionaries and the page once `plugins.row.config` is declared.
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

  // The owner renders the entry twice: `view: 'summary'` as the row's
  // one-liner, `view: 'page'` as the configure page's body.
  ctx.slots.inject('plugins.row.config', function* () {
    // The `hooks` compartment is the sanctioned way to make a store reactive:
    // the renderer binds each entry to a selector hook and hands it over as
    // `use<Name>`, so `searxngCard` arrives at the card as `useSearxngCard`.
    // Binding it here instead would mean reaching for a React binder the shell
    // no longer publishes to plugins.
    yield ctx.slots.register(
      {
        name: 'plugins.row.config',
        key: SEARXNG_ROW_CONFIG_KEY,
        locale: SEARXNG_LOCALE_NS,
        inject: () => ({ controller, hooks: { searxngCard: controller.store } }),
      },
      SearxngCard,
    )
  })
}
