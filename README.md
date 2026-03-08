# App Usage Tracker

一个面向 Windows 的桌面应用使用时长统计工具。界面风格参考手机“使用统计”，支持本地应用、浏览器网页、近 7 天趋势、详情页、系统托盘、开机自启动，以及部分“同服务”的网站端与桌面端合并统计。

## 特性

- 统计当前前台应用的使用时长
- 浏览器配合扩展后可识别具体网页
- 浏览器网页按根域名聚合，例如不同 bilibili 视频页会统一记到 bilibili
- 部分服务支持“网站端 + 桌面端”合并统计
- 排行和详情页优先显示真实应用图标或网站 favicon
- 最小化/关闭隐藏到系统托盘
- 支持托盘和设置页切换开机自启动
- `npm start` 可脱离终端启动，关闭 PowerShell 后应用继续运行

当前已内置的同服务合并规则：

- ChatGPT 桌面应用 + chatgpt.com
- bilibili 桌面应用 + bilibili.com

## 工作方式

Windows 只能稳定拿到浏览器窗口标题，拿不到完整 URL，所以浏览器识别采用“桌面端 + 浏览器扩展”协同方案：

1. 桌面端识别当前前台窗口是否属于浏览器。
2. 浏览器扩展把当前活动标签页标题和 URL 发给本地 bridge。
3. 桌面端把活动窗口和标签页事件合并，再按根域名或服务规则记账。

如果不加载扩展，浏览器仍会被统计，但只能记到浏览器应用本身，无法精确到网页或站点。

## 环境要求

- Windows
- Node.js 20+
- npm 可用
- 如需本机打包 exe，需要安装 Visual Studio 2022 Build Tools，并勾选“使用 C++ 的桌面开发”

## 安装与运行

```powershell
npm install
```

```powershell
npm start
```

`npm start` 会以脱离终端的方式启动应用，因此关闭当前 PowerShell 窗口后应用仍会继续运行。

如果你需要前台日志用于调试：

```powershell
npm run start:dev
```

打包：

```powershell
npm run pack
npm run dist
```

- `npm run dist`：生成安装包（NSIS）
- `npm run dist:portable`：生成便携版单文件 exe，适合直接分发
- `npm run dist:installer`：只生成安装包 exe

打包产物默认在 `dist/` 目录下。若你要“发一个 exe 给别人直接双击运行”，优先使用 `npm run dist:portable`。

仓库已包含 GitHub Actions 工作流：推送到 `main` 后会自动在 GitHub Actions 中构建 Windows 安装版 exe 和便携版 exe。构建完成后，可在对应 workflow run 的 Artifacts 中下载。

如果推送形如 `v1.1.1` 的 tag，工作流还会自动创建同名 GitHub Release，并把以下文件直接挂到 Release 附件：

- `App-Usage-Tracker-1.1.1-installer.exe`
- `App-Usage-Tracker-1.1.1-portable.exe`

普通分支构建的 Actions Artifacts 也会按版本号命名，例如 `app-usage-tracker-1.1.1-windows`。

如果打包时报错 `Could not find any Visual Studio installation to use`，说明当前机器缺少 C++ 构建工具。这个项目依赖 `active-win`，在打包 Electron 应用时需要为 Electron 版本重编译原生模块。

应用启动后：

- 点击最小化会隐藏到托盘
- 点击关闭不会直接退出，而是隐藏到托盘
- 单击托盘图标可切换显示/隐藏主窗口
- 右键托盘图标可显示主窗口、切换开机自启动、退出程序
- 右上角“设置”可进入独立设置页

应用运行时会监听本地 bridge：

```text
http://127.0.0.1:32123/v1/browser-event
```

## 浏览器扩展加载

以 Chrome / Edge 为例：

1. 打开扩展管理页
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 选择仓库中的 `browser-extension` 目录

扩展加载完成后，浏览器当前活动标签页会被持续上报到桌面端。

## 数据位置

- 使用数据：`%APPDATA%/app-usage-tracker/usage-data.json`
- 图标缓存：`%APPDATA%/app-usage-tracker/icon-cache/`
- Windows 运行时窗口图标、托盘图标、打包图标当前都使用根目录的 `app.ico`

## 已知限制

- 当前主要面向 Windows
- Firefox 目前只有桌面端窗口识别，附带扩展源码按 Chromium 扩展接口实现，直接可用的是 Chrome / Edge / Brave / Opera
- 同服务合并目前只对内置规则生效，不是任意网站和任意桌面应用都自动合并
- 如果你手动打开 `favicon.ico`、图片、资源文件地址，这类资源页本身也可能被记录为最近访问内容
- 部分网站如果没有标准 favicon、网络不可达，或系统无法提取可执行文件图标时，会回退到首字母占位

## 开发说明

- 主进程代码：`src/main`
- 渲染层代码：`src/renderer`
- 浏览器扩展：`browser-extension`
- 脱离终端启动脚本：`scripts/start-detached.js`
