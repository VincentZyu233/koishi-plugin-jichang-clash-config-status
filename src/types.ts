export interface SubscriptionInfo {
  upload: number | null
  download: number | null
  total: number | null
  expireAt: number | null
}

export interface ClashConfigSummary {
  name?: string
  proxyCount: number
  proxyGroupCount: number
  proxyProviderCount: number
}

export interface CachedStatus {
  version: 1
  fetchedAt: string
  subscription: SubscriptionInfo | null
  config: ClashConfigSummary
}

export interface StatusSnapshot {
  status: CachedStatus
  source: 'remote' | 'local'
  stale: boolean
  warning?: string
}
