export function formatErrorReply(message: string): string {
  const normalized = message.trim().replace(/^❌\s*/, '') || '获取机场状态失败'
  return [
    `❌ ${normalized}`,
    '💡 请检查订阅地址、网络和后台日志。',
    '⚠️',
  ].join('\n')
}
