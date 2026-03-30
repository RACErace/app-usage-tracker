<p align="center">
  <img src="app.ico" width="96" alt="App Usage Tracker">
</p>

<h1 align="center">App Usage Tracker</h1>

<p align="center">
  <strong>面向 Windows 的本地使用统计工具，覆盖应用、网站与真实音乐播放时长。</strong>
</p>

<p align="center">
  <a href="https://github.com/RACErace/app-usage-tracker/releases/latest">
    <img src="https://img.shields.io/github/v/release/RACErace/app-usage-tracker?style=flat-square&color=blue" alt="Release">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/github/license/RACErace/app-usage-tracker?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/built%20with-Electron%2035%20%2B%20Node.js-47848F?style=flat-square" alt="Stack">
</p>

<p align="center">
  <a href="./README.md">English</a>
</p>

---

App Usage Tracker 会记录 Windows 当前前台应用、浏览器活动站点，以及支持的音乐播放器是否真的在播放，再把这些原始信号整理成日排行、近 7 天趋势、真实会话时间线、详情页、本地备份和可自动化调用的 CLI。

- 浏览器时长可以细化到具体站点，而不只是浏览器本身
- 音乐播放器即使在后台，只要正在播放也能单独累计
- 可以把桌面应用和域名合并成一个更贴近真实工作的“服务”
- 桌面 UI、CLI 与 AI skill 共用同一份本地数据
- 使用记录与设置默认都保存在本地 JSON 文件中

> 随仓库提供的浏览器扩展只会把活动标签页元数据发送到本地 `http://127.0.0.1:32123`，不需要云端账号。

---

## 这是什么

它不是截图记录器，也不是监控式看板。App Usage Tracker 更像一个面向个人的本地使用轨迹账本，重点是帮助你回看时间究竟花在了哪里。

- 记录前台桌面应用和窗口上下文
- 通过浏览器扩展把浏览器使用归因到站点和页面
- 通过 SMTC + WASAPI 双源检测真实音乐播放
- 通过 CLI 和 AI skill 把本地数据接到脚本与自动化流程
- 提供备份、恢复和显示控制，适合长期持续使用

---

## 核心能力

### 采集与识别

| 能力 | 说明 |
|------|------|
| 前台应用追踪 | 识别当前活动窗口，并按桌面应用累计使用时长 |
| 网站归因 | 浏览器扩展连接后，可把标签页标题、URL、域名和路由信息附着到浏览器时长上 |
| 主机名级站点归类 | 网页记录默认按完整主机名汇总，子域名默认分开，需要时再用服务规则合并 |
| 页面明细 | 对站点保留页面级 bucket，便于在详情页继续下钻 |
| 音乐播放检测 | 结合 Windows SMTC 与 WASAPI 音频会话统计真实播放时长 |

### 回看与自动化

| 能力 | 说明 |
|------|------|
| 每日视图 | 查看某一天的总时长、排行、浏览器识别状态和时段分布 |
| 近 7 天趋势 | 聚合最近 7 天数据，展示总量、均值和主要项目变化 |
| 时间线视图 | 按真实开始/结束时间回放某一天的会话，并展示并行重叠的前台/播放片段 |
| 项目详情页 | 查看今日按小时分布、近 7 天历史、元数据，以及站点页面明细 |
| 本地 CLI | 直接查询日期、排行、时间线、搜索、详情和完整 snapshot |
| AI Skill 文件 | 提供可直接接入 Codex、OpenClaw 等工具的 skill |

### 控制与可靠性

| 能力 | 说明 |
|------|------|
| 服务合并规则 | 把桌面应用和网站域名合并为一个逻辑服务 |
| 分类规则 | 给项目打上工作 / 娱乐 / 学习 / 沟通等标签 |
| 显示控制 | 可隐藏项目，使其不参与总时长、排行、时间线、搜索和 snapshot |
| 统计保护 | 支持手动暂停、空闲暂停与锁屏暂停 |
| 桌面行为 | 支持系统托盘、开机自启动、关闭行为和浅色 / 深色 / 跟随系统主题 |
| 备份与恢复 | 支持导出 / 导入 JSON 备份，并可定时自动备份到本地 |

---

## 界面预览

### 每日概览

<img src="docs/使用统计-每天.png" alt="App Usage Tracker 每日概览" />

每日模式更适合回答“今天都在用什么”：总时长、可见项目数、浏览器扩展状态、使用排行和详情入口都集中在同一屏。

### 近 7 天

<img src="docs/使用统计-近7天.png" alt="App Usage Tracker 近 7 天" />

周视图会把最近 7 天卷在一起，更容易看出经常出现的工具、主要网站和整体使用节奏。

### 设置

<img src="docs/设置.png" alt="App Usage Tracker 设置" />

设置页集中管理托盘行为、开机启动、暂停规则、服务 / 分类规则、备份流程、显示项、主题和浏览器扩展状态。

---

## 工作原理

Windows 可以稳定拿到当前前台窗口，但网站级归因需要浏览器配合，所以项目采用“桌面应用 + 本地扩展 bridge”的组合方案：

1. 桌面端轮询当前前台窗口
2. 浏览器扩展把活动标签页标题和 URL 元数据发送给本地 bridge
3. 音乐检测同时读取 Windows SMTC 媒体会话和 WASAPI 音频会话
4. 追踪器把多路信号合并成应用、站点或服务条目
5. 桌面 UI 和 CLI 读取的是同一份本地数据

说明：

- 不安装扩展时，浏览器时长仍会被统计，但只能记到浏览器应用本身
- 音乐播放可能和其他前台应用同时发生，所以音乐项目总时长可能与纯前台窗口时长不同
- 如果播放器既不暴露可用的 SMTC 信息，也没有活跃的 WASAPI 会话，就会退回普通前台统计

---

## 页面结构

| 页面 | 做什么 |
|------|--------|
| 每天 | 查看单日图表、排行、当前总量和浏览器扩展状态 |
| 近 7 天 | 查看最近 7 天的聚合总量、排行和节奏变化 |
| 时间线 | 按真实开始/结束时间查看某一天的会话，并展示可重叠的前台 / 播放片段 |
| 详情 | 查看某个项目的小时分布、近几天历史、元数据，以及站点页面明细 |
| 设置 | 管理启动、托盘、暂停规则、备份、显示项、主题、服务规则和分类规则 |

---

## 环境要求

- Windows
- Node.js 20+
- npm
- 如果要在本机打包 Windows 安装包，需要安装 Visual Studio 2022 Build Tools，并勾选 `Desktop development with C++`

---

## 安装

从 [Releases](https://github.com/RACErace/app-usage-tracker/releases/latest) 下载最新版。

| 包类型 | 格式 |
|--------|------|
| 安装版 | `.exe`（NSIS） |
| 便携版 | `.exe` |

### 从源码快速启动

```powershell
npm install
npm start
npm run start:dev
```

- `npm start` 会以接近安装版的方式脱离终端启动
- `npm run start:dev` 会让 Electron 保持在前台，便于开发调试

---

## 浏览器扩展

Chromium 系浏览器扩展位于 [`browser-extension`](./browser-extension)。

以 Chrome / Edge / Brave / Opera 为例，加载方式如下：

1. 打开扩展管理页
2. 开启开发者模式
3. 选择 `加载已解压的扩展程序`
4. 选择仓库中的 `browser-extension` 目录

扩展会把活动标签页元数据发送到：

```text
http://127.0.0.1:32123/v1/browser-event
```

如果桌面端一段时间内没有收到扩展心跳，界面会提示当前未检测到浏览器扩展连接。

Firefox 支持目前仍比较有限；仓库里的实现主要按 Chromium 风格扩展接口编写。

---

## CLI 查询

本地 CLI 位于 `src/cli/query.js`。

在仓库中执行：

```powershell
npm run query -- days --format json
npm run query -- top --range day --day latest --limit 10 --format json
npm run query -- timeline --day latest --limit 20 --format json
npm run query -- search --query "ChatGPT" --format json
npm run query -- detail --key service:chatgpt --format json
npm run query -- snapshot --format json
```

安装版中可直接执行：

```powershell
app-usage-tracker-cli days --format json
```

说明：

- 安装程序会把安装目录加入当前用户的 `PATH`
- 如果安装前终端已经打开，请重新打开 PowerShell、CMD 或 Windows Terminal
- 安装后的包装脚本位于 `%LOCALAPPDATA%\Programs\app-usage-tracker\app-usage-tracker-cli.cmd`
- CLI 会遵循 `settings.json` 中的显示设置，隐藏项目不会出现在总时长、排行、时间线、搜索和 snapshot 中
- `timeline` 会优先返回真实存储的会话明细；对于在“会话时间线”能力上线前采集的旧日期，可能只能拿到聚合总量
- 对脚本、自动化和 AI 调用场景，建议优先使用 `--format json`

支持的数据路径覆盖方式：

- `--data-file <path>`
- `APP_USAGE_TRACKER_DATA_FILE`
- `--user-data-dir <dir>`
- `APP_USAGE_TRACKER_USER_DATA_DIR`

---

## AI Skill 文件

项目在 [`skills/app-usage-tracker-query`](./skills/app-usage-tracker-query) 中提供了可供 AI 工具使用的 skill 文件，方便通过 CLI 访问本地使用数据和时间线。

GitHub Release 工作流也会同时发布 `skills.zip`。

---

## 数据位置

默认情况下，应用会把数据保存在 `%APPDATA%\app-usage-tracker\` 下：

- `usage-data.json`：使用记录
- `settings.json`：应用设置与规则配置
- `backups\`：自动备份目录
- `icon-cache\`：图标缓存

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 35 |
| 主进程 / 后端 | Node.js |
| 前端 | 原生 HTML + CSS + JavaScript |
| CLI | Node.js |
| 存储 | 本地 JSON |
| 打包 | electron-builder |

---

## 开发

```powershell
npm install
npm run start:dev
npm test
npm run pack
npm run dist
```

常用打包命令：

```powershell
npm run dist:portable
npm run dist:installer
```

项目结构：

| 路径 | 说明 |
|------|------|
| `src/main` | Electron 主进程、追踪、存储、bridge、图标与备份逻辑 |
| `src/renderer` | 桌面界面 |
| `src/cli` | 本地查询 CLI |
| `browser-extension` | 浏览器 bridge 扩展 |
| `skills` | AI skill 文件 |
| `scripts` | 辅助脚本 |
| `test` | 自动化测试 |

仓库内置 Windows 构建工作流 [`.github/workflows/build-windows.yml`](./.github/workflows/build-windows.yml)。推送到 `main` 会构建 Windows 产物，推送符合 `v*` 的 tag 时还会自动创建 GitHub Release，并上传安装版、便携版、浏览器扩展和 skill 压缩包。

---

## 已知限制

- 当前主要面向 Windows
- 网站级归因最佳体验依赖随仓库提供的浏览器扩展；不装扩展时会退回浏览器应用级统计
- 服务合并和分类效果取决于你配置的规则
- 某些 favicon 或原始资源 URL 偶尔可能出现在最近网页记录里
- 浏览器中的网页播放器不会被额外识别为独立音乐应用

---

## License

本项目基于 [MIT License](./LICENSE) 开源。
