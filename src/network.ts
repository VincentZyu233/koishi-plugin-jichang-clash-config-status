import dns from 'node:dns'
import { isIP } from 'node:net'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { CustomHost } from './config'

export function createCustomLookup(customHosts?: CustomHost[]) {
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
