import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from 'koishi'
import type { Config } from './config'
import {
  buildRequestHeaders,
  parseClashConfig,
  parseSubscriptionUserInfo,
  safeError,
} from './parser'
import type { CachedStatus, ClashConfigSummary, StatusSnapshot, SubscriptionInfo } from './types'

export const PLUGIN_DATA_DIR = ['data', 'jichang-clash-config-status'] as const
export const CONFIG_FILE_NAME = 'latest.config.yaml'
export const STATUS_FILE_NAME = 'latest.status.json'

export interface SubscriptionServiceOptions {
  now?: () => number
}

export interface StoragePaths {
  directory: string
  config: string
  status: string
}

export class SubscriptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SubscriptionError'
  }
}

export class SubscriptionService {
  readonly paths: StoragePaths
  private readonly now: () => number
  private memory?: StatusSnapshot
  private memoryLoadedAt = 0
  private refreshPromise?: Promise<StatusSnapshot>

  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
    options: SubscriptionServiceOptions = {},
  ) {
    this.now = options.now || Date.now
    const directory = join(ctx.baseDir, ...PLUGIN_DATA_DIR)
    this.paths = {
      directory,
      config: join(directory, CONFIG_FILE_NAME),
      status: join(directory, STATUS_FILE_NAME),
    }
  }

  async getStatus(force = false): Promise<StatusSnapshot> {
    const ttl = Math.max(1, this.config.cacheTtlMinutes) * 60_000
    if (!force && this.memory && this.now() - this.memoryLoadedAt < ttl) {
      return this.memory
    }
    if (this.refreshPromise) return this.refreshPromise

    const task = (async () => {
      try {
        const snapshot = await this.loadSnapshot()
        this.memory = snapshot
        this.memoryLoadedAt = this.now()
        return snapshot
      } finally {
        this.refreshPromise = undefined
      }
    })()

    this.refreshPromise = task
    return task
  }

  private async loadSnapshot(): Promise<StatusSnapshot> {
    const url = this.config.subscriptionUrl.trim()
    if (!url) return this.readLocalSnapshot()

    try {
      return await this.fetchRemoteSnapshot(url)
    } catch (error) {
      const fallback = await this.readFallbackSnapshot()
      if (!fallback) {
        throw new SubscriptionError('获取机场状态失败，请检查订阅地址、网络和订阅格式', { cause: error })
      }
      this.ctx.logger('jichang-clash-config-status').warn(`订阅刷新失败，回退到本地缓存：${safeError(error)}`)
      return {
        ...fallback,
        stale: true,
        warning: '远程订阅刷新失败，当前展示最近一次本地缓存。',
      }
    }
  }

  private async fetchRemoteSnapshot(url: string): Promise<StatusSnapshot> {
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch (error) {
      throw new SubscriptionError('订阅地址格式无效', { cause: error })
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new SubscriptionError('订阅地址只支持 HTTP 或 HTTPS')
    }

    const response = await this.ctx.http<string>(url, {
      method: 'GET',
      responseType: 'text',
      timeout: Math.max(1, this.config.requestTimeoutSeconds) * 1000,
      headers: buildRequestHeaders(this.config.userAgent, this.config.customHeaders),
    })

    const yaml = typeof response.data === 'string' ? response.data : String(response.data ?? '')
    const summary = parseClashConfig(yaml)
    const subscription = parseSubscriptionUserInfo(response.headers.get('subscription-userinfo'))
    const status: CachedStatus = {
      version: 1,
      fetchedAt: new Date(this.now()).toISOString(),
      subscription,
      config: summary,
    }

    try {
      await this.persist(status, yaml)
    } catch (error) {
      this.ctx.logger('jichang-clash-config-status').warn(`保存机场订阅缓存失败：${safeError(error)}`)
    }

    return { status, source: 'remote', stale: false }
  }

  private async readFallbackSnapshot(): Promise<StatusSnapshot | null> {
    if (this.memory) return this.memory
    try {
      return await this.readLocalSnapshot()
    } catch {
      return null
    }
  }

  private async readLocalSnapshot(): Promise<StatusSnapshot> {
    const cached = await this.readStatusCache()
    if (cached) return { status: cached, source: 'local', stale: false }

    let yaml: string
    let modifiedAt: Date
    try {
      ;[yaml, modifiedAt] = await Promise.all([
        readFile(this.paths.config, 'utf8'),
        stat(this.paths.config).then((value) => value.mtime),
      ])
    } catch (error) {
      throw new SubscriptionError('未配置订阅地址，且本地没有可用的 Clash 配置', { cause: error })
    }

    const summary = parseClashConfig(yaml)
    const status: CachedStatus = {
      version: 1,
      fetchedAt: modifiedAt.toISOString(),
      subscription: null,
      config: summary,
    }
    return { status, source: 'local', stale: false }
  }

  private async readStatusCache(): Promise<CachedStatus | null> {
    let text: string
    try {
      text = await readFile(this.paths.status, 'utf8')
    } catch {
      return null
    }

    try {
      const value: unknown = JSON.parse(text)
      const status = normalizeCachedStatus(value)
      if (!status) throw new Error('状态缓存格式无效')
      return status
    } catch (error) {
      this.ctx.logger('jichang-clash-config-status').warn(`本地状态缓存无效：${safeError(error)}`)
      return null
    }
  }

  private async persist(status: CachedStatus, yaml: string): Promise<void> {
    await mkdir(this.paths.directory, { recursive: true })
    await writeAtomic(this.paths.config, yaml)
    await writeAtomic(this.paths.status, `${JSON.stringify(status, null, 2)}\n`)
  }
}

function normalizeCachedStatus(value: unknown): CachedStatus | null {
  if (!isRecord(value) || value.version !== 1) return null
  if (typeof value.fetchedAt !== 'string' || Number.isNaN(Date.parse(value.fetchedAt))) return null

  const subscription = normalizeSubscriptionInfo(value.subscription)
  const config = normalizeConfigSummary(value.config)
  if (!config) return null
  return { version: 1, fetchedAt: value.fetchedAt, subscription, config }
}

function normalizeSubscriptionInfo(value: unknown): SubscriptionInfo | null {
  if (value === null) return null
  if (!isRecord(value)) return null
  return {
    upload: normalizeNullableInteger(value.upload),
    download: normalizeNullableInteger(value.download),
    total: normalizeNullableInteger(value.total),
    expireAt: normalizeNullableInteger(value.expireAt),
  }
}

function normalizeConfigSummary(value: unknown): ClashConfigSummary | null {
  if (!isRecord(value)) return null
  const proxyCount = normalizeNullableInteger(value.proxyCount)
  const proxyGroupCount = normalizeNullableInteger(value.proxyGroupCount)
  const proxyProviderCount = normalizeNullableInteger(value.proxyProviderCount)
  if (proxyCount === null || proxyGroupCount === null || proxyProviderCount === null) return null
  return {
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : undefined,
    proxyCount,
    proxyGroupCount,
    proxyProviderCount,
  }
}

function normalizeNullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 })
  try {
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export { safeError }
