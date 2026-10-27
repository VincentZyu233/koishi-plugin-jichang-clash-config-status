import type { Context } from 'koishi'
import type { Config } from './config'
import { registerStatusCommand } from './command'
import { registerPushSchedules } from './schedule'
import { SubscriptionService, safeError } from './subscription'

export const name = 'jichang-clash-config-status'

export const inject = {
  required: ['http'],
  optional: ['cron'],
}

export * from './config'

export const usage = `
### 机场 Clash 订阅状态

- 配置机场订阅 URL 后，插件会下载并缓存 Clash 配置。
- 通过 \`机场状态\` 指令查看流量、到期时间和配置摘要。
- 使用 \`机场状态 --refresh\` 强制刷新订阅。
- 输出格式支持 \`text\` 与 \`takumi\` 多选，默认两者都启用并分别发送。
- \`takumi\` 使用 Clash 猫猫 logo 生成深色科技风状态卡。
- 推送目标支持多行表格，每行可独立配置平台、频道、Bot ID 和 Cron。

> 流量与到期信息来自订阅响应头 \`subscription-userinfo\`。如果机场不返回该响应头，插件仍会展示 Clash 配置摘要，但无法显示流量和到期时间。
`

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger(name)
  const service = new SubscriptionService(ctx, config)

  registerStatusCommand(ctx, config, service)
  registerPushSchedules(ctx, config, service, logger)

  ctx.on('ready', () => {
    void service.getStatus().catch((error) => {
      logger.warn(`启动时获取机场状态失败：${safeError(error)}`)
    })
  })
}
