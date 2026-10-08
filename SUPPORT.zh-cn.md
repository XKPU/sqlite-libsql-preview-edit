<!--
SPDX-FileCopyrightText: 2026 K_PU
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# 支持

本文档是 [English support document](SUPPORT.md)的简体中文版本。两者内容如有出入，**以英文版为准**。

扩展的一般说明见 [README.zh-cn.md](README.zh-cn.md)。

## 目录

- [提问之前](#提问之前)
- [报告缺陷与建议](#报告缺陷与建议)
- [不在支持范围内](#不在支持范围内)
- [安全](#安全)
- [参与贡献](#参与贡献)
- [许可](#许可)

## 提问之前

下面覆盖最常见的问题。

### 我的平台加载不了扩展

仅支持 4 种架构，见 README 的 [驱动](README.zh-cn.md#驱动)一节。

| 系统 | 架构 |
| --- | --- |
| Windows | x64 |
| macOS | Apple 芯片（`arm64`） |
| Linux | x64、`arm64`（glibc） |

Intel macOS、Alpine/musl 以及 Windows `arm64` 不受支持。内置引擎确实为它们提供了二进制，但本扩展从未宣称支持、也未测试过这些平台，因此不会为它们构建 VSIX。

### 锁冲突：提示 "database is locked"

引擎为 SQLite（经由 libSQL C 分支），采用 **normal** 锁模式，因此与其他进程协作而非排斥：其他程序打开数据库时仍可正常读写，WAL 与 rollback-journal 模式皆然。（此前的引擎以 `locking_mode = exclusive` 打开文件，即使在 WAL 下也会阻塞所有其他进程 —— 此问题已修复。）

若其他程序正处于事务中，扩展只会短暂等待锁（250 毫秒），随后以明确的 `database is locked` 错误失败，而不会把没写成功的事情报成成功。等待更久并无帮助：若某服务一直持着未提交的事务，无论预算多大结果都相同，短等待只是免去你的卡顿。待对方进程结束后重试即可。只读模式（`libSqlPreviewEdit.readOnly`）则完全不会获取写锁。

### 提示 "Extension updated — reload the window to finish"

安装或升级**不会重启已打开的窗口**。执行 **Developer: Reload Window** 后该提示即消失。

### 显示出的方言不对

`.db`、`.sqlite`、`.sqlite3`、`.libsql`、`.turso` 均受支持。**驱动**始终是内置的原生引擎（`libsql`，即 SQLite 的 libSQL C 分支）；**方言**表示文件内容，而非实际加载的实现。详见[驱动与方言](README.zh-cn.md#驱动与方言)。

### 在 Intel 芯片的 macOS 上使用

官方不为 macOS Intel（`darwin-x64`）打包 VSIX，因为该平台既未宣称支持、也未经过测试。引擎本身提供 `darwin-x64` 二进制，因此你可以自行打包 VSIX，它可以在你的机器上正常工作：

1. 安装 [Node.js](https://nodejs.org/) 20 或更新版本（npm 随 Node 一起提供）。
2. 获取源码：`git clone https://github.com/XKPU/sqlite-libsql-preview-edit.git`，然后 `cd sqlite-libsql-preview-edit`。
3. 安装依赖 —— 这一步会同时下载 `darwin-x64` 引擎二进制：`npm install`。
4. 构建扩展与 webview：`npm run compile`。
5. 打包 VSIX：`node node_modules/@vscode/vsce/vsce package --target darwin-x64`（或将 `vsce` 加入 PATH 后运行 `vsce package --target darwin-x64`）。输出为项目根目录下的 `sqlite-libsql-preview-edit-<版本>-darwin-x64.vsix`。
6. 安装：**扩展视图 → … 菜单 → 从 VSIX 安装…**，或执行 `code --install-extension sqlite-libsql-preview-edit-<版本>-darwin-x64.vsix`。

安装前可以先校验包内容：`node scripts/verify-vsix.js sqlite-libsql-preview-edit-<版本>-darwin-x64.vsix`。

### 出错了，我需要详细日志

打开输出通道 **SQLite/LibSQL/Turso P&E**（查看 → 输出）。它记录了 webview 与宿主之间**双向**的每一条消息，包括错误。

## 报告缺陷与建议

缺陷报告、功能建议与使用疑问，请提到同一个 issue 区：<https://github.com/XKPU/sqlite-libsql-preview-edit/issues>

- **报缺陷** —— 说明是什么缺陷。
- **提需求** —— 说明是什么需求。
- **求助** —— 说明卡在哪里。
- **不分类** —— 可以，无需预先归类。

### 一份有用的缺陷报告通常包含

1. **你做了什么** —— 导致问题的操作步骤。
2. **预期结果**与**实际结果**。
3. **环境** —— 操作系统与架构、VS Code 版本、扩展版本。
4. **输出通道日志**（若为运行期问题）。可只摘取相关行 —— 日志较啰嗦，请裁剪到出错的那一步。
5. **最小化的数据库文件**（若问题与特定数据有关）。只要包含问题结构的小 `.db` 即可。

也可以改为**描述出错的功能**，或在缺少项目时说明情况。

> **请勿附带含有个人或机密数据的数据库。**

## 不在支持范围内

- **网络数据库。** 本扩展是本地文件的预览与编辑工具，不支持连接任何远程服务器。
- **不受支持的架构。** 见[上表](#我的平台加载不了扩展)。
- **嵌入式副本（Embedded replicas）。** 属于 Turso Cloud 功能，因此显示为不可用。

## 安全

发现安全问题请**不要**开公开 issue。可通过以下任一渠道私下报告：

- GitHub [安全公告](https://github.com/XKPU/sqlite-libsql-preview-edit/security/advisories/new)表单
- 邮箱：`csaxongmail@gmail.com` 或 `u-eptm@u-eptm.top`

更详细的内容见[SECURITY](SECURITY.zh-cn.md)。

## 参与贡献

欢迎参与贡献。

提交前**尽量**先跑一遍本地检查，以便评审专注于改动本身。

**未运行测试、或只有半成品代码与想法**的提交同样可以接受，请在提交时说明其未经测试。

## 许可

```
SQLite/LibSQL/Turso P&E - VS Code extension for SQLite/LibSQL database preview and editing.  
Copyright (C) 2026  K_PU

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
```