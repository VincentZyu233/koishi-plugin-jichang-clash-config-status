import type { StatusSnapshot, SubscriptionInfo } from '../types'
import { hasSubscriptionData } from '../parser'
import { formatBytes, formatDateTime } from '../utils/format'
import type { StatusFormatter } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

export function formatTextStatus(snapshot: StatusSnapshot, now = Date.now()): string {
  const { status } = snapshot
  const lines = ['🌐 机场订阅状态', '📊 订阅详情']

  if (status.config.name) lines.push(`📝 配置：${status.config.name}`)

  if (hasSubscriptionData(status.subscription)) {
    appendSubscription(lines, status.subscription, now)
  } else {
    lines.push('⚠️ 机场未返回有效的 subscription-userinfo，无法获取流量和到期信息。')
  }

  lines.push(`🧩 节点：${status.config.proxyCount} 个｜策略组：${status.config.proxyGroupCount} 个`)
  if (status.config.proxyProviderCount > 0) {
    lines.push(`🗂️ 代理提供者：${status.config.proxyProviderCount} 个`)
  }
  lines.push(`🕒 最近更新：${formatDateTime(status.fetchedAt)}`)
  if (snapshot.source === 'local') lines.push('ℹ️ 数据来源：本地配置文件')
  if (snapshot.stale) lines.push(`⚠️ ${snapshot.warning || '当前展示本地缓存，数据可能已过期。'}`)
  lines.push('✨')

  return lines.join('\n')
}

function appendSubscription(lines: string[], info: SubscriptionInfo, now: number): void {
  const upload = info.upload
  const download = info.download
  const total = info.total
  const used = upload !== null && download !== null ? upload + download : null

  if (used !== null && total !== null && total > 0) {
    const percent = (used / total) * 100
    lines.push(`📦 流量：${formatBytes(used)} / ${formatBytes(total)}（${percent.toFixed(2)}%）`)
    lines.push(`🟢 剩余流量：${formatBytes(Math.max(total - used, 0))}`)
  } else if (used !== null) {
    lines.push(`📦 已用流量：${formatBytes(used)}`)
    lines.push('📦 总流量：未知或未限制')
  } else if (total !== null) {
    lines.push(`📦 总流量：${total === 0 ? '未知或未限制' : formatBytes(total)}`)
  }

  if (upload !== null) lines.push(`📥 上传：${formatBytes(upload)}`)
  if (download !== null) lines.push(`📤 下载：${formatBytes(download)}`)

  if (info.expireAt === null || info.expireAt === 0) {
    lines.push('📅 到期时间：未知或永不过期')
  } else {
    const expireMs = info.expireAt * 1000
    lines.push(`📅 到期时间：${formatDateTime(expireMs)}`)
    if (expireMs <= now) {
      lines.push('⚠️ 订阅已过期')
    } else {
      lines.push(`⏳ 剩余天数：${Math.ceil((expireMs - now) / DAY_MS)} 天`)
    }
  }
}

export const textFormatter: StatusFormatter = {
  id: 'text',
  label: 'text',
  failureMessage: 'text 状态消息生成失败',
  render: (_ctx, snapshot) => formatTextStatus(snapshot),
}
