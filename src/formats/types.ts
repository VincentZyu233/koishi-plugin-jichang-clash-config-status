import type { h, Context } from 'koishi'
import type { StatusSnapshot } from '../types'

export type OutputFormat = 'text' | 'takumi'

export type OutputContent = string | ReturnType<typeof h.text>

export interface StatusFormatter {
  id: OutputFormat
  label: string
  failureMessage: string
  sendFailureMessage?: string
  render: (ctx: Context, snapshot: StatusSnapshot) => OutputContent | Promise<OutputContent>
}

export class OutputFormatError extends Error {
  constructor(message = '没有勾选任何输出格式，请至少勾选一个') {
    super(message)
    this.name = 'OutputFormatError'
  }
}
