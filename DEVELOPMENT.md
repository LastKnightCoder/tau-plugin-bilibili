# 开发与发布

当前依赖、平台边界与验证步骤见 [兼容性说明](COMPATIBILITY.md)。

需要 Node.js 22 或更高版本，以及 pnpm 11.9.0。SDK 使用 `@tau/plugins` 到 `@xiongtao.xt/tau-plugins@0.52.0` 的公开别名，不依赖 Tau 主仓库或本机目录。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

构建生成 `dist/bilibili-<版本>.zip`。SDK、React 和 UI 由客户端提供，构建时保持 external；二维码生成库 `qrcode-generator` 打包进插件。测试模拟 HTTP，不需要真实账号。

插件 ID 为 `bilibili`，与客户端已保存视频的来源类型一致，修改 ID 会导致已有视频找不到提供方，不要更改。`src/api.ts` 是 Bilibili Web 接口适配，`src/provider.ts` 实现视频提供方：识别链接、列出清晰度、给出带 Referer 的音视频分离流，下载与合并由客户端完成。视频引用保存 `bvid / cid / quality`，与历史数据保持一致。

更新时同步修改 `package.json`、`manifest.json` 和 `CHANGELOG.md`，提交后推送同版本标签，GitHub Actions 会测试、构建并发布 ZIP 到 GitHub Release。
