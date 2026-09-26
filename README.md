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

### From npm

```bash
dsh plugin --profile web add dsh-web-search-searxng
```

### From this repository

```bash
dsh plugin --profile web add github:chinng-inta/dsh-web-search-searxng
```

A git dependency ships no `lib/`, so the package builds itself through its `prepare` script — and
pnpm blocks install scripts until you allow them. The first run therefore fails and prints the exact
key to allow. Add it to your profile's `pnpm-workspace.yaml` and re-run:

```yaml
allowBuilds:
  "dsh-web-search-searxng@https://codeload.github.com/chinng-inta/dsh-web-search-searxng/tar.gz/<commit-sha>": true
```

The key pins a commit, so it changes whenever you install a newer revision. Building from source also
needs the dev toolchain fetched (~20 s versus ~2 s for the registry). Prefer npm unless you are
tracking unreleased changes.

### Either way

The package declares `dsh.bundle`, so a single command also activates it: the bundle patch
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

The configuration is this plugin row's `config`. `baseURL` additionally falls back to `$SEARXNG_URL`
when the row does not set it, so nothing else is needed to get started: export the variable and the
provider is configured.

Every key is declared `volatile`, which since dsh 0.1.7-rc.2 means two things: the harness settings
service may edit it, and an edit updates the running plugin **in place** (no restart). The provider
reads the row per search, so an edit reaches the next search, and clearing `baseURL` falls back to the
environment again rather than stranding the provider on a value it can no longer see. Registration
itself never moves, so provider selection does not flicker when configuration changes.

There are two ways to set it:

- **The Plugins page.** Open this package, then the configure control on its `web-search-searxng`
  row. The page edits the instance URL and the search language, and saves into the active profile's
  patch (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`).
- **A patch row**, in your profile patch or a `--patch` overlay:

```yaml
- id: web-search-searxng
  config:
    baseURL: http://searxng.internal:8888
    language: ja
    categories:
      - general
      - news
```

A patch row replaces the targeted row's **whole** `config`, so restate every key you want. And a row
you set in a `--patch` overlay sits above the profile patch the Plugins page writes to: a save there
still changes the running value, but it is not persisted, and the overlay wins again at the next boot.

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

Upgrading from `0.4.x`: the `web-search-searxng:` section of `$DSH_HOME/settings.yaml` is no longer
read — dsh 0.1.7 removed that document. dsh imports it once into the profile patch of the first
profile that boots (and renames the file to `settings.yaml.imported`); check the result landed where
you expect.

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
| `0.5.0`+ | `0.1.7-rc.2` |
| `0.4.0` | `0.1.2-rc.1` – `0.1.5-rc.3` |
| `0.3.3` – `0.3.x` | `0.1.0-rc.8` – `0.1.1-rc.2` |
| `0.1.x` – `0.3.2` | `0.1.0-rc.6` |

**Every row is mutually exclusive**: nothing here is backward compatible, and nothing older is
forward compatible. Installing the wrong pair does not merely lose this card — it fails the whole
Web UI's plugin load, because the breakages surface as an unanswerable client `require` or an
invalid slot registration ([#1](https://github.com/chinng-inta/dsh-web-search-searxng/issues/1)):

- rc.8 dropped `@deepseek-ai/dsh-client-web-react` from the loader's seed table. Up to `0.3.2`
  this package imported `bindSnapshotSelector` from it. `0.3.3` hands its store to the renderer
  through the slot inject face's `hooks` compartment instead, which is where rc.8 synthesizes
  selector hooks.
- rc.8 turned `settings.plugin.item` from a `list` slot (`id` + `order`) into a `keyed` one
  (`key` = the settings namespace the card edits). `0.3.3` registers the keyed way, which rc.6
  rejects.
- 0.1.2-alpha.1 deleted `@deepseek-ai/dsh-client-runtime` outright. Up to `0.3.x` this package
  took `createSnapshotStore` from it and named it in `dsh.client.inject`; `0.4.0` takes the same
  function from `@deepseek-ai/dsh-client-store` (a seed the frontend now hands the loader) and
  drops the phantom from `inject`, which would otherwise leave the row pending forever.
- 0.1.2-alpha.2 deleted the `settingsNamespace()` and `installSettingsSection()` helpers from
  `@deepseek-ai/dsh-settings`. `0.4.0` uses a bare namespace literal and calls
  `settings.installSection` inside `ctx.inject(['settings'], …)`, which is now the attach/detach
  lifecycle.
- 0.1.7-rc.2 removed the shared `settings.yaml` together with `settings.installSection`: settings
  became each plugin row's own `config`, editable where the schema marks a field `volatile` and
  delivered to `apply` as live references. `0.5.0` marks every key volatile and reads them per search;
  `0.4.0`'s host half calls the removed method, so its settings never attach. The same release deleted the settings page's
  `settings.plugin.item` slot; `0.5.0` registers on the Plugins page's `plugins.row.config`
  (keyed `dsh-web-search-searxng#web-search-searxng`) instead.

`0.3.0` shipped the settings card without its stylesheet — it works, but renders with browser
defaults. Use `0.3.1` or later.

The harness is a developer preview with breaking changes between release candidates, and its
packages publish the active line under the **`next`** dist-tag (`latest` still points at the older
`0.0.1-rc.1`). Pin your harness version.

## License

MIT
