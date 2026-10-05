<!--
SPDX-FileCopyrightText: 2026 K_PU
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# 安全政策

本文档是 [English Security Policy](SECURITY.md)的简体中文版本。两者内容如有出入，**以英文版为准**。

扩展的一般说明见 [README.zh-cn.md](README.zh-cn.md)。

## 支持的版本

安全修复只进入最新发布版本，不回溯到旧版本。

本扩展每个版本都捆绑原生引擎二进制，因此**请始终使用最新版本**。安全更新通常与常规功能更新一并发版。

## 报告漏洞

**请勿通过公开 Issue 报告安全漏洞。**

请通过以下任一渠道私下报告：

- GitHub 私密漏洞报告：[https://github.com/XKPU/sqlite-libsql-preview-edit/security/advisories/new](https://github.com/XKPU/sqlite-libsql-preview-edit/security/advisories/new)
- 邮箱：`csaxongmail@gmail.com` 或 `u-eptm@u-eptm.top`

### 请在报告中包含

1. **受影响的版本**，以及操作系统与架构。
2. **问题描述**及其影响（例如：任意代码执行、越权读取文件）。
3. **复现步骤**，最好附一个最小化的数据库文件。
4. **可能的修复方案**（如有）。

### 我们的响应流程

- **确认收到** —— 通常在 7 天内答复。
- **评估与修复** —— 确认问题后，在私下处理的同时准备修复。
- **公开披露** —— 修复发布后通过 GitHub 安全公告公开，并注明报告者（除非你希望匿名）。

在修复发布前，请勿公开披露该问题。

## 许可
```
SQLite/LibSQL/Turso P&E - VS Code extension for SQLite/LibSQL database preview and editing.  
Copyright (C) 2026  K_PU

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
```