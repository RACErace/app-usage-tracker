# App Usage Tracker

一个仿照手机“使用统计”界面的桌面应用，用于统计 Windows 电脑上的应用使用时长；当目标应用是浏览器时，可通过附带的 Chrome / Edge 扩展识别到具体网页。

## 功能

- 统计当前前台应用的使用时长
- 支持每天视图与近 7 天视图
- 支持应用排行与详情页
- 浏览器场景下可识别具体网页标题、域名、URL
- 最小化和关闭窗口后常驻系统托盘
- 支持通过托盘菜单切换开机自启动
- 本地存储数据，不依赖云服务

## 技术方案

### 桌面端

- Electron 作为桌面壳
- 主进程通过 active-win 轮询当前活动窗口
- 使用本地 JSON 文件持久化统计数据
- 内置一个本地 HTTP bridge，接收浏览器扩展发来的活动标签页信息
- 通过 Electron Tray 常驻系统托盘
- 通过 app.setLoginItemSettings 管理 Windows 开机自启动

### 浏览器识别

Windows 本身只能稳定拿到浏览器窗口标题，拿不到完整 URL。要实现“识别具体网页”，这里采用桌面端 + 浏览器扩展协同：

1. 桌面端检测当前前台窗口是否为 Chrome / Edge / Brave / Opera / Firefox 这一类浏览器。
2. 浏览器扩展把当前活动标签页的标题和 URL 发给本地 bridge。
3. 桌面端把两边数据合并，最终把浏览器使用时间记到具体网页上。

如果不加载扩展，浏览器仍然会被统计，但只能记到浏览器应用本身，而不是具体页面。

## 目录结构

```text
src/
  main/
    main.js
    preload.js
    tracker.js
  renderer/
    index.html
    styles.css
    app.js
browser-extension/
  manifest.json
  service-worker.js
```

## 安装与运行

### 1. 安装 Node.js

请先安装 Node.js 20 或更高版本，并确保 node 和 npm 在 PATH 中可用。

### 2. 安装依赖

```powershell
npm install
```

### 3. 启动桌面端

```powershell
npm start
```

启动后行为如下：

- 点击最小化，会隐藏到系统托盘
- 点击窗口关闭按钮，不会退出，而是隐藏到系统托盘
- 右键托盘图标，可以显示主窗口、切换开机自启动、退出程序
- 单击托盘图标，可在显示与隐藏主窗口之间切换

应用启动后，会在本地监听：

```text
http://127.0.0.1:32123/v1/browser-event
```

### 4. 加载浏览器扩展

以 Chrome / Edge 为例：

1. 打开扩展管理页。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择项目里的 browser-extension 目录。

扩展加载完成后，只要桌面端在运行，浏览器当前活动网页就会被上报给桌面端。

## 数据存储

统计数据保存在 Electron userData 目录中的 usage-data.json。

常见位置：

- Windows: `%APPDATA%/App Usage Tracker` 或 Electron 默认的用户数据目录

## 当前限制

- 当前主要面向 Windows。
- Firefox 页面识别目前只有桌面端窗口识别，附带扩展源码按 Chromium 扩展接口实现，直接可用的是 Chrome / Edge / Brave / Opera。
- 没有接入真实应用图标，因此列表图标使用的是应用或网页名称首字。
- 数据目前以本地 JSON 保存，后续如果数据量变大，建议迁移到 SQLite。

## 可继续扩展的方向

- 增加应用分类、限制提醒、专注模式
- 将 JSON 存储迁移为 SQLite
- 为浏览器扩展增加连接状态提示
- 增加 CSV / JSON 导出
