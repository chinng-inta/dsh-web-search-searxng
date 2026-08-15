/**
 * Card dictionaries. The shell ships zh and en; a key missing from a
 * dictionary falls back to the other, so both are kept complete.
 *
 * @module dsh-web-search-searxng/client/locales
 */

/** Dictionary namespace this plugin owns. */
export const SEARXNG_LOCALE_NS = 'web-search-searxng'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  title: 'SearXNG 搜索',
  description: '自建 SearXNG 元搜索实例，为 web_search 提供结果。',
  baseURL: '实例地址',
  'baseURL.placeholder': 'http://searxng.internal:8888',
  'baseURL.fromEnvironment': '当前由环境变量 {env} 提供：{url}',
  'baseURL.unset': '未配置：请填写实例地址，或设置环境变量 {env}。',
  'baseURL.invalid': '请填写 http:// 或 https:// 开头的地址。',
  language: '搜索语言',
  'language.unset': '跟随实例默认',
  'language.all': '全部语言',
  save: '保存',
  discard: '放弃更改',
  reset: '恢复默认',
  dirty: '未保存',
  saving: '保存中…',
  readonly: '当前部署的配置为只读。',
  loading: '加载中…',
  error: '读取配置失败：{message}',
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  title: 'SearXNG search',
  description: 'A self-hosted SearXNG metasearch instance backing web_search.',
  baseURL: 'Instance URL',
  'baseURL.placeholder': 'http://searxng.internal:8888',
  'baseURL.fromEnvironment': 'Currently supplied by {env}: {url}',
  'baseURL.unset': 'Not configured — set an instance URL, or export {env}.',
  'baseURL.invalid': 'Enter an http:// or https:// URL.',
  language: 'Search language',
  'language.unset': 'Instance default',
  'language.all': 'All languages',
  save: 'Save',
  discard: 'Discard',
  reset: 'Reset to defaults',
  dirty: 'unsaved',
  saving: 'Saving…',
  readonly: 'This deployment serves configuration read-only.',
  loading: 'Loading…',
  error: 'Could not read configuration: {message}',
}
