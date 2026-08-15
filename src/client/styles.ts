/**
 * Card styles, injected as one plugin-owned `<style>` tag.
 *
 * The upstream cards use CSS Modules compiled into their bundle. This plugin
 * ships one small stylesheet instead: the rule set is a dozen selectors, and a
 * CSS-Modules pipeline would add a bundler plugin (hashing, virtual ids, the
 * `_<hash>_<local>` identifier contract) to own nothing but that. The class
 * names are prefixed instead, which is what the hashing would buy here.
 *
 * Every colour, radius and border comes from the shell's `--dsw-alias-*`
 * tokens rather than literals, so the card follows the light/dark theme and any
 * future retheme without this package shipping an update.
 *
 * @module dsh-web-search-searxng/client/styles
 */

/** Attribute the shell uses to reap plugin-owned tags when a bundle unloads. */
export const STYLE_TAG_ATTRIBUTE = 'data-plugin'

/** Identifier carried on the tag; matches the package name. */
export const STYLE_TAG_ID = 'dsh-web-search-searxng'

/** The card's stylesheet, mirroring the sibling plugin cards' chrome. */
export const CARD_CSS = `
.dsw-searxng-card {
  list-style: none;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  transition: border-color 0.16s, background 0.16s;
}
.dsw-searxng-card:hover { border-color: var(--dsw-alias-label-dimmed); }

.dsw-searxng-card__header {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.dsw-searxng-card__heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
}
.dsw-searxng-card__title {
  font-size: 15px;
  font-weight: 600;
  line-height: 21px;
  color: var(--dsw-alias-label-primary);
}
.dsw-searxng-card__description {
  font-size: 13px;
  line-height: 19px;
  color: var(--dsw-alias-label-tertiary);
}

.dsw-searxng-card__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 16px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dsw-searxng-card__body > p {
  margin: 0;
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
}

.dsw-searxng-card__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.dsw-searxng-card__field > span {
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
}
.dsw-searxng-card__field > small {
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
}
.dsw-searxng-card__field > select {
  padding: 7px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.dsw-searxng-card__field > select:disabled { cursor: default; opacity: 0.6; }

.dsw-searxng-card__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
`

/**
 * Attach the stylesheet, returning the disposer that removes it.
 *
 * Idempotent: a second call while a tag is already present reuses it, so an
 * HMR reload cannot stack duplicates.
 * @returns disposer removing the tag this call owns.
 */
export function installCardStyles(): () => void {
  const selector = `style[${STYLE_TAG_ATTRIBUTE}="${STYLE_TAG_ID}"]`
  const existing = document.head.querySelector(selector)
  if (existing !== null) return () => existing.remove()

  const tag = document.createElement('style')
  tag.setAttribute(STYLE_TAG_ATTRIBUTE, STYLE_TAG_ID)
  tag.textContent = CARD_CSS
  document.head.appendChild(tag)
  return () => tag.remove()
}
