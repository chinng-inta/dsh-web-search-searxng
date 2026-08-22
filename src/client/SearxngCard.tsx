/**
 * The `web-search-searxng` card on the settings "plugin configuration" page.
 *
 * The upstream client face exports no reusable card component, so the chrome is
 * self-drawn the way `dsh-llm-fallbacks` draws it: a collapsible `<li>` whose
 * header stacks the plugin name over its description and carries an "unsaved"
 * pill, then the form, then Discard / Reset / Save.
 *
 * Only the two settings a person actually retunes are here — the instance URL
 * and the search language. Everything else the schema carries (engines,
 * categories, timeouts, snippet caps) stays a deployment concern edited in the
 * settings document; putting rarely-touched knobs on a card buys clutter, not
 * control.
 *
 * @module dsh-web-search-searxng/client/SearxngCard
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import { LANGUAGE_CHOICES, isDirty, isValidBaseURL } from './searxng-store.js'
import type { SearxngCardState, SearxngSettingsController } from './searxng-store.js'

/** Injected face the slot registration hands this card. */
export interface SearxngCardInjected {
  controller: SearxngSettingsController
  /**
   * Selector hook over the card's store. The registration hands the store to
   * the renderer as `hooks.searxngCard`; the renderer binds it and delivers it
   * here under the capitalized `use` name.
   */
  useSearxngCard: <T>(select: (snapshot: SearxngCardState) => T) => T
}

/** Props delivered by the slot outlet: the inject face plus the locale seat. */
export type SearxngCardProps = SearxngCardInjected & {
  t: (key: string, params?: Record<string, string>) => string
}

/**
 * Render the SearXNG settings card.
 * @param props - injected controller/hook and the synthesized `t` seat.
 * @returns the card element.
 */
export function SearxngCard({ controller, useSearxngCard, t }: SearxngCardProps): ReactNode {
  const state = useSearxngCard((snapshot) => snapshot)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void controller.load()
  }, [controller])

  const dirty = isDirty(state)
  const urlOk = isValidBaseURL(state.draft.baseURL)
  const busy = state.saving
  const canSave = dirty && !busy && state.writable && urlOk

  return (
    <li className="dsw-searxng-card">
      <button
        type="button"
        className="dsw-searxng-card__header"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="dsw-searxng-card__heading">
          <span className="dsw-searxng-card__title">{t('title')}</span>
          <span className="dsw-searxng-card__description">{t('description')}</span>
        </span>
        {dirty ? <Pill>{t('dirty')}</Pill> : null}
      </button>

      {open ? (
        <div className="dsw-searxng-card__body">
          {state.status === 'loading' ? <p>{t('loading')}</p> : null}
          {state.status === 'failed' ? (
            <p role="alert">{t('error', { message: state.error ?? '' })}</p>
          ) : null}
          {!state.writable && state.status === 'ready' ? <p>{t('readonly')}</p> : null}

          <label className="dsw-searxng-card__field">
            <span>{t('baseURL')}</span>
            <Input
              type="url"
              inputMode="url"
              spellCheck={false}
              value={state.draft.baseURL}
              placeholder={t('baseURL.placeholder')}
              disabled={busy || !state.writable}
              onChange={(event) => controller.edit('baseURL', event.target.value)}
            />
            {/* An empty field is not necessarily unconfigured: the environment
                may be supplying the URL, and saying "unset" there would lie. */}
            {state.draft.baseURL.trim() === '' && state.baseURLSource === 'environment' ? (
              <small>
                {t('baseURL.fromEnvironment', {
                  env: state.baseURLEnvVar,
                  url: state.effectiveBaseURL ?? '',
                })}
              </small>
            ) : null}
            {state.draft.baseURL.trim() === '' && state.baseURLSource === 'none' ? (
              <small role="alert">{t('baseURL.unset', { env: state.baseURLEnvVar })}</small>
            ) : null}
            {!urlOk ? <small role="alert">{t('baseURL.invalid')}</small> : null}
          </label>

          <label className="dsw-searxng-card__field">
            <span>{t('language')}</span>
            {/* A closed list, not free text: the instance validates a language's
                SHAPE but not whether the locale exists, so a typo like `jp` is
                accepted and silently skews results instead of erroring. */}
            <select
              value={state.draft.language}
              disabled={busy || !state.writable}
              onChange={(event) => controller.edit('language', event.target.value)}
            >
              {LANGUAGE_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {'labelKey' in choice ? t(choice.labelKey) : choice.label}
                </option>
              ))}
            </select>
          </label>

          <div className="dsw-searxng-card__footer">
            <Button
              variant="ghost"
              size="sm"
              disabled={!dirty || busy}
              onClick={() => controller.discard()}
            >
              {t('discard')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !state.writable}
              onClick={() => void controller.reset()}
            >
              {t('reset')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!canSave}
              onClick={() => void controller.save()}
            >
              {busy ? t('saving') : t('save')}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
