import { textFormatter } from './text'
import { takumiFormatter } from './takumi'
import { OutputFormatError, type OutputFormat, type StatusFormatter } from './types'

export const STATUS_FORMATTERS: readonly StatusFormatter[] = [
  textFormatter,
  takumiFormatter,
]

export function resolveStatusFormatters(formats: readonly OutputFormat[] | undefined): StatusFormatter[] {
  if (!Array.isArray(formats)) return [...STATUS_FORMATTERS]
  const selected = new Set(formats)
  const resolved = STATUS_FORMATTERS.filter((formatter) => selected.has(formatter.id))
  if (resolved.length === 0) throw new OutputFormatError()
  return [...resolved]
}

export * from './types'
export * from './error'
export * from './text'
export * from './takumi'
