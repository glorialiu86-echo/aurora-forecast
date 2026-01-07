# Project Agent Rules (Aurora Capture)

This project is actively maintained by a human owner.
The agent must follow these rules strictly.

## General Principles
- Do not modify any files without explicit user confirmation
- Prefer minimal, controlled changes over large refactors
- This is not a refactoring task unless explicitly stated

## Before Coding
- Always summarize your understanding of the task
- List all files you plan to modify or create
- Wait for user confirmation before writing any code

## Code Modification Rules
- Use full function or full block replacement
- Do NOT insert scattered lines into existing code
- Do NOT perform "incidental improvements"
- Do NOT rename variables, functions, or files unless asked

## Scope Control
- Only modify files explicitly approved by the user
- If you think a better solution exists, explain it first and wait

## Language
- User instructions may be written in Chinese
- Keep code, APIs, and technical terms in English

# AGENTS.md — Aurora Capture 项目协作约定

## 1. 分支与部署规则（非常重要）
- main 分支 = 正式生产环境（www）
- staging 分支 = 测试环境
- 所有功能修改 **必须先提交到 staging**
- 未经用户明确确认，不得向 main 提交或合并
- 默认情况下，agent 不得自行执行 git push / git commit，除非用户明确要求或确认

## 2. Staging 行为约束
- staging 的改动用于测试与验收
- staging 分支的 push 会自动部署到 aurora-capture-staging（GitHub Pages）
- staging 页面只允许 UI 标识类差异（如水印），不得引入业务逻辑差异

## 3. 禁止事项（硬约束）
- ❌ 不得修改或新增 main 分支的 CNAME
- ❌ 不得在 aurora-capture-staging 仓库中直接修改任何文件
- ❌ 不得自作主张重构、删除、重排未被点名的模块

## 4. 修改范围控制
- 每次修改前必须先说明：
  - 将修改哪些文件
  - 是否涉及业务逻辑
- 默认采用「整段替换 / 明确 diff」方式，避免零散改动

## 5. 工作方式
- 所有改动默认先给 diff / 方案
- 得到用户“通过 / OK / 可以改”后再提交