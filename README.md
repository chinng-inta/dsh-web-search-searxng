# dsh-web-search-searxng

A [SearXNG](https://docs.searxng.org/)-backed `WebSearchProvider` for the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web capability seam (`ctx.web`).

SearXNG is a self-hosted metasearch engine. One search here is a plain retrieval call against the
instance's `/search?format=json` endpoint, so unlike the shipped DeepSeek provider it needs **no API
key** and costs **no model turn** — the shipped provider issues a full Messages request with the
native `web_search` server tool, paying latency and generated tokens for every search.

This is an **implementation** package: it registers a provider into `ctx.web` and does **not**
register a model-facing tool. `@deepseek-ai/dsh-tool-web` owns `web_search`, its schema, its prompt
guidance, and the result card. Installing this package makes that existing tool work against your
own instance.

## Install

```bash
dsh plugin --profile web add dsh-web-search-searxng
```

The package declares `dsh.bundle`, so this single command also activates it: the bundle patch
inserts the provider row and selects it on the `web` row. Point it at your instance and restart:

```bash
export SEARXNG_URL=http://searxng.internal:8888
```

Verify the composition before booting:

```bash
dsh --profile web --dump-config | grep -A3 'id: web'
```

### Your instance must serve JSON

SearXNG does not enable the JSON API by default. In the instance's `settings.yml`:

```yaml
search:
  formats:
    - html
    - json
```

Without it the endpoint answers with the HTML result page, and this provider fails with a message
naming the fix rather than a parse error.

A public instance is a poor backend: most refuse programmatic access (HTTP 403 from a bot filter)
or rate-limit aggressively. Run your own.

## Configuration

The plugin owns the `web-search-searxng` settings namespace, so its section resolves in the harness's
own layering:

```
schema defaults  →  the plugin row's `config` (composition base)  →  the user layer in the settings document
```

`baseURL` additionally falls back to `$SEARXNG_URL` when no layer sets it. Nothing else is needed to
get started: export the variable and the provider is configured.

The section is projected **per search**, so an edit to the settings document reaches the next search
without a restart — and clearing `baseURL` falls back to the environment again rather than stranding
the provider on a value it can no longer see. Registration itself never moves, so provider selection
does not flicker when configuration changes.

A deployment without a settings provider mounted keeps working: the source falls back to the
composition entry, exactly as composed.

All keys are optional.

| Key | Default | Meaning |
|---|---|---|
| `baseURL` | `$SEARXNG_URL` | Instance root; `/search` is appended. Missing or non-http(s) makes the provider report unavailable rather than fail every search. |
| `categories` | instance default | `categories=` filter, e.g. `['news']`. |
| `engines` | instance default | `engines=` filter, e.g. `['duckduckgo', 'brave']`. |
| `language` | instance default | `language=` filter, e.g. `ja`, `en-US`. |
| `timeRange` | unset | `time_range=` filter: `day` / `week` / `month` / `year`. |
| `safesearch` | instance default | `safesearch=`: `0` off, `1` moderate, `2` strict. |
| `timeoutMs` | `10000` | Resource backstop for one search. |
| `maxSnippetChars` | `500` | Per-source snippet cap. |
| `headers` | none | Extra request headers, e.g. for an instance behind an authenticating proxy. |

As the plugin row's composition base:

```yaml
- id: web-search-searxng
  name: 'dsh-web-search-searxng'
  config:
    baseURL: http://searxng.internal:8888
    language: ja
    categories:
      - general
      - news
```

…or as the user layer in the harness settings document (`$DSH_HOME/settings.yaml` by default),
which wins over the row above and is what a configuration surface writes:

```yaml
web-search-searxng:
  language: ja
  maxSnippetChars: 300
```

Every search-shaping knob is a **deployment setting, not a model argument**. The seam's
`WebSearchRequest` is deliberately just `query` + `maxResults`; provider-neutral controls (recency,
domain filters, search depth) are named deferred work upstream. Keeping them in config is what makes
this provider substitutable for the shipped ones.

`timeoutMs` is a resource backstop, not the model-facing tool-call budget —
`@deepseek-ai/dsh-tool-call-timeout-policy` owns that via `tool-web`'s `searchTimeoutMs`. Leave this
below the tool budget so a slow instance surfaces as a provider failure rather than a tool timeout.

## Provider selection

The bundle patch sets `web.searchProvider: searxng`. This is required, not opinionated.

The seam auto-selects only when exactly **one** registered provider is usable, and
`@deepseek-ai/dsh-web-search-deepseek` reports usable whenever a credential *resolver* exists — which
its own `apply()` always supplies — so it answers `available() === true` on a stock composition even
with no key configured. Registering a second provider without naming one would make every search fail
with `WEB_PROVIDER_AMBIGUOUS`.

Bundle layers apply before your profile's `cordis.patch.yml`, the home patch, and any `--patch`
overlay, so you can always override the choice. But note that a patch replaces the targeted row's
**whole** `config`: if you patch the `web` row yourself for anything else, restate
`searchProvider: searxng` there too.

## Mapping

| SearXNG | Seam |
|---|---|
| `results[].url` | `sources[].url` (required; results without one are dropped) |
| `results[].title` | `sources[].title` |
| `results[].content` | `sources[].snippet`, capped at `maxSnippetChars` |
| `results[].publishedDate` | `sources[].publishedAt` |
| `answers[]` | `content`, newline-joined; omitted when empty |

Sources are deduplicated by URL, because a metasearch merges engines that routinely return the same
page. Blank strings are treated as absent rather than emitted as empty fields — the seam's optional
fields exist so an adapter never has to invent them.

`truncated` is always `false` from this provider: the seam owns `maxResults` enforcement, and
reporting our own truncation would misattribute whose bound cut the list.

## Errors

Failures are `WebError`s the tool layer turns into a readable tool result.

| Situation | Code |
|---|---|
| Caller cancelled | `WEB_ABORTED` |
| `timeoutMs` elapsed | `WEB_PROVIDER_ERROR` |
| Non-2xx from the instance (403 carries a bot-filter hint) | `WEB_PROVIDER_ERROR` |
| Response was not JSON (usually `formats` misconfiguration) | `WEB_PROVIDER_ERROR` |
| Unparseable body | `WEB_PROVIDER_ERROR` |

`available()` is a cheap synchronous check — a parseable `http(s)` base URL — as the seam requires;
it never touches the network.

Redirects are refused (`redirect: 'error'`). A self-hosted instance has no reason to redirect a
search, and following one would send the query to a host the deployment never configured.

## Known limitations

- **`maxResults` is not pushed down.** SearXNG exposes no result-count parameter, so the instance
  returns its full first page and the seam truncates. This bounds tokens, not the instance's work.
- **`publishedDate` is usually absent.** General web engines rarely date results; news engines
  usually do. Filter with `categories: ['news']` if you need dates.
- **Infoboxes are not surfaced.** They are structured entity cards rather than an answer to the
  query, so flattening them into `content` would present them as one.
- **No per-engine failure reporting.** SearXNG reports `unresponsive_engines[]` on partial failures;
  the seam's result shape has nowhere to put it, so a degraded search looks like a thin one.

## Compatibility

| This package | DeepSeek Harness |
|---|---|
| `0.3.x` | `0.1.0-rc.6` |
| `0.2.x` | `0.1.0-rc.6` |
| `0.1.x` | `0.1.0-rc.6` |

`0.3.0` shipped the settings card without its stylesheet — it works, but renders with browser
defaults. Use `0.3.1` or later.

The harness is a developer preview with breaking changes between release candidates, and its
packages publish the active line under the **`next`** dist-tag (`latest` still points at the older
`0.0.1-rc.1`). Pin your harness version.

## License

MIT
