# App Usage Tracker

[English](./README.md)

App Usage Tracker 是一个面向 Windows 的 Electron 桌面使用时长统计工具。它可以记录前台应用使用时间，配合浏览器扩展实现站点级统计，并提供本地 CLI 与可供 AI 应用接入的 skill 文件。

## 功能概览

- 统计 Windows 前台应用使用时长
- 配合浏览器扩展后，可把浏览器使用归因到具体网站
- 网页按根域名聚合，而不是把每个 URL 单独当作一个项目
- 支持把部分桌面应用与对应网站合并到同一个服务项
- 提供日排行、近 7 天趋势和详情页
- 支持系统托盘、开机自启动和关闭行为设置
- 支持通过 CLI 查询本地统计数据
- 自带 AI skill 文件，方便接入 OpenClaw、Codex 等工具

当前内置的服务合并规则：

- ChatGPT 桌面应用 + `chatgpt.com`
- bilibili 桌面应用 + `bilibili.com`

## 工作原理

Windows 只能稳定拿到当前前台窗口所属应用，无法可靠地直接拿到浏览器完整 URL。因此项目采用“桌面应用 + 浏览器扩展”的组合方案：

1. 桌面端识别当前前台窗口
2. 浏览器扩展把活动标签页标题与 URL 发送给本地 bridge
3. 桌面端合并这两类事件，再按应用、站点或服务规则记账

如果不加载扩展，浏览器使用时长仍会被统计，但只能记到浏览器应用本身，无法细分到网站。

## 环境要求

- Windows
- Node.js 20+
- npm
- 如果要在本机打包 Windows 安装包，需要安装 Visual Studio 2022 Build Tools，并勾选“使用 C++ 的桌面开发”

## 快速开始

安装依赖：

```powershell
npm install
```

以脱离终端方式启动应用：

```powershell
npm start
```

以前台日志方式启动，便于开发调试：

```powershell
npm run start:dev
```

## CLI 查询

仓库内置了 CLI 查询入口：`src/cli/query.js`。

在仓库中执行：

```powershell
npm run query -- days --format json
npm run query -- top --range day --day latest --limit 10 --format json
npm run query -- search --query "ChatGPT" --format json
npm run query -- detail --key service:chatgpt --format json
```

安装版中可直接执行：

```powershell
app-usage-tracker-cli days --format json
```

说明：

- 安装程序会把安装目录加入当前用户的 `PATH`
- 如果安装前终端已经打开，请关闭并重新打开 PowerShell、CMD 或 Windows Terminal
- 安装后的包装脚本位于 `%LOCALAPPDATA%\Programs\app-usage-tracker\app-usage-tracker-cli.cmd`
- CLI 会遵循 `settings.json` 中的显示设置，未勾选项目不会出现在结果里，也不会计入总时长
- 对脚本、自动化和 AI 调用场景，建议优先使用 `--format json`

支持的数据路径覆盖方式：

- `--data-file <path>`
- `APP_USAGE_TRACKER_DATA_FILE`
- `--user-data-dir <dir>`
- `APP_USAGE_TRACKER_USER_DATA_DIR`

## 浏览器扩展

仓库中的 [`browser-extension`](./browser-extension) 目录包含 Chromium 系浏览器扩展。

以 Chrome / Edge / Brave / Opera 为例，加载步骤如下：

1. 打开扩展管理页
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 选择本仓库中的 `browser-extension` 目录

扩展会把活动标签页信息发送到本地 bridge：

```text
http://127.0.0.1:32123/v1/browser-event
```

## AI Skill 文件

项目在 [`skills/app-usage-tracker-query`](./skills/app-usage-tracker-query) 中提供了可供 AI 应用使用的 skill 文件，方便通过 CLI 查询本地使用数据。

GitHub Release 也会同时附带 `skills.zip`。

## 数据位置

默认情况下，应用会把数据保存在 `%APPDATA%\app-usage-tracker\` 下：

- 使用数据：`usage-data.json`
- 应用设置：`settings.json`
- 图标缓存：`icon-cache\`

## 打包

生成未安装版目录：

```powershell
npm run pack
```

生成 Windows 发布包：

```powershell
npm run dist
```

其他打包命令：

```powershell
npm run dist:portable
npm run dist:installer
```

常见产物包括：

- NSIS 安装包
- 便携版 Windows 可执行文件
- 浏览器扩展压缩包
- Skills 压缩包

## GitHub Actions 与 Release

仓库内置了 Windows 构建工作流：`.github/workflows/build-windows.yml`。

推送到 `main` 时会自动构建 Windows 产物。
推送符合 `v*` 的 tag 时，还会自动创建 GitHub Release，并上传：

- `App-Usage-Tracker-<version>-installer.exe`
- `App-Usage-Tracker-<version>-portable.exe`
- `App-Usage-Tracker-<version>-browser-extension.zip`
- `App-Usage-Tracker-<version>-skills.zip`

## 项目结构

- `src/main`：Electron 主进程代码
- `src/renderer`：渲染层 UI
- `src/cli`：本地查询 CLI
- `browser-extension`：浏览器 bridge 扩展
- `skills`：AI skill 文件
- `scripts`：辅助脚本
- `test`：自动化测试

## 已知限制

- 当前主要面向 Windows
- Firefox 支持有限；仓库内置扩展按 Chromium 风格接口实现
- “服务合并”依赖内置规则，不支持任意应用和任意网站自动合并
- 某些 favicon、图片或资源 URL 可能会被记录为最近访问网页

## License

本项目基于 [MIT License](./LICENSE) 开源。
