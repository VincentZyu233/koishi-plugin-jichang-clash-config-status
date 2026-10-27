import type { Bot, Context, Logger } from 'koishi'
import type { Config, PushTarget } from './config'
import { formatErrorReply } from './formats/error'
import { dispatchStatusOutputs, type OutputContent } from './output'
import { safeError, type SubscriptionService } from './subscription'
import type { StatusSnapshot } from './types'

type CronContext = Context & {
  cron?: (expression: string, callback: () => void | Promise<void>) => () => void
}

export function isFiveFieldCron(expression: string): boolean {
  return expression.trim().split(/\s+/).length === 5
}

export function matchesPushTarget(
  bot: Pick<Bot, 'platform' | 'selfId'>,
  target: Pick<PushTarget, 'platform' | 'selfId'>,
): boolean {
  if (bot.platform.trim().toLowerCase() !== target.platform.trim().toLowerCase()) return false
  const selfId = target.selfId.trim()
  return !selfId || bot.selfId === selfId
}

export function registerPushSchedules(
  ctx: Context,
  config: Config,
  service: SubscriptionService,
  logger: Logger,
): void {
  const targets = config.pushTargets
    .map((target, index) => ({ target, row: index + 1 }))
    .filter(({ target }) => target.enabled)
  if (targets.length === 0) return

  let cronAvailable = false
  ctx.inject(['cron'], (cronCtx) => {
    const cron = (cronCtx as CronContext).cron
    if (typeof cron !== 'function') return
    cronAvailable = true

    targets.forEach(({ target, row }) => {
      if (!target.channelId.trim()) {
        logger.warn(`推送表格第 ${row} 行已跳过：channelId 为空`)
        return
      }
      const expression = target.cron.trim()
      if (!isFiveFieldCron(expression)) {
        logger.warn(`推送表格第 ${row} 行已跳过：Cron 必须是五段式表达式`)
        return
      }

      try {
        cron.call(cronCtx, expression, () => sendStatusToTarget(ctx, config, target, service, logger))
        logger.info(`已注册机场状态推送：${target.note || target.platform + ':' + target.channelId} (${expression})`)
      } catch (error) {
        logger.warn(`推送表格第 ${row} 行 Cron 注册失败：${safeError(error)}`)
      }
    })
  })

  ctx.on('ready', () => {
    if (!cronAvailable && typeof (ctx as CronContext).cron !== 'function') {
      logger.warn('检测到启用的定时推送，但 cron 服务不可用；手动查询仍可正常使用')
    }
  })
}

async function sendStatusToTarget(
  ctx: Context,
  config: Config,
  target: PushTarget,
  service: SubscriptionService,
  logger: Logger,
): Promise<void> {
  const bots = ctx.bots.filter((bot) => matchesPushTarget(bot, target))
  if (bots.length === 0) {
    logger.warn(`未找到匹配的在线 Bot：platform=${target.platform}, selfId=${target.selfId || '*'}`)
    return
  }

  const outputTargets = bots.map((bot) => ({
    label: `${target.platform}:${target.channelId} (Bot ${bot.selfId})`,
    send: (content: OutputContent) => bot.sendMessage(target.channelId, content),
  }))

  let snapshot: StatusSnapshot
  try {
    snapshot = await service.getStatus()
  } catch (error) {
    logger.warn(`定时获取机场状态失败：${safeError(error)}`)
    const message = formatErrorReply('定时获取机场状态失败')
    for (const outputTarget of outputTargets) {
      try {
        await outputTarget.send(message)
      } catch (sendError) {
        logger.warn(`发送机场状态错误提示到 ${outputTarget.label} 失败：${safeError(sendError)}`)
      }
    }
    return
  }

  await dispatchStatusOutputs(ctx, config, snapshot, outputTargets, logger)
  logger.info(`机场状态多格式推送完成：${target.platform}:${target.channelId}`)
}
