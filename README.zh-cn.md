<!--
SPDX-FileCopyrightText: 2026 K_PU
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# SQLite/LibSQL Preview&Edit

![SQLite/LibSQL Preview&Edit](icons/sqlite-libsql-preview-edit-64.png)

[![版本](https://img.shields.io/github/v/release/XKPU/sqlite-libsql-preview-edit?logo=github)](https://github.com/XKPU/sqlite-libsql-preview-edit/releases/latest)
[![许可证: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--only-green?logo=data:image/svg+xml;base64,PHN2ZyB0PSIxNzg2ODczMTA1MjgwIiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9IjY2MzEiIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIj48cGF0aCBkPSJNNTEyIDE2QzIzOC4wNjYgMTYgMTYgMjM4LjA2NiAxNiA1MTJzMjIyLjA2NiA0OTYgNDk2IDQ5NiA0OTYtMjIyLjA2NiA0OTYtNDk2Uzc4NS45MzQgMTYgNTEyIDE2eiBtMCA4OTZjLTIyMS4wNjQgMC00MDAtMTc4LjkwMi00MDAtNDAwIDAtMjIxLjA2MiAxNzguOTAyLTQwMCA0MDAtNDAwIDIyMS4wNjQgMCA0MDAgMTc4LjkwMiA0MDAgNDAwIDAgMjIxLjA2NC0xNzguOTAyIDQwMC00MDAgNDAweiBtMjE0LjcwMi0yMDIuMTI4Yy0xOS4yMjggMTkuNDI0LTkxLjA2IDgyLjc5Mi0yMDguMTMgODIuNzkyLTE2NC44NiAwLTI4MC45NjgtMTIyLjg1LTI4MC45NjgtMjgzLjEzNCAwLTE1OC4zMDQgMTIwLjU1LTI3OC44MDIgMjc5LjUyNC0yNzguODAyIDExMS4wNjIgMCAxNzcuNDc2IDUzLjI0IDE5NS4xODYgNjkuNTU4YTIzLjkzIDIzLjkzIDAgMCAxIDMuODcyIDMwLjY0NGwtMzYuMzEgNTYuMjI2Yy03LjY4MiAxMS45LTIzLjkzMiAxNC41NjQtMzQuOTk4IDUuODQyLTE3LjE5LTEzLjU1Mi02My42MjgtNDUuMDc2LTEyMy40MTYtNDUuMDc2LTk2LjYwNiAwLTE1NS44MzIgNzAuNjYtMTU1LjgzMiAxNjAuMTY0IDAgODMuMTc4IDUzLjc3NiAxNjcuMzg0IDE1Ni41NTQgMTY3LjM4NCA2NS4zMTQgMCAxMDMuNjg2LTM4LjA3OCAxMzEuNDUyLTU0LjQ1IDEwLjU0LTkuNzE0IDI3LjE5Mi04LjA3OCAzNS42NCAzLjQ3NmwzOS43MyA1NC4zNGEyMy44OTQgMjMuODk0IDAgMCAxLTIuMzA0IDMxLjAzNnoiIGZpbGw9IiNmZmZmZmYiIHAtaWQ9IjY2MzIiPjwvcGF0aD48L3N2Zz4=)](LICENSE)

[English](README.md) | [简体中文](README.zh-cn.md)

一个 VS Code 扩展，用于预览和编辑 **SQLite / LibSQL** 数据库文件。

### 支持

- `.db` / `.sqlite` / `.sqlite3` / `.libsql` 文件
- 标准 SQLite 功能集
- 自动 LibSQL 检测
- UI 跟随 VS Code 主题颜色
- 数据浏览器
- SQL 语句编辑器
- 导出 `sql` / `csv` / `json`，导入 `csv` / `json`
- 只读模式
- 英语和简体中文

## LibSQL 检测

默认 `SQLite`，检测按信号强度从高到低读取检测 `LibSQL`：

| 信号 | 权重 |
| --- | --- |
| 引擎版本字符串 | 80 |
| LibSQL 系统表 | 75 |
| 引擎 pragma | 70 |
| 文件扩展名 | 60 |

检测到 LibSQL 后，扩展启用 LibSQL 能力集。

## 设置

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `libSqlPreviewEdit.language` | `auto` | `auto`（跟随 VS Code）、`en` 或 `zh-cn`。变更实时生效。 |
| `libSqlPreviewEdit.pageSize` | `50` | 数据浏览器每页显示的行数。 |
| `libSqlPreviewEdit.readOnly` | `false` | 禁用所有写操作。 |
| `libSqlPreviewEdit.confirmDestructiveActions` | `true` | 删除表、视图、索引、列前请求确认。 |
| `libSqlPreviewEdit.nullDisplay` | `NULL` | 用于显示 SQL NULL 值的文本。 |
| `libSqlPreviewEdit.maxCellLength` | `1000` | 超过此长度的单元格将被截断。 |
| `libSqlPreviewEdit.exportEncoding` | `utf8` | 导出文件时使用的编码。 |

## 诊断

扩展写入一个名为 **SQLite/LibSQL Preview&Edit** 的专用 VS Code Output 通道。

- 通过 **输出 → SQLite/LibSQL Preview&Edit** 打开。
- 记录双方通信：主机收到的请求（`-> host received:`）、发送的响应（`<- host sending:`）、webview 端诊断（`[webview] …`）以及任何未识别消息。

### 安装新构建后

安装或升级扩展不会重启已打开窗口的扩展主机。**重载窗口**（`Developer: Reload Window`）以完成更新。在此之前编辑器可能报告：

> Extension updated — reload the window to finish

## 许可
```
SQLite/LibSQL Preview&Edit - VS Code extension for SQLite/LibSQL database preview and editing.  
Copyright (C) 2026  K_PU

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
```