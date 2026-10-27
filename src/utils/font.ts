import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from 'koishi'
import { safeError } from '../parser'

export const LXGW_FONT_FILE_NAME = 'LXGWWenKaiMono-Regular.ttf'
export const LXGW_FONT_PATH_PARTS = ['data', 'fonts', LXGW_FONT_FILE_NAME] as const

const LXGW_FONT_SIZE = 24_755_236
const LXGW_FONT_SHA256 = 'ee9faa6479c5b2434f9bceca8e2e7b643f699f4f3d067aac9609261e07c6be61'
const FONT_SOURCES = [
  'https://gitee.com/vincent-zyu/koishi-plugin-awa-quote-image/releases/download/fonts/LXGWWenKaiMono-Regular.ttf',
  'https://github.com/VincentZyuApps/koishi-plugin-awa-quote-image/releases/download/fonts/LXGWWenKaiMono-Regular.ttf',
]

const fontPromises = new Map<string, Promise<string>>()

export function getLxgwFontPath(baseDir: string): string {
  return join(baseDir, ...LXGW_FONT_PATH_PARTS)
}

export function ensureLxgwFont(ctx: Context): Promise<string> {
  const fontPath = getLxgwFontPath(ctx.baseDir)
  const existing = fontPromises.get(fontPath)
  if (existing) return existing

  const task = ensureFontFile(ctx, fontPath).catch((error) => {
    fontPromises.delete(fontPath)
    throw error
  })
  fontPromises.set(fontPath, task)
  return task
}

async function ensureFontFile(ctx: Context, fontPath: string): Promise<string> {
  if (await verifyFont(fontPath)) return fontPath

  await mkdir(join(ctx.baseDir, 'data', 'fonts'), { recursive: true })
  let lastError: unknown
  for (const url of FONT_SOURCES) {
    const temporaryPath = `${fontPath}.${process.pid}.download`
    try {
      ctx.logger('jichang-clash-config-status').info(`正在下载 Takumi 中文字体：${LXGW_FONT_FILE_NAME}`)
      const data = await ctx.http.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 30_000,
      })
      await writeFile(temporaryPath, Buffer.from(data))
      if (!(await verifyFont(temporaryPath))) throw new Error('字体文件校验失败')
      await rename(temporaryPath, fontPath)
      return fontPath
    } catch (error) {
      lastError = error
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }

  throw new Error(`Takumi 中文字体下载失败：${safeError(lastError)}`)
}

async function verifyFont(fontPath: string): Promise<boolean> {
  if (!existsSync(fontPath)) return false
  try {
    const info = await stat(fontPath)
    if (info.size !== LXGW_FONT_SIZE) return false
    const content = await readFile(fontPath)
    return createHash('sha256').update(content).digest('hex') === LXGW_FONT_SHA256
  } catch {
    return false
  }
}
