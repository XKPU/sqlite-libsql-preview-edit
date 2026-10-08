<!--
SPDX-FileCopyrightText: 2026 K_PU
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# SQLite/LibSQL/Turso P&E

![SQLite/LibSQL/Turso P&E](icons/sqlite-libsql-preview-edit-64.png)

[![版本](https://img.shields.io/github/v/release/XKPU/sqlite-libsql-preview-edit?logo=github)](https://github.com/XKPU/sqlite-libsql-preview-edit/releases/latest)
[![许可证: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--only-green?logo=data:image/svg+xml;base64,PHN2ZyB0PSIxNzg2ODczMTA1MjgwIiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9IjY2MzEiIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIj48cGF0aCBkPSJNNTEyIDE2QzIzOC4wNjYgMTYgMTYgMjM4LjA2NiAxNiA1MTJzMjIyLjA2NiA0OTYgNDk2IDQ5NiA0OTYtMjIyLjA2NiA0OTYtNDk2Uzc4NS45MzQgMTYgNTEyIDE2eiBtMCA4OTZjLTIyMS4wNjQgMC00MDAtMTc4LjkwMi00MDAtNDAwIDAtMjIxLjA2MiAxNzguOTAyLTQwMCA0MDAtNDAwIDIyMS4wNjQgMCA0MDAgMTc4LjkwMiA0MDAgNDAwIDAgMjIxLjA2NC0xNzguOTAyIDQwMC00MDAgNDAweiBtMjE0LjcwMi0yMDIuMTI4Yy0xOS4yMjggMTkuNDI0LTkxLjA2IDgyLjc5Mi0yMDguMTMgODIuNzkyLTE2NC44NiAwLTI4MC45NjgtMTIyLjg1LTI4MC45NjgtMjgzLjEzNCAwLTE1OC4zMDQgMTIwLjU1LTI3OC44MDIgMjc5LjUyNC0yNzguODAyIDExMS4wNjIgMCAxNzcuNDc2IDUzLjI0IDE5NS4xODYgNjkuNTU4YTIzLjkzIDIzLjkzIDAgMCAxIDMuODcyIDMwLjY0NGwtMzYuMzEgNTYuMjI2Yy03LjY4MiAxMS45LTIzLjkzMiAxNC41NjQtMzQuOTk4IDUuODQyLTE3LjE5LTEzLjU1Mi02My42MjgtNDUuMDc2LTEyMy40MTYtNDUuMDc2LTk2LjYwNiAwLTE1NS44MzIgNzAuNjYtMTU1LjgzMiAxNjAuMTY0IDAgODMuMTc4IDUzLjc3NiAxNjcuMzg0IDE1Ni41NTQgMTY3LjM4NCA2NS4zMTQgMCAxMDMuNjg2LTM4LjA3OCAxMzEuNDUyLTU0LjQ1IDEwLjU0LTkuNzE0IDI3LjE5Mi04LjA3OCAzNS42NCAzLjQ3NmwzOS43MyA1NC4zNGEyMy44OTQgMjMuODk0IDAgMCAxLTIuMzA0IDMxLjAzNnoiIGZpbGw9IiNmZmZmZmYiIHAtaWQ9IjY2MzIiPjwvcGF0aD48L3N2Zz4=)](LICENSE)

[English](README.md) | [简体中文](README.zh-cn.md)

一个 VS Code 扩展，用于预览和编辑 **SQLite / LibSQL / Turso** 数据库文件。

> [!WARNING]
> **早期开发阶段。** 本项目尚处于早期阶段：问题较多，行为与配置的更新频率较快。请在依赖它之前斟酌使用。

## 目录

- [驱动](#驱动)
- [功能](#功能)
- [支持的数据库](#支持的数据库)
- [设置](#设置)
- [诊断](#诊断)
- [AI 声明](#ai-声明)
- [支持](#支持)
- [许可](#许可)

## 驱动

扩展运行于内置的 **原生 libSQL 驱动**（`libsql`，即 SQLite 的 libSQL C 分支，以 npm 模块形式打包）。
它直接打开本地文件，并读写通用的 `SQLite format 3` 容器格式，因此同一个编辑器即可处理 **SQLite、LibSQL 与 Turso Database** 三种文件。

这是唯一的驱动，所有文件都由它处理。驱动与该标签的区别见[驱动与方言](#驱动与方言)。

支持的架构：

| 系统 | 架构 |
| --- | --- |
| Windows | x64 |
| macOS | Apple 芯片（`arm64`） |
| Linux | x64、`arm64`（glibc） |

Intel macOS、Alpine/musl 以及 Windows `arm64` **不受支持**。
若你的平台不在列表中，扩展将无法加载驱动，任何数据库都无法打开。

## 功能

- `.db` / `.sqlite` / `.sqlite3` / `.libsql` / `.turso` 文件（见[支持的数据库](#支持的数据库)）
- 基于 libSQL 引擎（SQLite 的 C 分支），因此标准特性集均可用：`STRICT` 表、`ALTER TABLE … RENAME COLUMN` / `DROP COLUMN`、`RETURNING`、UPSERT，以及带非常量默认值的 `ADD COLUMN`
- LibSQL/Turso 文件可以使用 `vector_*` 系列函数 —— 它们由 libSQL 引擎本身实现
- 原先只有 Turso Database 才提供的特性**不再可用**：`CREATE SEQUENCE` / `nextval()` 与 `ALTER TABLE … ALTER COLUMN`（例如 `near "SEQUENCE": syntax error`）
- 使用这些特性的文件仍可正常打开与浏览；只有执行这类语句会失败
- 自动方言检测（SQLite、LibSQL 或 Turso Database）
- UI 跟随 VS Code 主题颜色
- 数据浏览器
- SQL 语句编辑器
- 导出 `sql` / `csv` / `json`，导入 `csv` / `json`
- 只读模式
- 英语和简体中文

## 支持的数据库

支持三种文件类型，它们共用同一种磁盘容器（`SQLite format 3`）：

| 类型 | 常见扩展名 | 识别方式 |
| --- | --- | --- |
| SQLite | `.db` `.sqlite` `.sqlite3` | 无其他信号时的默认值 |
| LibSQL | `.libsql` | 扩展名、版本字符串、`libsql_*` 表或 pragma |
| Turso Database | `.turso` | 扩展名或版本字符串 |

由于容器相同，**三种文件都能直接打开 —— 识别结果从不决定文件能否打开**，它只决定所显示的语言。

### 驱动与方言

信息面板显示两个彼此独立的字段。

**驱动（Driver）** —— 实际执行查询的实现，取值始终为 `libsql`：内置的 libSQL 引擎是唯一驱动，不存在回退。

**方言（Dialect）** —— 文件所用的 SQL 方言，由文件自身推断得出，取值为 `SQLite`、`LibSQL` 或 `Turso Database`。

方言仅用于显示说明：它不决定使用哪个驱动，不启用或禁用任何能力，也不影响语句的执行方式 —— 所有文件都由同一个驱动、以同一套功能集处理。`.db` 文件被显示为 `SQLite`，只是因为它描述的是文件内容，其执行方式与 `.turso` 文件完全相同。

信息面板中标注为 **Engine** 的一行，显示的就是方言值。

### 检测

取**最强的单个信号**决定，权重不累加 —— 一个确凿标记即足够，零散线索无法压倒它。

| 信号 | 权重 |
| --- | --- |
| 版本字符串（Turso 标识） | 80 |
| 版本字符串（LibSQL 标识） | 80 |
| LibSQL 系统表 | 75 |
| 引擎 pragma | 70 |
| 文件扩展名（`.libsql` / `.turso`） | 60 |

Turso 版本字符串**先于** LibSQL 检测，因为 LibSQL 的匹配模式也能命中 `turso`，
否则会被误判为 LibSQL。

无任何信号匹配时按普通 SQLite 处理。判定结果连同依据会显示在数据库信息面板中。

## 设置

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `libSqlPreviewEdit.language` | `auto` | `auto`（跟随 VS Code）、`en` 或 `zh-cn`。变更实时生效。 |
| `libSqlPreviewEdit.pageSize` | `50` | 数据浏览器每页显示的行数。 |
| `libSqlPreviewEdit.readOnly` | `false` | 禁用所有写操作。 |
| `libSqlPreviewEdit.readOnlyTables` | `[]` | 即使全局写入开关已启用，这些表也应按只读方式处理。 |
| `libSqlPreviewEdit.confirmDestructiveActions` | `true` | 删除表、视图、索引、列前请求确认。 |
| `libSqlPreviewEdit.nullDisplay` | `NULL` | 用于显示 SQL NULL 值的文本。 |
| `libSqlPreviewEdit.maxCellLength` | `1000` | 超过此长度的单元格将被截断。 |
| `libSqlPreviewEdit.exportEncoding` | `utf8` | 导出文件时使用的编码。 |

## 诊断

扩展写入一个名为 **SQLite/LibSQL/Turso P&E** 的专用 VS Code Output 通道。

- 通过 **输出 → SQLite/LibSQL/Turso P&E** 打开。
- 记录双方通信：主机收到的请求（`-> host received:`）、发送的响应（`<- host sending:`）、webview 端诊断（`[webview] …`）以及任何未识别消息。

### 安装新构建后

安装或升级扩展不会重启已打开窗口的扩展主机。**重载窗口**（`Developer: Reload Window`）以完成更新。在此之前编辑器可能报告：

> Extension updated — reload the window to finish

## AI 声明

本项目在研发、测试、文档与维护中广泛使用 AI 辅助工具，主要用于代码生成和文档改进。

所有 AI 生成或建议的内容均经人工审核、验证并按需调整。

AI 的使用不改变本项目的开源许可证及第三方条款。

以下为中奖名单（以使用量排名）：
- GLM 5.3 Flash
- DeepSeek v4.1 Flash
- GPT 6.1 Sol
- DeepSeek v4 Pro
- GLM 5.3
- GPT 6 Astra
- MiMo V2.6 Flash
- Kimi K3
- Claude Opus 5.5
- Hy4 preview
- GLM 5.2
- Hy3

## 支持

获取帮助、报告缺陷，以及不在支持范围内的事项：**[SUPPORT.zh-cn.md](SUPPORT.zh-cn.md)**
（[English](SUPPORT.md)）。

报告安全漏洞：**[SECURITY.zh-cn.md](SECURITY.zh-cn.md)**（[English](SECURITY.md)）。

## 许可
```
SQLite/LibSQL/Turso P&E - VS Code extension for SQLite/LibSQL database preview and editing.  
Copyright (C) 2026  K_PU

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
```