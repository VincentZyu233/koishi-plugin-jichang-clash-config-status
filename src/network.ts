import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import { isIP } from 'node:net'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { CustomHost } from './config'

type LookupFunction = (
  hostname: string,
  options: any,
  callback: (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void,
) => void

export function createCustomLookup(customHosts?: CustomHost[]): LookupFunction | undefined {
  const hostMap = new Map<string, string>()
  for (const item of customHosts || []) {
    const host = item?.host?.trim().toLowerCase()
    const ip = item?.ip?.trim()
    if (host && ip && isIP(ip)) {
      hostMap.set(host, ip)
    }
  }

  if (hostMap.size === 0) return undefined

  return (hostname: string, options: any, callback: any) => {
    let cb = callback
    let opts = options
    if (typeof options === 'function') {
      cb = options
      opts = {}
    }
    const targetIp = hostMap.get(hostname.toLowerCase())
    if (targetIp) {
      const family = isIP(targetIp)
      if (opts && (opts as any).all) {
        return cb(null, [{ address: targetIp, family }])
      }
      return cb(null, targetIp, family)
    }
    return dns.lookup(hostname, opts as any, cb)
  }
}

/**
 * 创建带有自定义 DNS lookup 的 HTTP/HTTPS Agent。
 * axios 不支持顶层 `lookup` 选项，必须通过 Agent 注入。
 */
export function createAgents(
  customHosts?: CustomHost[],
  proxyUrl?: string,
): { httpAgent?: http.Agent; httpsAgent?: https.Agent | HttpsProxyAgent<string> } {
  const lookup = createCustomLookup(customHosts)
  const trimmedProxy = proxyUrl?.trim()

  // 有代理时，使用 HttpsProxyAgent（它支持 lookup 选项）
  if (trimmedProxy) {
    try {
      const parsed = new URL(trimmedProxy)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        // HttpsProxyAgent 构造函数的第二个参数会透传给 net.connect / tls.connect
        // 但 lookup 需要通过不同的方式注入
        // 使用带 lookup 的自定义 Agent 来覆盖 DNS
        const httpsAgent = lookup
          ? new HttpsProxyAgent(trimmedProxy, { lookup: lookup as any })
          : new HttpsProxyAgent(trimmedProxy)
        const httpAgent = lookup
          ? new http.Agent({ lookup: lookup as any })
          : undefined
        return { httpAgent, httpsAgent }
      }
    } catch {
      // 忽略格式非法的代理地址
    }
  }

  // 无代理时，如果有 customHosts 就创建带 lookup 的 Agent
  if (lookup) {
    return {
      httpAgent: new http.Agent({ lookup: lookup as any }),
      httpsAgent: new https.Agent({ lookup: lookup as any }),
    }
  }

  return {}
}

/** @deprecated 使用 createAgents 替代 */
export function createProxyAgent(proxyUrl?: string): HttpsProxyAgent<string> | undefined {
  const trimmed = proxyUrl?.trim()
  if (!trimmed) return undefined
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return new HttpsProxyAgent(trimmed)
    }
  } catch {
    // 忽略格式非法的代理地址
  }
  return undefined
}
