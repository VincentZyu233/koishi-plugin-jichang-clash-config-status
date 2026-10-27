import type { Context, Logger } from 'koishi'
import type { Config } from './config'
import { formatErrorReply } from './formats/error'
import { resolveStatusFormatters, STATUS_FORMATTERS } from './formats'
import type { OutputContent as FormatOutputContent, OutputFormat } from './formats/types'
import { safeError } from './parser'
import type { StatusSnapshot } from './types'

export type OutputContent = FormatOutputContent

export interface OutputTarget {
  label: string
  send: (content: OutputContent) => Promise<unknown>
}

export { OutputFormatError } from './formats/types'

export const OUTPUT_FORMAT_ORDER: readonly OutputFormat[] = STATUS_FORMATTERS.map((formatter) => formatter.id)

export function resolveOutputFormats(formats: readonly OutputFormat[] | undefined): OutputFormat[] {
  return resolveStatusFormatters(formats).map((formatter) => formatter.id)
}

export async function dispatchStatusOutputs(
  ctx: Context,
  config: Config,
  snapshot: StatusSnapshot,
  targets: OutputTarget[],
  logger: Logger,
): Promise<void> {
  let formatters: ReturnType<typeof resolveStatusFormatters>
  try {
    formatters = resolveStatusFormatters(config.outputFormats)
  } catch (error) {
    const message = error instanceof Error ? error.message : '没有勾选任何输出格式，请至少勾选一个'
    logger.error(message)
    await sendToTargets(formatErrorReply(message), targets, logger, '格式配置错误')
    return
  }

  for (const formatter of formatters) {
    let content: OutputContent
    try {
      content = await formatter.render(ctx, snapshot)
    } catch (error) {
      logger.warn(`${formatter.label} 渲染失败：${safeError(error)}`)
      await sendToTargets(
        formatErrorReply(formatter.failureMessage),
        targets,
        logger,
        `${formatter.label} 错误提示`,
      )
      continue
    }

    const failedTargets = await sendToTargets(content, targets, logger, formatter.label)
    if (failedTargets.length > 0 && formatter.sendFailureMessage) {
      await sendToTargets(
        formatErrorReply(formatter.sendFailureMessage),
        failedTargets,
        logger,
        `${formatter.label} 发送错误提示`,
      )
    }
  }
}

async function sendToTargets(
  content: OutputContent,
  targets: OutputTarget[],
  logger: Logger,
  formatLabel: string,
): Promise<OutputTarget[]> {
  const failed: OutputTarget[] = []
  for (const target of targets) {
    try {
      await target.send(content)
    } catch (error) {
      failed.push(target)
      logger.warn(`发送 ${formatLabel} 到 ${target.label} 失败：${safeError(error)}`)
    }
  }
  return failed
}
