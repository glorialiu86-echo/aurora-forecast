# Review Summary

## What changed
- 添加最小化的 `data-i18n` 到 `index.html` 现有节点（不改布局/结构）
- 覆盖弹层/模态/分级说明等翻译节点（含 Alert/Overlay、工具介绍、规则说明）
- 工具介绍文本按段落/标题级别补 `data-i18n`（不做整段 innerHTML 翻译）
- `app.js` 的 `safeHTML` 固定中文片段用 `<span data-i18n>` 包裹，变量逻辑保持不变
- 在 `trans.js` 暴露 `applyTranslation()` 与 Trans ON 状态供复用
- 在 `run()` DOM 更新后、弹层打开、工具介绍打开时，Trans ON 触发刷新

## Files touched
- Modified: index.html, app.js, trans.js
- Added: REVIEW.md
- Deleted:

## Behavior impact
- What user-visible behavior changed
  - Trans ON：更多静态/动态文本可翻译
  - Trans OFF：文案保持中文
- What explicitly did NOT change
  - 不改数据源、计算逻辑、业务逻辑
  - 不调整 `index.html` 布局结构
  - 模型输出仍为中文，仅 UI 层翻译（本轮有意取舍）

## Risk assessment
- Possible failure modes
  - 遗漏 `data-i18n` 导致局部未翻译
  - `safeHTML` 包裹不当导致 HTML 结构异常
  - Trans OFF 判断错误导致误刷新
- Performance / cost / quota impact
  - Trans ON 时翻译请求略增
- Deployment or environment risks
  - 仅影响 UI 翻译表现

## How to test
1. Safari 打开页面，切换 Trans ON
2. 首屏/结论区/72h 分级说明应被翻译
3. 切换 1h/3h/72h，新增文本可翻译
4. 打开“工具介绍”与数据可信度弹层，文案可翻译
5. Trans OFF，全部恢复中文

## Rollback plan
- 回滚或撤销 `index.html`、`app.js`、`trans.js` 改动

## Open questions / follow-ups
- None.
