# 贡献 tcode

感谢你帮助改进 tcode。这个项目刻意保持小而清晰，因此贡献时请优先保持运行时可读、可调试、可定制。

## 原则

- 优先提交聚焦的小改动，避免大范围无关重构。
- 保持 agent loop 和工具模型容易理解。
- 新增抽象前先参考现有模式。
- 保留写入前 review 和权限边界。
- 行为或工作流变化时同步更新文档。
- 尽量使用 `npx tsc --noEmit` 验证 TypeScript 类型。

## 开发环境

```bash
npm install
npm start
```

运行类型检查：

```bash
npx tsc --noEmit
```

使用 mock 模式运行：

```bash
TCODE_MODEL_MODE=mock npm start
```

## PR 建议

一个好的 PR 通常包含：

- 用户可感知行为的简短说明
- 为什么需要这个改动
- 如果涉及权限、文件写入或命令执行，请说明影响
- 验证步骤，包括类型检查或 TUI 手动检查
- 新命令、新工具或新配置对应的文档更新

请不要把无关重构和功能改动混在同一个 PR 里。

## 需要特别小心的区域

### Agent Loop

`src/agent-loop.ts` 会影响回合结束、工具执行、重试和 tracing。修改时请保持控制流显式，不要引入难以观察的隐式状态。

### Tools

新增工具时请确保：

- 工具名稳定
- 使用 Zod 校验输入
- 返回标准化 `ToolResult`
- 读写文件或执行本地命令时接入权限检查
- 在 `src/tools/index.ts` 注册
- 更新 `README.md` 和 `README.zh-CN.md`

### Permissions

不要绕过 `PermissionManager` 做文件写入、工作区外路径访问或危险命令执行。任何会影响本地状态的新能力，都应该接入现有审批模型。

### TUI

当前 TUI 使用原生 stdin/stdout 和 ANSI 控制序列。渲染函数应尽量保持确定性，不要把长耗时逻辑混入渲染代码。

### Tracing

Tracing 用于解释 agent 行为，不应该改变行为。记录内容要有用但克制，并避免记录敏感信息。

## 文档

新增功能时，请根据影响更新：

- `README.md`
- `README.zh-CN.md`
- `ARCHITECTURE.md`
- `ARCHITECTURE_ZH.md`
- `ROADMAP.md`
- `ROADMAP_ZH.md`

## 许可证

提交贡献即表示你同意贡献内容遵循本仓库许可证。
