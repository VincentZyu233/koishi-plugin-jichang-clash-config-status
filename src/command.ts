import { h, type Context, type Session } from 'koishi'
import type { Config } from './config'
import { formatErrorReply } from './formats/error'
import { dispatchStatusOutputs, type OutputContent } from './output'
import { safeError, type SubscriptionService } from './subscription'

export function buildCommandReply(
  session: Pick<Session, 'messageId'>,
  config: Pick<Config, 'enableQuote'>,
  content: OutputContent,
) {
  if (!config.enableQuote || !session.messageId) return content
  return [h.quote(session.messageId), typeof content === 'string' ? h.text(content) : content]
}

export function registerStatusCommand(ctx: Context, config: Config, service: SubscriptionService): void {
  const command = ctx.command(config.commandName, '查询机场 Clash 订阅状态', {
    authority: config.authority,
  }).option('refresh', '-r, --refresh 跳过缓存并立即刷新订阅')

  for (const alias of new Set(config.commandAliases.map((item) => item.trim()).filter(Boolean))) {
    if (alias === config.commandName) continue
    try {
      command.alias(alias)
    } catch (error) {
      ctx.logger('jichang-clash-config-status').warn(`跳过冲突的指令别名 ${alias}：${safeError(error)}`)
    }
  }

  command.action(async ({ session, options }) => {
    if (!session) return
    const logger = ctx.logger('jichang-clash-config-status')
    try {
      const snapshot = await service.getStatus(Boolean(options.refresh))
      await dispatchStatusOutputs(ctx, config, snapshot, [{
        label: `${session.platform}:${session.channelId}`,
        send: async (content) => session.send(buildCommandReply(session, config, content)),
      }], logger)
    } catch (error) {
      logger.warn(`查询机场状态失败：${safeError(error)}`)
      const message = error instanceof Error ? error.message : '获取机场状态失败'
      await session.send(buildCommandReply(session, config, formatErrorReply(message)))
    }
  })
}
