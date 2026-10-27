import { parseDocument } from 'yaml'
import type { ClashConfigSummary, SubscriptionInfo } from './types'

const SUBSCRIPTION_FIELDS = new Set(['upload', 'download', 'total', 'expire'])

export class ClashConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClashConfigError'
  }
}

export function parseSubscriptionUserInfo(value: string | null | undefined): SubscriptionInfo | null {
  if (!value?.trim()) return null

  const fields = new Map<string, string>()
  for (const part of value.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    const key = part.slice(0, separator).trim().toLowerCase()
    const fieldValue = part.slice(separator + 1).trim()
    if (SUBSCRIPTION_FIELDS.has(key)) fields.set(key, fieldValue)
  }

  if (fields.size === 0) return null

  return {
    upload: parseNonNegativeInteger(fields.get('upload')),
    download: parseNonNegativeInteger(fields.get('download')),
    total: parseNonNegativeInteger(fields.get('total')),
    expireAt: parseNonNegativeInteger(fields.get('expire')),
  }
}

export function hasSubscriptionData(info: SubscriptionInfo | null | undefined): info is SubscriptionInfo {
  return Boolean(info && [info.upload, info.download, info.total, info.expireAt].some((value) => value !== null))
}

export function parseClashConfig(text: string): ClashConfigSummary {
  if (!text.trim()) throw new ClashConfigError('订阅响应为空')

  let value: unknown
  try {
    const document = parseDocument(text)
    if (document.errors.length > 0) {
      throw new ClashConfigError(document.errors[0].message)
    }
    value = document.toJS()
  } catch (error) {
    if (error instanceof ClashConfigError) throw error
    throw new ClashConfigError(error instanceof Error ? error.message : String(error))
  }

  if (!isRecord(value)) throw new ClashConfigError('订阅内容不是 YAML 对象')

  const knownKeys = [
    'proxies',
    'proxy-groups',
    'proxy-providers',
    'rules',
    'rule-providers',
    'mixed-port',
    'port',
    'socks-port',
    'allow-lan',
    'mode',
    'dns',
    'tun',
  ]
  if (!knownKeys.some((key) => key in value)) {
    throw new ClashConfigError('订阅内容不像 Clash 配置')
  }

  const name = [value['profile-name'], value.name, value['config-name']]
    .find((item): item is string => typeof item === 'string' && item.trim().length > 0)
    ?.trim()

  return {
    name,
    proxyCount: countEntries(value.proxies),
    proxyGroupCount: countEntries(value['proxy-groups']),
    proxyProviderCount: countEntries(value['proxy-providers']),
  }
}

export function buildRequestHeaders(
  userAgent: string,
  customHeaders: Array<{ key: string; value: string }>,
): Record<string, string> {
  const headers = new Map<string, [string, string]>()
  const setHeader = (key: string, value: string) => {
    const normalizedKey = key.trim()
    if (!normalizedKey) return
    headers.set(normalizedKey.toLowerCase(), [normalizedKey, value])
  }

  setHeader('User-Agent', userAgent || 'clash.meta')
  setHeader('Accept', 'text/yaml, application/yaml, text/plain, */*')
  for (const header of customHeaders || []) setHeader(header.key, header.value)

  return Object.fromEntries([...headers.values()])
}

export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/https?:\/\/[^\s)>"']+/gi, '<url>')
}

function parseNonNegativeInteger(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function countEntries(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (isRecord(value)) return Object.keys(value).length
  return 0
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
