import dns from 'node:dns'
import { isIP } from 'node:net'
import { Agent, ProxyAgent, type Dispatcher } from 'undici'
import type { CustomHost } from './config'

export interface DispatcherOptions {
  proxyUrl?: string
  customHosts?: CustomHost[]
}

export function createSubscriptionDispatcher(options: DispatcherOptions = {}): Dispatcher | undefined {
  const trimmedProxy = options.proxyUrl?.trim()
  if (trimmedProxy) {
    try {
      const parsed = new URL(trimmedProxy)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return new ProxyAgent(trimmedProxy)
      }
    } catch {
      // 忽略无法解析的代理 URL，向下继续尝试 hosts 或直连
    }
  }

  const hostMap = new Map<string, string>()
  for (const item of options.customHosts || []) {
    const host = item?.host?.trim().toLowerCase()
    const ip = item?.ip?.trim()
    if (host && ip && isIP(ip)) {
      hostMap.set(host, ip)
    }
  }

  if (hostMap.size > 0) {
    return new Agent({
      connect: {
        lookup: (hostname, lookupOptions, callback) => {
          let cb = callback
          let opts = lookupOptions
          if (typeof lookupOptions === 'function') {
            cb = lookupOptions
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
        },
      },
    })
  }

  return undefined
}
