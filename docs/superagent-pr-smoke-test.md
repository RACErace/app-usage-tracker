# Superagent 草稿 PR 提交测试说明

本文是一份用于验证 Superagent 接单、独立分支提交和创建 PR 的测试说明。

测试仓库为 `RACErace/app-usage-tracker`，代理账号为 `race-dsh-superagent`，所有 PR 均由人手动合并。

## 测试范围

本次测试只验证 Superagent 的接单、独立分支提交与草稿 PR 创建流程，不涉及业务代码、依赖、配置或用户数据的改动。

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 测试仓库 | `RACErace/app-usage-tracker` |
| 代理账号 | `race-dsh-superagent` |
| 分支规则 | 使用 `agent/` 前缀的独立分支 |
| 合并方式 | 所有 PR 均由人手动合并 |

## 说明

- 本文档仅用于流程验证，不包含任何密钥、令牌、个人邮箱、本机路径或聊天标识。
- 由本文档发起的测试 PR 保持草稿状态，仅用于人工检查提交与 PR 流程是否符合预期；不会启用自动合并，也不会由代理自行合并或关闭。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

## PR 处理流程验证

- 验证编号：`PR-BRANCH-UPDATE-20261101`
- 本次修改提交到现有 PR 分支，PR 保持草稿，未合并到 main；Issue 直接提交 main 属于另一条处理流程。
