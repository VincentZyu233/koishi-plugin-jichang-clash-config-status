import { Schema } from 'koishi'
import type { OutputFormat } from './formats/types'

export const DEFAULT_USER_AGENT = 'clash.meta'
export const DEFAULT_PUSH_CRON = '30 7 * * *'
export const DEFAULT_OUTPUT_FORMATS = ['text', 'takumi'] as const

export interface RequestHeader {
  key: string
  value: string
}

export interface PushTarget {
  enabled: boolean
  note: string
  platform: string
  selfId: string
  channelId: string
  cron: string
}

export interface Config {
  subscriptionUrl: string
  userAgent: string
  customHeaders: RequestHeader[]
  requestTimeoutSeconds: number
  cacheTtlMinutes: number
  commandName: string
  commandAliases: string[]
  authority: number
  enableQuote: boolean
  outputFormats: OutputFormat[]
  pushTargets: PushTarget[]
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    subscriptionUrl: Schema.string()
      .role('secret')
      .default('')
      .description('🔗 机场 Clash 订阅下载 URL。留空时读取本地缓存配置；URL 中可能包含订阅令牌，请勿公开。'),
    userAgent: Schema.string()
      .default(DEFAULT_USER_AGENT)
      .description('🌐 下载订阅时使用的 User-Agent。部分机场会根据 UA 返回不同格式。'),
    customHeaders: Schema.array(Schema.object({
      key: Schema.string()
        .required()
        .description('请求头名称；填写 User-Agent 时会覆盖上面的默认 UA'),
      value: Schema.string()
        .role('secret')
        .default('')
        .description('请求头值，可能包含订阅令牌或 Cookie'),
    }))
      .role('table')
      .default([])
      .description('🧾 自定义请求头表格'),
    requestTimeoutSeconds: Schema.number()
      .min(1)
      .max(120)
      .default(10)
      .description('⌛ 下载订阅的超时时间（秒）'),
    cacheTtlMinutes: Schema.number()
      .min(1)
      .max(1440)
      .default(5)
      .description('🗃️ 状态缓存有效期（分钟）。期间重复查询不会重复下载订阅。'),
  }).description('📡 订阅设置'),

  Schema.object({
    commandName: Schema.string()
      .default('机场状态')
      .description('⌨️ 查询指令名称'),
    commandAliases: Schema.array(String)
      .role('table')
      .default(['jichang', '订阅状态'])
      .description('🏷️ 查询指令别名'),
    authority: Schema.number()
      .min(0)
      .max(5)
      .default(0)
      .description('🔐 执行查询指令所需的最低权限等级'),
    enableQuote: Schema.boolean()
      .default(true)
      .description('💬 Bot 回复指令时是否引用触发消息；定时推送不会引用'),
  }).description('💬 查询指令'),

  Schema.object({
    outputFormats: Schema.array(Schema.union([
      Schema.const('text' as OutputFormat).description('【 📝 text 】 纯文本状态消息'),
      Schema.const('takumi' as OutputFormat).description('【 ⚡ takumi 】 Clash 猫猫深色状态卡图片'),
    ]))
      .role('checkbox')
      .min(1)
      .default([...DEFAULT_OUTPUT_FORMATS])
      .description('📤 状态消息返回格式。至少勾选 text 或 takumi 其中一项；每个选中的格式会单独发送一条消息。'),
  }).description('📤 消息输出格式'),

  Schema.object({
    pushTargets: Schema.array(Schema.object({
      enabled: Schema.boolean()
        .default(true)
        .description('✅ 是否启用该推送目标'),
      note: Schema.string()
        .default('')
        .description('📝 备注'),
      platform: Schema.string()
        .default('onebot')
        .description('🎯 平台标识，例如 onebot、qq、discord'),
      selfId: Schema.string()
        .default('')
        .description('🤖 Bot ID（可选）。留空时向所有匹配平台的在线 Bot 推送'),
      channelId: Schema.string()
        .default('')
        .description('📡 群号或频道 ID'),
      cron: Schema.string()
        .default(DEFAULT_PUSH_CRON)
        .description('⏰ 五段式 Cron 表达式，默认每天 07:30 推送'),
    }))
      .role('table')
      .default([])
      .description('📢 定时推送目标表格。每一行独立注册 Cron。'),
  }).description('📢 定时推送'),
])
