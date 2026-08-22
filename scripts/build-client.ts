/**
 * Client bundle build: emits the closure-factory artifact the dsh web loader
 * consumes —
 *
 *   window.__ModuleLoader__.load({ id: '<package>', factory: (require) => { … } })
 *
 * Externals resolve through the loader's module table; everything else inlines.
 *
 * The table is FROZEN. A value import of any other `@deepseek-ai/*` module
 * reaches the browser as a `require(...)` the loader cannot answer, and the
 * failure is not local: the shell reports
 *
 *   "bundle … loaded without registering <id> via __ModuleLoader__.load"
 *
 * and drops EVERY plugin's client half — the user cannot open the Web UI at
 * all. Two shipped plugins have broken this exact way (`@a9i5k4/dsh-auto-memory`
 * 0.1.9–0.1.11 registering under a stale id, `dsh-llm-fallbacks` ≥ alpha.3
 * value-importing schemastery), so the assertions at the bottom are not
 * ceremony: they are the only thing standing between a typo'd import and an
 * unusable UI.
 *
 * @module scripts/build-client
 */
import { build } from 'tsdown'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ID = 'dsh-web-search-searxng'
const ENTRY = 'src/client/index.ts'
const OUT_DIR = 'lib/client'
const OUT_FILE = 'index.js'

/**
 * What the browser loader can actually answer at runtime.
 *
 * The first seven are the seed table the web frontend hands the loader as
 * `staticModules`; the last resolves through the registered factory of a
 * loaded plugin. Do not trust this comment — re-derive the seed list from the
 * image you are targeting:
 *
 *   docker run --rm --entrypoint sh <image> -c 'grep -ohE "return\{react:[^}]*\}" \
 *     $(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-*.js'
 *
 * This is rc.8's table, a strict subset of rc.6's: rc.8 removed
 * `dsh-client-web-react`, `dsh-client-ui-attachment` and
 * `dsh-client-schema-form`. Entries kept here "just in case" are not free. The
 * assertion at the bottom of this file compares the bundle against THIS list
 * and nothing else, so a name listed here that the shell does not seed passes
 * the build and fails the user's Web UI instead — which is exactly how issue #1
 * shipped.
 */
const CLIENT_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

await build({
  entry: [ENTRY],
  outDir: OUT_DIR,
  format: 'cjs',
  platform: 'browser',
  external: [...CLIENT_EXTERNALS],
  dts: false,
  clean: false,
  sourcemap: false,
  minify: false,
  outputOptions: { entryFileNames: OUT_FILE },
})

// ── wrap the CJS output in the loader's factory closure ──────────────────────
const outPath = resolve(OUT_DIR, OUT_FILE)
const body = readFileSync(outPath, 'utf8')

const wrapped = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${body}
\t\treturn module.exports;
\t}
});
`
writeFileSync(outPath, wrapped)

// ── bundle contract assertions ───────────────────────────────────────────────
const emitted = readFileSync(outPath, 'utf8')

if (!emitted.startsWith('window.__ModuleLoader__.load({')) {
  throw new Error('client bundle: missing the loader registration preamble')
}

// The id the loader waits for is the PACKAGE name. Registering under anything
// else is the auto-memory failure: the loader never sees the module land.
if (!emitted.includes(`id: ${JSON.stringify(ID)}`)) {
  throw new Error(`client bundle: must register under the package name ${ID}`)
}

const required = [...emitted.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1]!)
const foreign = [...new Set(required)].filter((spec) => !CLIENT_EXTERNALS.includes(spec))
if (foreign.length > 0) {
  throw new Error(
    `client bundle: require() of module(s) outside the loader table: ${foreign.join(', ')}\n` +
      'Import them type-only, or inline them. A runtime require the loader cannot ' +
      'answer takes the whole Web UI down, not just this card.',
  )
}

console.log(
  `client bundle: ${outPath} (${(emitted.length / 1024).toFixed(1)} kB), ` +
    `externals used: ${[...new Set(required)].sort().join(', ') || '(none)'}`,
)
