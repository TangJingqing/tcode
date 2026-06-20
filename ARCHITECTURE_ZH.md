# tcode 架构说明

一个面向本地开发工作流的轻量级终端编码助手。

tcode 用更小的实现体量，提供了类 Claude Code 的工作流体验和架构思路，因此非常适合学习、实验，以及继续做自己的定制化开发。

## 项目简介

tcode 围绕一个实用的 terminal-first agent loop 构建：

- 接收用户请求
- 检查当前工作区
- 在需要时调用工具
- 修改文件前先 review
- 在同一个终端会话里返回最终结果

整个项目有意保持紧凑，这样主控制流、工具模型和 TUI 行为都更容易理解和扩展。

## 目录

- [为什么选择 MiniCode](#为什么选择-minicode)
- [功能特性](#功能特性)
- [安装](#安装)
- [快速开始](#快速开始)
- [命令](#命令)
- [配置](#配置)
- [项目结构](#项目结构)
- [架构文档](#架构文档)
- [开发说明](#开发说明)

## 为什么选择 tcode

如果你希望得到下面这些东西，tcode 会很合适：

- 一个轻量级 coding assistant，而不是庞大的平台
- 一个带 tool calling、transcript 和命令工作流的终端 UI
- 一个很适合阅读和二次开发的小代码库
- 一个可用于学习类 Claude Code agent 架构的参考实现

## 功能特性

### 核心工作流

- 单轮支持多步工具执行
- `model -> tool -> model` 闭环
- 全屏终端交互界面
- 输入历史、transcript 滚动和 slash 命令菜单

### 内置工具

- `list_files`
- `grep_files`
- `read_file`
- `write_file`
- `edit_file`
- `patch_file`
- `modify_file`
- `run_command`

### 安全性与可用性

- 文件修改前先 review diff
- 路径和命令权限检查
- 独立配置目录和交互式安装器
- 支持 Anthropic 风格接口

### 最近交互改进

- 审批对话支持上下键选择与 Enter 确认（不再依赖字母键）
- 支持“拒绝并给模型反馈”，可直接把修正建议发回模型
- 编辑审批支持“本轮允许此文件”与“本轮允许全部编辑”
- diff 预览改为标准 unified diff（更接近 `git diff`）
- 审批页面支持 `Ctrl+O` 展开/收起与滚轮/分页滚动
- 工具调用结果自动折叠为摘要，减少 transcript 噪音

## 安装

```bash
cd mini-code
npm install
npm run install-local
```

安装器会询问：

- 模型名称
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_AUTH_TOKEN`

配置保存在：

- `~/.tcode/settings.json`

启动命令安装到：

- `~/.local/bin/tcode`

如果 `~/.local/bin` 不在你的 `PATH` 中，可以添加：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## 快速开始

运行安装后的命令：

```bash
minicode
```

本地开发模式：

```bash
npm run dev
```

离线演示模式：

```bash
MINI_CODE_MODEL_MODE=mock npm run dev
```

## 命令

### 本地 slash 命令

- `/help`
- `/tools`
- `/status`
- `/model`
- `/model <name>`
- `/config-paths`

### 终端交互能力

- 命令提示与 slash 菜单
- transcript 滚动
- 输入编辑
- 历史输入导航
- 审批界面上下键选择与反馈输入

## 配置

配置示例：

```json
{
  "model": "your-model-name",
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_MODEL": "your-model-name"
  }
}
```

配置优先级：

1. `~/.mini-code/settings.json`
2. 兼容的本地已有配置
3. 当前进程环境变量

## 项目结构

- `src/index.ts`: CLI 入口
- `src/agent-loop.ts`: 多步模型/工具循环
- `src/tool.ts`: 工具注册与执行
- `src/tools/*`: 内置工具集合
- `src/tui/*`: 终端 UI 模块
- `src/config.ts`: 运行时配置加载
- `src/install.ts`: 交互式安装器

## 架构文档

- [Architecture Overview](./ARCHITECTURE.md)
- [中文架构说明](./ARCHITECTURE_ZH.md)

## 开发说明

```bash
npm run check
```

MiniCode 有意保持小而实用。目标是让整体架构足够清晰、易改造、易扩展。
