/**
 * SearXNG-backed `WebSearchProvider` for the harness web capability seam.
 *
 * Unlike the shipped DeepSeek provider, one search here is a plain retrieval
 * call against the instance's `/search?format=json` endpoint — no model turn,
 * no generated tokens. The instance does the metasearch and returns structured
 * results, so this provider never scrapes prose.
 *
 * @module dsh-web-search-searxng/provider
 */
import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { SearxngResponse, SearxngResult } from './types.js'

/** Stable id this provider registers under, and the value `web.searchProvider` selects. */
export const SEARXNG_PROVIDER_ID = 'searxng'

/**
 * Resource backstop for one search. This is NOT the model-facing tool-call
 * budget — `@deepseek-ai/dsh-tool-call-timeout-policy` owns that via
 * `searchTimeoutMs` and arms the caller's signal. A deployment should leave
 * this below the tool budget so a slow instance surfaces as a provider
 * timeout rather than a tool timeout.
 */
export const SEARXNG_DEFAULT_TIMEOUT_MS = 10_000

/**
 * Cap on one source's snippet. SearXNG snippets are engine-supplied and
 * occasionally carry a whole lead paragraph; the seam has no snippet bound of
 * its own, so an uncapped provider would let one verbose engine dominate the
 * result budget.
 */
export const SEARXNG_DEFAULT_MAX_SNIPPET_CHARS = 500

/** Time filter values SearXNG accepts on `time_range`. */
export type SearxngTimeRange = 'day' | 'week' | 'month' | 'year'

/** Resolved provider options; the plugin's `apply` fills every default. */
export interface SearxngSearchProviderOptions {
  /**
   * Instance base URL (`/search` is appended). `undefined` or unparseable
   * makes the provider report unavailable instead of failing every search.
   */
  readonly baseURL?: string
  /** `categories=` filter, e.g. `['news']`. Omitted leaves the instance default. */
  readonly categories?: readonly string[]
  /** `engines=` filter, e.g. `['duckduckgo', 'brave']`. */
  readonly engines?: readonly string[]
  /** `language=` filter, e.g. `ja`, `en-US`. */
  readonly language?: string
  /** `time_range=` filter. */
  readonly timeRange?: SearxngTimeRange
  /** `safesearch=` level: 0 off, 1 moderate, 2 strict. */
  readonly safesearch?: 0 | 1 | 2
  /** Resource backstop in milliseconds. */
  readonly timeoutMs: number
  /** Per-source snippet cap in characters. */
  readonly maxSnippetChars: number
  /** Extra headers, e.g. an auth header for an instance behind a proxy. */
  readonly headers?: Readonly<Record<string, string>>
}

/** Parse `baseURL` once so `available()` stays a cheap synchronous check. */
function parseBaseURL(baseURL: string | undefined): URL | undefined {
  if (baseURL === undefined || baseURL.trim().length === 0) return undefined
  let parsed: URL
  try {
    parsed = new URL(baseURL)
  } catch {
    return undefined
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : undefined
}

/** Read one wire field as a non-empty trimmed string, or `undefined`. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/** Truncate a snippet to the configured cap without splitting a surrogate pair. */
function cap(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const cut = value.slice(0, maxChars)
  const last = cut.charCodeAt(cut.length - 1)
  // A high surrogate at the boundary lost its pair; drop it rather than emit U+FFFD.
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/**
 * Map one instance response to the seam's normalized result.
 *
 * Sources are deduplicated by URL because a metasearch merges engines that
 * routinely return the same page. `truncated` is always `false`: the seam owns
 * `maxResults` enforcement, and reporting our own truncation here would make it
 * lie about whose bound cut the list.
 *
 * @param body - the parsed `format=json` response.
 * @param maxSnippetChars - per-source snippet cap.
 * @returns the normalized search outcome.
 */
export function mapSearxngResponse(
  body: SearxngResponse,
  maxSnippetChars: number,
): WebSearchResult {
  const rawResults = Array.isArray(body.results) ? (body.results as readonly SearxngResult[]) : []
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()

  for (const result of rawResults) {
    const url = text(result?.url)
    if (url === undefined || seen.has(url)) continue
    seen.add(url)

    const title = text(result?.title)
    const snippet = text(result?.content)
    const publishedAt = text(result?.publishedDate)
    sources.push({
      url,
      ...(title === undefined ? {} : { title }),
      ...(snippet === undefined ? {} : { snippet: cap(snippet, maxSnippetChars) }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
    })
  }

  // `answers[]` is the only instance-generated text worth surfacing as an
  // answer. Infoboxes are structured entity cards, not an answer to the query,
  // so they stay out rather than being flattened into prose the model would
  // read as one.
  const answers = Array.isArray(body.answers)
    ? (body.answers as readonly unknown[]).map(text).filter((a): a is string => a !== undefined)
    : []

  return {
    ...(answers.length === 0 ? {} : { content: answers.join('\n') }),
    sources,
    truncated: false,
  }
}

/**
 * The SearXNG-backed search provider. Redirects are refused as `WEB_PROVIDER_ERROR`.
 *
 * Options arrive as a THUNK, not a captured object: the settings section is
 * projected per operation so a user-layer edit reaches the NEXT search without
 * a restart, and the seam's provider selection never flickers on a config
 * change (the registration itself is stable — only the values it reads move).
 */
export class SearxngSearchProvider implements WebSearchProvider {
  readonly id = SEARXNG_PROVIDER_ID

  constructor(private readonly options: () => SearxngSearchProviderOptions) {}

  /** Cheap local check: a parseable http(s) base URL. Never touches the network. */
  available(): boolean {
    return parseBaseURL(this.options().baseURL) !== undefined
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // One projection per search: every value below comes from the same snapshot,
    // so a concurrent settings commit cannot split one request across two configs.
    const options = this.options()
    const endpoint = parseBaseURL(options.baseURL)
    // Defensive: the seam consults available() before selecting, so reaching
    // here without an endpoint means a caller bypassed selection.
    if (endpoint === undefined) {
      throw new WebError(
        'SearXNG search has no usable baseURL; set the provider\'s baseURL (or $SEARXNG_URL) to the instance root',
        'WEB_PROVIDER_ERROR',
      )
    }

    const url = new URL('search', endpoint.href.endsWith('/') ? endpoint.href : `${endpoint.href}/`)
    url.searchParams.set('q', request.query)
    url.searchParams.set('format', 'json')
    if (options.categories?.length) {
      url.searchParams.set('categories', options.categories.join(','))
    }
    if (options.engines?.length) {
      url.searchParams.set('engines', options.engines.join(','))
    }
    if (options.language !== undefined) url.searchParams.set('language', options.language)
    if (options.timeRange !== undefined) {
      url.searchParams.set('time_range', options.timeRange)
    }
    if (options.safesearch !== undefined) {
      url.searchParams.set('safesearch', String(options.safesearch))
    }

    const timeout = AbortSignal.timeout(options.timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])

    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        // A self-hosted instance has no reason to redirect a search; following
        // one would send the query to a host the deployment never configured.
        redirect: 'error',
        headers: { accept: 'application/json', ...options.headers },
        signal: combined,
      })
    } catch (error) {
      if (signal?.aborted === true) {
        throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: signal.reason })
      }
      if (timeout.aborted) {
        throw new WebError(
          `SearXNG search timed out after ${options.timeoutMs}ms`,
          'WEB_PROVIDER_ERROR',
          { cause: timeout.reason },
        )
      }
      throw new WebError(`SearXNG search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', {
        cause: error,
      })
    }

    if (!response.ok) {
      // 403 from a public instance is nearly always its bot filter, which no
      // amount of retrying fixes — say so instead of reporting a bare status.
      const hint =
        response.status === 403
          ? ' (a public instance often refuses programmatic access; run your own instance or allow this client)'
          : ''
      throw new WebError(
        `SearXNG search failed with HTTP ${response.status}${hint}`,
        'WEB_PROVIDER_ERROR',
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('json')) {
      // The single most common misconfiguration: `json` missing from the
      // instance's `search.formats`, which answers with the HTML result page.
      throw new WebError(
        `SearXNG returned "${contentType || 'no content-type'}" instead of JSON; add "json" to search.formats in the instance settings.yml`,
        'WEB_PROVIDER_ERROR',
      )
    }

    let body: SearxngResponse
    try {
      body = (await response.json()) as SearxngResponse
    } catch (error) {
      throw new WebError(
        `SearXNG returned an unprocessable response body: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }

    return mapSearxngResponse(body, options.maxSnippetChars)
  }
}
