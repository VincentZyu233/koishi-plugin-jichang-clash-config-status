# koishi-plugin-jichang-clash-config-status

[![npm](https://img.shields.io/npm/v/koishi-plugin-jichang-clash-config-status?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-jichang-clash-config-status)

查询机场 Clash 订阅的流量、到期时间和配置摘要，并支持按多个频道和 Cron 定时推送。

## 功能

- `机场状态`：查看订阅状态，默认缓存五分钟。
- `机场状态 --refresh`：跳过缓存并立即刷新订阅。
- `outputFormats`：支持 `text`、`takumi` 多选，默认两项都启用，每个格式单独发送一条消息。
- `takumi`：使用 Clash 猫猫 logo 生成深蓝科技风状态卡图片。
- `enableQuote`：控制指令回复是否引用触发消息，默认开启；Cron 推送不引用。
- 支持配置多个推送目标，每行独立设置 `platform`、`selfId`、`channelId`、`cron` 和 `enabled`。
- 订阅下载成功后缓存到 `data/jichang-clash-config-status/latest.config.yaml`。
- 最近一次解析结果缓存到 `data/jichang-clash-config-status/latest.status.json`。

## 状态数据说明

流量和到期时间来自订阅响应头 `subscription-userinfo`，例如：

```text
subscription-userinfo: upload=1024; download=2048; total=107374182400; expire=1767225599
```

如果机场不返回该响应头，插件仍会展示 Clash 节点数和策略组数，但会明确提示无法获取流量与到期时间。订阅 URL 为空时会读取本地 `latest.config.yaml`；远程刷新失败时优先使用最近的本地缓存。

## 默认配置

- User-Agent：`clash.meta`
- Cron：`30 7 * * *`，即每天 07:30
- 查询权限：`0`，所有人可用
- 指令引用：`enableQuote=true`
- 输出格式：`['text', 'takumi']`
- `selfId` 留空时，向所有匹配 `platform` 的在线 Bot 推送到目标 `channelId`
- 消息装饰：成功消息以 `🌐` 开头、使用 `📊` 分隔、以 `✨` 结尾；失败消息使用 `❌`、`💡`、`⚠️`

`text` 与 `takumi` 至少需要勾选一项。若两个都不勾选，配置层会阻止保存；若通过旧配置绕过，控制台和 Bot 都会提示“没有勾选任何输出格式，请至少勾选一个”。Takumi 图片使用共享字体 `data/fonts/LXGWWenKaiMono-Regular.ttf`，缺失时会自动下载并校验。

## 开发

```powershell
yarn workspace koishi-plugin-jichang-clash-config-status test
```
