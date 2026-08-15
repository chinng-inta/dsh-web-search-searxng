import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SearxngSearchProvider, mapSearxngResponse } from '../lib/provider.js'

const OPTIONS = { timeoutMs: 10_000, maxSnippetChars: 500 }

/** Build a provider over a fixed options snapshot. */
const provider = (options) => new SearxngSearchProvider(() => ({ ...OPTIONS, ...options }))

describe('available()', () => {
  it('accepts an http(s) base URL', () => {
    assert.equal(provider({ baseURL: 'http://s:8888' }).available(), true)
    assert.equal(provider({ baseURL: 'https://s' }).available(), true)
  })

  it('reports unavailable rather than throwing on a missing or unusable base URL', () => {
    for (const baseURL of [undefined, '', '   ', 'not a url', 'ftp://s', 'file:///etc/passwd']) {
      assert.equal(provider({ baseURL }).available(), false, String(baseURL))
    }
  })

  it('reads the options thunk on every call, so a settings edit takes effect live', () => {
    // The settings section is projected per operation; capturing it at
    // construction would strand the provider on the boot-time value.
    let baseURL
    const live = new SearxngSearchProvider(() => ({ ...OPTIONS, baseURL }))

    assert.equal(live.available(), false)
    baseURL = 'http://configured-later:8888'
    assert.equal(live.available(), true)
    baseURL = undefined
    assert.equal(live.available(), false)
  })
})

describe('mapSearxngResponse()', () => {
  it('maps url/title/content/publishedDate onto the seam source shape', () => {
    const result = mapSearxngResponse(
      {
        results: [
          {
            url: 'https://example.com/a',
            title: 'A',
            content: 'snippet a',
            publishedDate: '2026-08-14T00:00:00Z',
          },
        ],
      },
      500,
    )
    assert.deepEqual(result.sources, [
      {
        url: 'https://example.com/a',
        title: 'A',
        snippet: 'snippet a',
        publishedAt: '2026-08-14T00:00:00Z',
      },
    ])
    assert.equal(result.truncated, false)
    assert.equal(result.content, undefined)
  })

  it('omits absent optional fields instead of inventing them', () => {
    const result = mapSearxngResponse({ results: [{ url: 'https://example.com/a' }] }, 500)
    assert.deepEqual(result.sources, [{ url: 'https://example.com/a' }])
  })

  it('treats blank strings as absent', () => {
    const result = mapSearxngResponse(
      { results: [{ url: 'https://example.com/a', title: '   ', content: '', publishedDate: '' }] },
      500,
    )
    assert.deepEqual(result.sources, [{ url: 'https://example.com/a' }])
  })

  it('drops results with no usable url', () => {
    const result = mapSearxngResponse(
      { results: [{ title: 'no url' }, { url: 42 }, { url: 'https://example.com/a' }] },
      500,
    )
    assert.deepEqual(
      result.sources.map((s) => s.url),
      ['https://example.com/a'],
    )
  })

  it('deduplicates by url, keeping the first occurrence', () => {
    const result = mapSearxngResponse(
      {
        results: [
          { url: 'https://example.com/a', title: 'first' },
          { url: 'https://example.com/a', title: 'second' },
        ],
      },
      500,
    )
    assert.equal(result.sources.length, 1)
    assert.equal(result.sources[0].title, 'first')
  })

  it('caps snippets without splitting a surrogate pair', () => {
    const plain = mapSearxngResponse({ results: [{ url: 'https://e/a', content: 'x'.repeat(20) }] }, 10)
    assert.equal(plain.sources[0].snippet, 'x'.repeat(10))

    // '😀' is a surrogate pair; a cap landing mid-pair must drop it whole.
    const emoji = mapSearxngResponse({ results: [{ url: 'https://e/a', content: `xxx😀yyy` }] }, 4)
    assert.equal(emoji.sources[0].snippet, 'xxx')
  })

  it('surfaces answers[] as content and leaves it absent when empty', () => {
    assert.equal(
      mapSearxngResponse({ results: [], answers: ['42', '  ', 'also 42'] }, 500).content,
      '42\nalso 42',
    )
    assert.equal(mapSearxngResponse({ results: [], answers: [] }, 500).content, undefined)
  })

  it('never reports truncation — the seam owns maxResults', () => {
    const results = Array.from({ length: 50 }, (_, i) => ({ url: `https://example.com/${i}` }))
    const result = mapSearxngResponse({ results }, 500)
    assert.equal(result.sources.length, 50)
    assert.equal(result.truncated, false)
  })

  it('tolerates a body with no results array', () => {
    assert.deepEqual(mapSearxngResponse({}, 500), { sources: [], truncated: false })
    assert.deepEqual(mapSearxngResponse({ results: 'nope' }, 500), { sources: [], truncated: false })
  })
})
