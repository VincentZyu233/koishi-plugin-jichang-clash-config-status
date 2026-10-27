import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { h, type Bot, type Context } from 'koishi'
import type { Config } from '../src/config'
import { buildCommandReply } from '../src/command'
import { formatErrorReply } from '../src/formats/error'
import { resolveStatusFormatters, STATUS_FORMATTERS } from '../src/formats'
import { formatTextStatus } from '../src/formats/text'
import { renderTakumiStatusPng } from '../src/formats/takumi'
import {
  buildRequestHeaders,
  hasSubscriptionData,
  parseClashConfig,
  parseSubscriptionUserInfo,
} from '../src/parser'
import { isFiveFieldCron, matchesPushTarget, registerPushSchedules } from '../src/schedule'
import { SubscriptionService } from '../src/subscription'
import { dispatchStatusOutputs, resolveOutputFormats } from '../src/output'
import type { StatusSnapshot } from '../src/types'
import { formatBytes } from '../src/utils/format'
import * as legacyFormat from '../src/format'
import * as legacyTakumi from '../src/takumi'

const temporaryDirectories: string[] = []
const yaml = `
profile-name: 测试机场
proxies:
  - name: 香港 01
  - name: 日本 01
proxy-groups:
  - name: 自动选择
proxy-providers:
  provider-a:
    type: http
rules:
  - MATCH,DIRECT
`.trim()

after(async () => {
  const root = tmpdir()
  for (const directory of temporaryDirectories) {
    if (directory.startsWith(root)) await rm(directory, { recursive: true, force: true })
  }
})

test('解析 subscription-userinfo 的正常和畸形字段', () => {
  assert.deepEqual(
    parseSubscriptionUserInfo('upload=1024; download=2048; total=4096; expire=1700000000'),
    { upload: 1024, download: 2048, total: 4096, expireAt: 1700000000 },
  )
  assert.deepEqual(
    parseSubscriptionUserInfo('upload=-1; download=oops; total=0; expire=0'),
    { upload: null, download: null, total: 0, expireAt: 0 },
  )
  assert.equal(parseSubscriptionUserInfo('unknown=1'), null)
  assert.equal(parseSubscriptionUserInfo(undefined), null)
  assert.equal(hasSubscriptionData(parseSubscriptionUserInfo('total=0')), true)
})

test('校验 Clash YAML 并统计配置摘要', () => {
  assert.deepEqual(parseClashConfig(yaml), {
    name: '测试机场',
    proxyCount: 2,
    proxyGroupCount: 1,
    proxyProviderCount: 1,
  })
  assert.throws(() => parseClashConfig('<html>login</html>'), /不像 Clash 配置|YAML/)
})

test('默认请求头和自定义请求头覆盖规则', () => {
  const headers = buildRequestHeaders('clash.meta', [
    { key: 'user-agent', value: 'custom-client/1.0' },
    { key: 'X-Token', value: 'secret' },
  ])
  assert.equal(headers['user-agent'], 'custom-client/1.0')
  assert.equal(headers['X-Token'], 'secret')
  assert.equal(headers.Accept.includes('text/yaml'), true)
})

test('格式化流量、到期时间和缺失状态头提示', () => {
  const now = Date.UTC(2026, 9, 27, 0, 0)
  const snapshot: StatusSnapshot = {
    source: 'remote',
    stale: false,
    status: {
      version: 1,
      fetchedAt: new Date(now).toISOString(),
      subscription: {
        upload: 1024,
        download: 2048,
        total: 10 * 1024,
        expireAt: Math.floor(now / 1000) + 3 * 24 * 60 * 60,
      },
      config: { name: '测试机场', proxyCount: 2, proxyGroupCount: 1, proxyProviderCount: 0 },
    },
  }

  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1024), '1.00 KiB')
  const message = formatTextStatus(snapshot, now)
  assert.match(message, /^🌐 机场订阅状态/)
  assert.match(message, /📊 订阅详情/)
  assert.match(message, /剩余流量/)
  assert.match(message, /剩余天数：3 天/)
  assert.match(message, /✨$/)

  snapshot.status.subscription = null
  assert.match(formatTextStatus(snapshot, now), /未返回有效的 subscription-userinfo/)
})

test('失败消息固定包含开头、中间和结尾 emoji', () => {
  const message = formatErrorReply('获取机场状态失败')
  assert.match(message, /^❌ 获取机场状态失败/)
  assert.match(message, /💡 请检查订阅地址、网络和后台日志。/)
  assert.match(message, /⚠️$/)
})

test('指令回复按 enableQuote 决定是否引用触发消息', () => {
  const quoted = buildCommandReply({ messageId: 'message-1' }, { enableQuote: true }, '状态正常')
  assert.equal(Array.isArray(quoted), true)
  assert.equal(quoted[0].type, 'quote')
  assert.deepEqual(quoted[0].attrs, { id: 'message-1' })
  assert.equal(quoted[1].type, 'text')

  assert.equal(buildCommandReply({ messageId: 'message-1' }, { enableQuote: false }, '状态正常'), '状态正常')
  assert.equal(buildCommandReply({}, { enableQuote: true }, '状态正常'), '状态正常')

  const image = h.image(Buffer.from([1, 2, 3]), 'image/png')
  const quotedImage = buildCommandReply({ messageId: 'message-2' }, { enableQuote: true }, image)
  assert.equal(Array.isArray(quotedImage), true)
  assert.equal(quotedImage[0].type, 'quote')
  assert.equal(quotedImage[1].type, 'img')
})

test('输出格式默认两个，并固定为 text、takumi 顺序', () => {
  assert.deepEqual(resolveOutputFormats(undefined), ['text', 'takumi'])
  assert.deepEqual(resolveOutputFormats(['takumi', 'text']), ['text', 'takumi'])
  assert.throws(() => resolveOutputFormats([]), /没有勾选任何输出格式/)
  assert.deepEqual(STATUS_FORMATTERS.map((formatter) => formatter.id), ['text', 'takumi'])
  assert.deepEqual(resolveStatusFormatters(['takumi']).map((formatter) => formatter.id), ['takumi'])
})

test('旧 format 与 takumi 兼容出口仍可导入', () => {
  assert.equal(legacyFormat.formatStatusMessage, legacyFormat.formatTextStatus)
  assert.equal(legacyFormat.formatErrorReply, formatErrorReply)
  assert.equal(typeof legacyTakumi.renderTakumiStatusPng, 'function')
})

test('多格式调度按 text、takumi 分别发送', async () => {
  const sent: any[] = []
  const config = createConfig('')
  config.outputFormats = ['takumi', 'text']
  const ctx = createContext(findAppBaseDir(), async () => {
    throw new Error('多格式调度不应访问网络')
  })
  const logger = createLogger()

  await dispatchStatusOutputs(ctx, config, createStatusSnapshot(), [{
    label: 'test',
    send: async (content) => { sent.push(content) },
  }], logger)

  assert.equal(sent.length, 2)
  assert.equal(typeof sent[0], 'string')
  assert.match(sent[0], /^🌐 机场订阅状态/)
  assert.equal(sent[1].type, 'img')
})

test('空格式配置记录日志并发送明确提示', async () => {
  const sent: any[] = []
  const errors: string[] = []
  const config = createConfig('')
  config.outputFormats = []
  const logger = createLogger({ error: (message: string) => { errors.push(message) } })

  await dispatchStatusOutputs(createContext(findAppBaseDir(), async () => {
    throw new Error('不应访问网络')
  }), config, createStatusSnapshot(), [{
    label: 'test',
    send: async (content) => { sent.push(content) },
  }], logger)

  assert.equal(errors.length, 1)
  assert.match(errors[0], /没有勾选任何输出格式/)
  assert.equal(sent.length, 1)
  assert.match(sent[0], /没有勾选任何输出格式/)
})

test('Takumi 失败时保留 text 并额外发送错误提示', async () => {
  const directory = await createTemporaryDirectory()
  const sent: any[] = []
  const config = createConfig('')
  config.outputFormats = ['text', 'takumi']

  await dispatchStatusOutputs(createContext(directory, async () => {
    throw new Error('font download failed')
  }), config, createStatusSnapshot(), [{
    label: 'test',
    send: async (content) => { sent.push(content) },
  }], createLogger())

  assert.equal(sent.length, 2)
  assert.match(sent[0], /^🌐 机场订阅状态/)
  assert.match(sent[1], /Takumi 状态图生成失败/)
})

test('Takumi 能生成 Clash 猫猫深色状态卡 PNG', async () => {
  const ctx = createContext(findAppBaseDir(), async () => {
    throw new Error('字体已存在，不应下载')
  })
  const png = await renderTakumiStatusPng(ctx, createStatusSnapshot())

  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.ok(png.readUInt32BE(16) >= 900)
  assert.ok(png.readUInt32BE(20) >= 680)
  assert.equal(existsSync(join(process.cwd(), 'assets', 'clash-cat.png')), true)
})

test('远程成功时写入缓存，并在五分钟内复用内存状态', async () => {
  const directory = await createTemporaryDirectory()
  let calls = 0
  let now = Date.UTC(2026, 9, 27, 0, 0)
  const http = async () => {
    calls += 1
    return createResponse(200, yaml, 'upload=10; download=20; total=100; expire=1800000000')
  }
  const service = new SubscriptionService(createContext(directory, http), createConfig('https://example.com/sub'), {
    now: () => now,
  })

  const first = await service.getStatus()
  const second = await service.getStatus()
  assert.equal(first.source, 'remote')
  assert.equal(second, first)
  assert.equal(calls, 1)
  assert.equal((await readFile(service.paths.config, 'utf8')).trim(), yaml)

  const cached = JSON.parse(await readFile(service.paths.status, 'utf8'))
  assert.equal(cached.subscription.total, 100)

  now += 6 * 60_000
  await service.getStatus()
  assert.equal(calls, 2)
})

test('远程失败时回退最近缓存并标记陈旧', async () => {
  const directory = await createTemporaryDirectory()
  let now = Date.UTC(2026, 9, 27, 0, 0)
  let shouldFail = false
  const http = async () => {
    if (shouldFail) throw new Error('fetch https://secret.example/sub?token=abc failed')
    return createResponse(200, yaml, 'upload=10; download=20; total=100; expire=1800000000')
  }
  const service = new SubscriptionService(createContext(directory, http), createConfig('https://example.com/sub'), {
    now: () => now,
  })

  await service.getStatus()
  now += 6 * 60_000
  shouldFail = true
  const stale = await service.getStatus()
  assert.equal(stale.stale, true)
  assert.match(stale.warning || '', /最近一次本地缓存/)
})

test('未配置 URL 时读取本地 Clash 配置文件', async () => {
  const directory = await createTemporaryDirectory()
  const service = new SubscriptionService(createContext(directory, async () => {
    throw new Error('不应访问网络')
  }), createConfig(''))
  await mkdir(service.paths.directory, { recursive: true })
  await writeFile(service.paths.config, yaml, 'utf8')

  const snapshot = await service.getStatus()
  assert.equal(snapshot.source, 'local')
  assert.equal(snapshot.status.config.proxyCount, 2)
  assert.equal(snapshot.status.subscription, null)
})

test('无效远程 YAML 不会覆盖已有配置', async () => {
  const directory = await createTemporaryDirectory()
  const service = new SubscriptionService(createContext(directory, async () => createResponse(200, '<html>bad</html>')), createConfig('https://example.com/sub'))
  await assert.rejects(() => service.getStatus(), /获取机场状态失败/)
  await assert.rejects(() => readFile(service.paths.config, 'utf8'))
})

test('并发刷新只发出一次请求', async () => {
  const directory = await createTemporaryDirectory()
  let calls = 0
  let resolveRequest: (() => void) | undefined
  const http = async () => {
    calls += 1
    await new Promise<void>((resolve) => { resolveRequest = resolve })
    return createResponse(200, yaml)
  }
  const service = new SubscriptionService(createContext(directory, http), createConfig('https://example.com/sub'))

  const first = service.getStatus()
  const second = service.getStatus()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls, 1)
  resolveRequest?.()
  await Promise.all([first, second])
})

test('推送目标匹配与 Cron 格式校验', () => {
  const bot = { platform: 'OneBot', selfId: '2609792017' } as Bot
  assert.equal(matchesPushTarget(bot, { platform: 'onebot', selfId: '' }), true)
  assert.equal(matchesPushTarget(bot, { platform: 'onebot', selfId: '2609792017' }), true)
  assert.equal(matchesPushTarget(bot, { platform: 'onebot', selfId: 'other' }), false)
  assert.equal(matchesPushTarget(bot, { platform: 'qq', selfId: '' }), false)
  assert.equal(isFiveFieldCron('30 7 * * *'), true)
  assert.equal(isFiveFieldCron('30 7 * *'), false)
})

test('Cron 只为启用行注册，并向所有匹配 Bot 推送', async () => {
  const scheduled: Array<{ expression: string; callback: () => void | Promise<void> }> = []
  const sent: Array<{ channelId: string; message: string; selfId: string }> = []
  const makeBot = (platform: string, selfId: string) => ({
    platform,
    selfId,
    sendMessage: async (channelId: string, message: string) => {
      sent.push({ channelId, message, selfId })
    },
  })
  const ctx = {
    bots: [makeBot('onebot', '1'), makeBot('onebot', '2'), makeBot('qq', '3')],
    inject(_services: string[], callback: (context: any) => void) { callback(this) },
    cron(expression: string, callback: () => void | Promise<void>) {
      scheduled.push({ expression, callback })
      return () => undefined
    },
    on() {},
  } as unknown as Context
  const config = createConfig('')
  config.pushTargets = [
    { enabled: true, note: '全部 onebot', platform: 'onebot', selfId: '', channelId: '10001', cron: '30 7 * * *' },
    { enabled: false, note: '关闭项', platform: 'qq', selfId: '', channelId: '10002', cron: '30 7 * * *' },
    { enabled: true, note: '空频道', platform: 'qq', selfId: '', channelId: '', cron: '30 7 * * *' },
    { enabled: true, note: '错误 Cron', platform: 'qq', selfId: '', channelId: '10003', cron: 'bad cron' },
  ]
  const snapshot: StatusSnapshot = {
    source: 'remote',
    stale: false,
    status: {
      version: 1,
      fetchedAt: new Date().toISOString(),
      subscription: null,
      config: { proxyCount: 1, proxyGroupCount: 0, proxyProviderCount: 0 },
    },
  }
  const service = { getStatus: async () => snapshot } as SubscriptionService
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as any

  registerPushSchedules(ctx, config, service, logger)
  assert.deepEqual(scheduled.map((item) => item.expression), ['30 7 * * *'])
  await scheduled[0].callback()
  assert.deepEqual(sent.map((item) => item.selfId), ['1', '2'])
  assert.equal(sent.every((item) => item.channelId === '10001'), true)
  assert.equal(sent.every((item) => item.message.startsWith('🌐 机场订阅状态')), true)
  assert.equal(sent.every((item) => item.message.includes('📊 订阅详情')), true)
  assert.equal(sent.every((item) => item.message.endsWith('✨')), true)
})

test('Cron 获取失败时发送装饰后的文本且不使用引用', async () => {
  let callback: (() => void | Promise<void>) | undefined
  const sent: string[] = []
  const ctx = {
    bots: [{
      platform: 'onebot',
      selfId: '1',
      sendMessage: async (_channelId: string, message: string) => { sent.push(message) },
    }],
    inject(_services: string[], run: (context: any) => void) { run(this) },
    cron(_expression: string, run: () => void | Promise<void>) {
      callback = run
      return () => undefined
    },
    on() {},
  } as unknown as Context
  const config = createConfig('')
  config.pushTargets = [
    { enabled: true, note: '', platform: 'onebot', selfId: '', channelId: '10001', cron: '30 7 * * *' },
  ]
  const service = { getStatus: async () => { throw new Error('network failed') } } as SubscriptionService
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as any

  registerPushSchedules(ctx, config, service, logger)
  await callback?.()
  assert.equal(sent.length, 1)
  assert.match(sent[0], /^❌ 定时获取机场状态失败/)
  assert.match(sent[0], /💡/)
  assert.match(sent[0], /⚠️$/)
})

test('Cron 多格式会向每个匹配 Bot 分别发送文本和图片', async () => {
  let callback: (() => void | Promise<void>) | undefined
  const sent: Array<{ selfId: string; content: any }> = []
  const makeBot = (selfId: string) => ({
    platform: 'onebot',
    selfId,
    sendMessage: async (_channelId: string, content: any) => { sent.push({ selfId, content }) },
  })
  const ctx = {
    baseDir: findAppBaseDir(),
    bots: [makeBot('1'), makeBot('2')],
    inject(_services: string[], run: (context: any) => void) { run(this) },
    cron(_expression: string, run: () => void | Promise<void>) {
      callback = run
      return () => undefined
    },
    on() {},
  } as unknown as Context
  const config = createConfig('')
  config.outputFormats = ['text', 'takumi']
  config.pushTargets = [
    { enabled: true, note: '', platform: 'onebot', selfId: '', channelId: '10001', cron: '30 7 * * *' },
  ]
  const service = { getStatus: async () => createStatusSnapshot() } as SubscriptionService

  registerPushSchedules(ctx, config, service, createLogger())
  await callback?.()

  assert.equal(sent.length, 4)
  assert.deepEqual(sent.map((item) => item.selfId), ['1', '2', '1', '2'])
  assert.deepEqual(sent.map((item) => typeof item.content === 'string' ? 'text' : item.content.type), ['text', 'text', 'img', 'img'])
  assert.equal(sent.some((item) => Array.isArray(item.content) && item.content[0]?.type === 'quote'), false)
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'koishi-jichang-status-'))
  temporaryDirectories.push(directory)
  return directory
}

function createConfig(subscriptionUrl: string): Config {
  return {
    subscriptionUrl,
    userAgent: 'clash.meta',
    customHeaders: [],
    requestTimeoutSeconds: 10,
    cacheTtlMinutes: 5,
    commandName: '机场状态',
    commandAliases: [],
    authority: 0,
    enableQuote: true,
    outputFormats: ['text'],
    pushTargets: [],
  }
}

function createStatusSnapshot(): StatusSnapshot {
  const now = Date.now()
  return {
    source: 'remote',
    stale: false,
    status: {
      version: 1,
      fetchedAt: new Date(now).toISOString(),
      subscription: {
        upload: 1024 * 1024,
        download: 5 * 1024 * 1024,
        total: 100 * 1024 * 1024,
        expireAt: Math.floor(now / 1000) + 5 * 24 * 60 * 60,
      },
      config: { name: '测试机场', proxyCount: 2, proxyGroupCount: 1, proxyProviderCount: 0 },
    },
  }
}

function createContext(baseDir: string, httpRequest: (...args: any[]) => Promise<any>): Context {
  const logger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
  }
  const http = Object.assign(httpRequest, {
    get: httpRequest,
  })
  return {
    baseDir,
    http,
    logger: () => logger,
  } as unknown as Context
}

function createResponse(status: number, data: string, subscriptionUserInfo?: string) {
  const headers = new Headers()
  if (subscriptionUserInfo) headers.set('subscription-userinfo', subscriptionUserInfo)
  return {
    url: 'https://example.com/sub',
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers,
    data,
  }
}

function createLogger(overrides: Partial<Record<'info' | 'warn' | 'error' | 'debug', (...args: any[]) => void>> = {}) {
  return {
    info: overrides.info || (() => undefined),
    warn: overrides.warn || (() => undefined),
    error: overrides.error || (() => undefined),
    debug: overrides.debug || (() => undefined),
  } as any
}

function findAppBaseDir(): string {
  let current = process.cwd()
  while (true) {
    if (existsSync(join(current, 'data', 'fonts', 'LXGWWenKaiMono-Regular.ttf'))) return current
    const parent = join(current, '..')
    if (parent === current) break
    current = parent
  }
  throw new Error('找不到应用根目录和 LXGW 字体')
}
