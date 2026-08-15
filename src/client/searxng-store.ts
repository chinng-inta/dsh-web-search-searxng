/**
 * Card state over the plugin's own gateway.
 *
 * The section rides `connection.rpc` → `/api/web-search-searxng/{get,set,reset}`
 * rather than the generic settings API, because the API proxy serves only an
 * allowlist of namespaces and a third-party one is not on it. See the host
 * gateway module for why that is the sanctioned route rather than a workaround.
 *
 * @module dsh-web-search-searxng/client/searxng-store
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** The languages the card offers, in menu order. */
export const LANGUAGE_CHOICES = [
  { value: '', labelKey: 'language.unset' },
  { value: 'all', labelKey: 'language.all' },
  { value: 'ja', label: '日本語' },
  { value: 'zh-CN', label: '中文（简体）' },
  { value: 'zh-TW', label: '中文（繁體）' },
  { value: 'en', label: 'English' },
] as const

/** Where the effective instance URL came from. Mirrors the host view. */
export type BaseUrlSource = 'settings' | 'environment' | 'none'

/** The host gateway's read view. */
export interface SearxngSettingsView {
  value: { baseURL?: string; language?: string }
  effectiveBaseURL?: string
  baseURLSource: BaseUrlSource
  baseURLEnvVar: string
  writable: boolean
}

/** Everything the card renders from. */
export interface SearxngCardState {
  status: 'loading' | 'ready' | 'failed'
  /** Failure text from the last load, or `undefined` while healthy. */
  error?: string | undefined
  /** Stored values, as the host last reported them. */
  stored: { baseURL: string; language: string }
  /** What the user has typed but not saved. */
  draft: { baseURL: string; language: string }
  effectiveBaseURL?: string | undefined
  baseURLSource: BaseUrlSource
  baseURLEnvVar: string
  writable: boolean
  saving: boolean
}

const EMPTY: SearxngCardState = {
  status: 'loading',
  stored: { baseURL: '', language: '' },
  draft: { baseURL: '', language: '' },
  baseURLSource: 'none',
  baseURLEnvVar: 'SEARXNG_URL',
  writable: false,
  saving: false,
}

/**
 * What one endpoint call resolves to. The channel hands back the result
 * envelope rather than the value: a refused write (an unknown key, a wrong
 * type) is `ok: false` with the host's message, NOT a thrown error, so a caller
 * that forgets to unwrap silently reads `undefined` for every field instead of
 * failing. That mistake renders as an empty, read-only card.
 */
export interface RpcResult {
  ok: boolean
  value?: unknown
  error?: { message?: string }
}

/** Minimal shape of the connection's plugin-endpoint channel. */
export interface RpcChannel {
  call(path: string, method: string, payload: unknown): Promise<RpcResult>
}

/**
 * Unwrap one endpoint result, turning a refusal into a throw.
 * @param result - the envelope the channel returned.
 * @returns the host's settings view.
 */
function unwrap(result: RpcResult): SearxngSettingsView {
  if (!result.ok) throw new Error(result.error?.message ?? 'the request was refused')
  const value = result.value
  if (typeof value !== 'object' || value === null) {
    throw new Error('the endpoint returned no settings view')
  }
  return value as SearxngSettingsView
}

/** Whether a draft differs from what the host stores. */
export function isDirty(state: SearxngCardState): boolean {
  return (
    state.draft.baseURL !== state.stored.baseURL || state.draft.language !== state.stored.language
  )
}

/**
 * Accept only an absolute http(s) URL, or empty (meaning "inherit").
 *
 * The instance rejects a malformed *language* loudly but accepts any
 * well-formed URL, so a typo in the address surfaces only as a failing search
 * much later. Catching it at the form is the earliest honest moment.
 * @param value - the draft URL.
 * @returns true when the value is usable.
 */
export function isValidBaseURL(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return true
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return false
  }
  return url.protocol === 'http:' || url.protocol === 'https:'
}

/** Owns the card's state and the three gateway calls. */
export class SearxngSettingsController {
  readonly store = createSnapshotStore<SearxngCardState>(EMPTY)

  constructor(private readonly rpc: RpcChannel) {}

  /** Read the section and reset drafts to it. */
  async load(): Promise<void> {
    try {
      this.adopt(unwrap(await this.rpc.call('/api', 'web-search-searxng/get', { args: {} })))
    } catch (error) {
      this.store.update((state) => {
        state.status = 'failed'
        state.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** Stage a field without writing it. */
  edit(field: 'baseURL' | 'language', value: string): void {
    this.store.update((state) => {
      state.draft[field] = value
    })
  }

  /** Drop staged edits. */
  discard(): void {
    this.store.update((state) => {
      state.draft = { ...state.stored }
    })
  }

  /**
   * Write the staged fields.
   *
   * An emptied field is sent as `undefined` so the host's merge removes the
   * override and the value re-inherits, rather than pinning an empty string
   * that would read as "configured, to nothing".
   */
  async save(): Promise<void> {
    const { draft } = this.store.getSnapshot()
    if (!isValidBaseURL(draft.baseURL)) return
    this.store.update((state) => {
      state.saving = true
      state.error = undefined
    })
    try {
      const patch = {
        baseURL: draft.baseURL.trim() === '' ? undefined : draft.baseURL.trim(),
        language: draft.language === '' ? undefined : draft.language,
      }
      this.adopt(unwrap(await this.rpc.call('/api', 'web-search-searxng/set', { args: { patch } })))
    } catch (error) {
      this.store.update((state) => {
        state.saving = false
        state.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** Clear the user layer so the section re-inherits composition defaults. */
  async reset(): Promise<void> {
    this.store.update((state) => {
      state.saving = true
      state.error = undefined
    })
    try {
      this.adopt(unwrap(await this.rpc.call('/api', 'web-search-searxng/reset', { args: {} })))
    } catch (error) {
      this.store.update((state) => {
        state.saving = false
        state.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** Fold one host view into state, clearing drafts and transient flags. */
  private adopt(view: SearxngSettingsView): void {
    const stored = { baseURL: view.value.baseURL ?? '', language: view.value.language ?? '' }
    this.store.update((state) => {
      state.status = 'ready'
      state.error = undefined
      state.saving = false
      state.stored = stored
      state.draft = { ...stored }
      state.effectiveBaseURL = view.effectiveBaseURL
      state.baseURLSource = view.baseURLSource
      state.baseURLEnvVar = view.baseURLEnvVar
      state.writable = view.writable
    })
  }
}
