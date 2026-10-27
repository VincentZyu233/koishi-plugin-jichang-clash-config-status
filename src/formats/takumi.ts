import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { container, image, text, type Node } from '@takumi-rs/helpers'
import { h, type Context } from 'koishi'
import { ensureLxgwFont } from '../utils/font'
import { formatBytes, formatDateTime } from '../utils/format'
import { hasSubscriptionData } from '../parser'
import type { StatusSnapshot } from '../types'
import type { StatusFormatter } from './types'

const nodeRequire = createRequire(
  typeof __filename === 'string' ? __filename : join(process.cwd(), 'index.js'),
)
const takumiModule = nodeRequire('@takumi-rs/wasm/node') as typeof import('@takumi-rs/wasm/node')

interface TakumiRenderer {
  render: (node: Node, options: { width?: number; format?: 'png'; devicePixelRatio?: number }) => Uint8Array | Promise<Uint8Array>
  free: () => void
}

type TakumiFont = Buffer | { name: string; data: Buffer; weight?: number; style?: 'normal' }

const TakumiRenderer = takumiModule.Renderer as unknown as new (options: { fonts: TakumiFont[] }) => TakumiRenderer

const WIDTH = 900
const HEIGHT = 780
const PADDING = 36
const DEVICE_PIXEL_RATIO = 1.5

const palette = {
  background: '#07111F',
  panel: '#0D2037',
  panelStrong: '#102A49',
  panelSoft: '#122F50',
  border: '#21466C',
  text: '#F1F7FF',
  textSoft: '#A9BED5',
  textMuted: '#7189A3',
  cyan: '#4DD7FF',
  cyanSoft: '#A7ECFF',
  green: '#52E6A3',
  yellow: '#FFD166',
  red: '#FF7B8A',
  white: '#FFFFFF',
}

const fontBuffers = new Map<string, Promise<Buffer>>()

export async function renderTakumiStatus(ctx: Context, snapshot: StatusSnapshot) {
  const png = await renderTakumiStatusPng(ctx, snapshot)
  return h.image(png, 'image/png')
}

export async function renderTakumiStatusPng(ctx: Context, snapshot: StatusSnapshot): Promise<Buffer> {
  const fontPath = await ensureLxgwFont(ctx)
  const fontBuffer = await loadFontBuffer(fontPath)
  const logoBuffer = await loadLogoBuffer()
  const renderer = new TakumiRenderer({
    fonts: [400, 500, 600, 700, 800, 900].map((weight) => ({
      name: 'LXGW WenKai Mono',
      data: fontBuffer,
      weight,
      style: 'normal' as const,
    })),
  })

  try {
    const root = buildStatusCard(snapshot, logoBuffer)
    const output = await renderer.render(root, {
      width: Math.round(WIDTH * DEVICE_PIXEL_RATIO),
      format: 'png',
      devicePixelRatio: DEVICE_PIXEL_RATIO,
    })
    return Buffer.from(output)
  } finally {
    renderer.free()
  }
}

function buildStatusCard(snapshot: StatusSnapshot, logoBuffer: Buffer): Node {
  const { status } = snapshot
  const info = hasSubscriptionData(status.subscription) ? status.subscription : null
  const upload = info?.upload ?? null
  const download = info?.download ?? null
  const total = info?.total ?? null
  const used = upload !== null && download !== null ? upload + download : null
  const remaining = total !== null && used !== null && total > 0 ? Math.max(total - used, 0) : null
  const percent = total !== null && total > 0 && used !== null
    ? Math.min(100, Math.max(0, (used / total) * 100))
    : 0
  const expireLabel = info?.expireAt
    ? formatDateTime(info.expireAt * 1000)
    : '未知或永不过期'
  const remainingDays = info?.expireAt
    ? Math.ceil((info.expireAt * 1000 - Date.now()) / 86_400_000)
    : null
  const title = status.config.name || '机场订阅'
  const sourceLabel = snapshot.source === 'remote' ? '远程订阅' : '本地配置'
  const warningText = buildWarning(snapshot)

  return container({
    style: {
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: palette.background,
      padding: PADDING,
      display: 'flex',
      flexDirection: 'column',
      gap: 20,
      color: palette.text,
      fontFamily: 'LXGW WenKai Mono',
    },
    children: [
      buildHeader(title, sourceLabel, snapshot, logoBuffer),
      container({
        style: { display: 'flex', gap: 18, width: '100%' },
        children: [
          buildTrafficPanel({ used, total, remaining, percent, upload, download }),
          buildExpiryPanel(expireLabel, remainingDays, info?.expireAt ?? null),
        ],
      }),
      buildMetaPanel(status.config.proxyCount, status.config.proxyGroupCount, status.config.proxyProviderCount, status.fetchedAt),
      warningText
        ? container({
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 18px',
              borderRadius: 14,
              border: `1px solid ${palette.yellow}66`,
              backgroundColor: '#3A2D1544',
              color: palette.yellow,
              fontSize: 18,
              fontWeight: 600,
            },
            children: [
              text('!', { fontSize: 24, fontWeight: 800, color: palette.yellow }),
              text(warningText, { flex: 1, fontSize: 18, color: palette.yellow }),
            ],
          })
        : container({
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 18px',
              borderRadius: 14,
              backgroundColor: '#0B2B2A66',
              border: `1px solid ${palette.green}55`,
            },
            children: [
              text('SUBSCRIPTION DATA AVAILABLE', {
                fontSize: 16,
                fontWeight: 700,
                color: palette.green,
                letterSpacing: 1,
              }),
            ],
          }),
      container({
        style: {
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 'auto',
        },
        children: [
          text('koishi-plugin-jichang-clash-config-status', {
            fontSize: 14,
            color: palette.textMuted,
            fontWeight: 500,
          }),
          text('Takumi-rs / Clash Cat Edition', {
            fontSize: 14,
            color: palette.cyanSoft,
            fontWeight: 600,
          }),
        ],
      }),
    ],
  })
}

function buildHeader(title: string, sourceLabel: string, snapshot: StatusSnapshot, logoBuffer: Buffer): Node {
  const sourceColor = snapshot.stale ? palette.yellow : palette.cyan
  return container({
    style: {
      width: '100%',
      padding: 24,
      display: 'flex',
      alignItems: 'center',
      gap: 24,
      borderRadius: 26,
      backgroundColor: palette.panel,
      border: `1px solid ${palette.border}`,
    },
    children: [
      container({
        style: {
          width: 112,
          height: 112,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 28,
          backgroundColor: '#EAF7FF',
          border: `2px solid ${palette.cyan}88`,
          boxShadow: '0 12px 30px rgba(0,0,0,0.25)',
        },
        children: [
          image({
            src: logoBuffer,
            width: 92,
            height: 92,
            style: { width: 92, height: 92, objectFit: 'contain' },
          }),
        ],
      }),
      container({
        style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 8 },
        children: [
          text('CLASH SUBSCRIPTION STATUS', {
            fontSize: 15,
            fontWeight: 800,
            color: palette.cyan,
            letterSpacing: 2,
          }),
          text(title, {
            fontSize: 38,
            lineHeight: 1.15,
            fontWeight: 800,
            color: palette.text,
          }),
          container({
            style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 },
            children: [
              container({
                style: {
                  display: 'flex',
                  padding: '5px 12px',
                  borderRadius: 999,
                  backgroundColor: `${sourceColor}20`,
                  border: `1px solid ${sourceColor}66`,
                },
                children: [text(sourceLabel, { fontSize: 15, fontWeight: 700, color: sourceColor })],
              }),
              container({
                style: {
                  display: 'flex',
                  padding: '5px 12px',
                  borderRadius: 999,
                  backgroundColor: '#FFFFFF0D',
                  border: `1px solid ${palette.border}`,
                },
                children: [text(snapshot.stale ? '缓存数据' : '实时状态', {
                  fontSize: 15,
                  fontWeight: 700,
                  color: snapshot.stale ? palette.yellow : palette.textSoft,
                })],
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

function buildTrafficPanel(values: {
  used: number | null
  total: number | null
  remaining: number | null
  percent: number
  upload: number | null
  download: number | null
}): Node {
  return container({
    style: {
      flex: 2,
      minHeight: 260,
      padding: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      borderRadius: 22,
      backgroundColor: palette.panel,
      border: `1px solid ${palette.border}`,
    },
    children: [
      container({
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
        children: [
          text('流量额度', { fontSize: 20, fontWeight: 700, color: palette.textSoft }),
          text(values.total !== null && values.total > 0 ? `${values.percent.toFixed(1)}% 已使用` : '额度未知', {
            fontSize: 16,
            fontWeight: 700,
            color: values.percent >= 90 ? palette.red : palette.cyanSoft,
          }),
        ],
      }),
      text(values.remaining !== null ? formatBytes(values.remaining) : '--', {
        fontSize: 54,
        lineHeight: 1.05,
        fontWeight: 900,
        color: values.remaining !== null ? palette.green : palette.textMuted,
      }),
      text('剩余流量', { fontSize: 16, fontWeight: 600, color: palette.textMuted }),
      container({
        style: { width: '100%', height: 14, borderRadius: 999, backgroundColor: '#FFFFFF12', overflow: 'hidden' },
        children: [
          container({
            style: {
              width: `${values.percent}%`,
              height: 14,
              minHeight: 14,
              display: 'flex',
              borderRadius: 999,
              backgroundColor: values.percent >= 90 ? palette.red : palette.cyan,
            },
            children: [],
          }),
        ],
      }),
      container({
        style: { display: 'flex', gap: 12, marginTop: 'auto' },
        children: [
          buildSmallMetric('已用', values.used !== null ? formatBytes(values.used) : '未知'),
          buildSmallMetric('总流量', values.total !== null && values.total > 0 ? formatBytes(values.total) : '未限制'),
          buildSmallMetric('上传', values.upload !== null ? formatBytes(values.upload) : '未知'),
          buildSmallMetric('下载', values.download !== null ? formatBytes(values.download) : '未知'),
        ],
      }),
    ],
  })
}

function buildExpiryPanel(expireLabel: string, remainingDays: number | null, expireAt: number | null): Node {
  const expired = expireAt !== null && expireAt > 0 && expireAt * 1000 <= Date.now()
  return container({
    style: {
      flex: 1,
      minHeight: 260,
      padding: 24,
      display: 'flex',
      flexDirection: 'column',
      borderRadius: 22,
      backgroundColor: palette.panelStrong,
      border: `1px solid ${expired ? palette.red + '88' : palette.border}`,
    },
    children: [
      text('到期时间', { fontSize: 20, fontWeight: 700, color: palette.textSoft }),
      text(expired ? '已过期' : remainingDays !== null ? `${remainingDays} 天` : '--', {
        fontSize: 44,
        fontWeight: 900,
        color: expired ? palette.red : palette.yellow,
        marginTop: 24,
      }),
      text('剩余天数', { fontSize: 16, fontWeight: 600, color: palette.textMuted, marginTop: 4 }),
      container({
        style: {
          marginTop: 'auto',
          paddingTop: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          borderTop: `1px solid ${palette.border}`,
        },
        children: [
          text('当前到期日期', { fontSize: 14, color: palette.textMuted, fontWeight: 600 }),
          text(expireLabel, { fontSize: 20, color: palette.text, fontWeight: 700 }),
        ],
      }),
    ],
  })
}

function buildSmallMetric(label: string, value: string): Node {
  return container({
    style: {
      flex: 1,
      minWidth: 0,
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 5,
      borderRadius: 14,
      backgroundColor: palette.panelSoft,
      border: `1px solid ${palette.border}`,
    },
    children: [
      text(label, { fontSize: 14, color: palette.textMuted, fontWeight: 600 }),
      text(value, { fontSize: 18, color: palette.text, fontWeight: 800, whiteSpace: 'nowrap' }),
    ],
  })
}

function buildMetaPanel(proxyCount: number, groupCount: number, providerCount: number, fetchedAt: string): Node {
  return container({
    style: {
      width: '100%',
      padding: '18px 22px',
      display: 'flex',
      gap: 20,
      borderRadius: 18,
      backgroundColor: '#0B192B',
      border: `1px solid ${palette.border}`,
    },
    children: [
      buildMetaItem('节点', `${proxyCount}`),
      buildMetaItem('策略组', `${groupCount}`),
      buildMetaItem('代理提供者', `${providerCount}`),
      buildMetaItem('最近更新', formatDateTime(fetchedAt)),
    ],
  })
}

function buildMetaItem(label: string, value: string): Node {
  return container({
    style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 5 },
    children: [
      text(label, { fontSize: 14, color: palette.textMuted, fontWeight: 600 }),
      text(value, { fontSize: 19, color: palette.cyanSoft, fontWeight: 700 }),
    ],
  })
}

function buildWarning(snapshot: StatusSnapshot): string | null {
  if (!hasSubscriptionData(snapshot.status.subscription)) {
    return '机场未返回有效的 subscription-userinfo，流量与到期信息不可用'
  }
  if (snapshot.stale) return snapshot.warning || '当前展示最近一次本地缓存，数据可能已过期'
  return null
}

async function loadFontBuffer(fontPath: string): Promise<Buffer> {
  let promise = fontBuffers.get(fontPath)
  if (!promise) {
    promise = readFile(fontPath)
    fontBuffers.set(fontPath, promise)
  }
  return promise
}

async function loadLogoBuffer(): Promise<Buffer> {
  const candidates = [
    join(__dirname, '..', 'assets', 'clash-cat.png'),
    join(__dirname, '..', '..', 'assets', 'clash-cat.png'),
  ]
  const logoPath = candidates.find((candidate) => existsSync(candidate))
  if (!logoPath) throw new Error('Clash 猫猫 logo 资源缺失')
  return readFile(logoPath)
}

export const takumiFormatter: StatusFormatter = {
  id: 'takumi',
  label: 'Takumi',
  failureMessage: 'Takumi 状态图生成失败，请检查字体资源和后台日志',
  sendFailureMessage: 'Takumi 状态图发送失败，请检查平台消息能力',
  render: (ctx, snapshot) => renderTakumiStatus(ctx, snapshot),
}
