# Review Summary

## What changed
- 更新状态词渲染为 statusKey 驱动（zh 直出中文，non-zh 使用英文源进入翻译链路）
- 为 3h/1h/72h 状态词补充 statusKey 与中英映射
- 翻译流程区分 status 元素与普通文本，支持 en -> target 翻译并避免 zh 回退影响状态词

## Files touched
- Modified: model.js, app.js, trans.js, REVIEW.md
- Added:
- Deleted:

## Behavior impact
- 用户可见：zh 界面状态词始终为中文；non-zh + Trans ON 时状态词由英文源翻译为目标语言（例如 ja）
- 明确不变：业务逻辑、数据计算、DOM 结构与其他 UI 布局不变

## Risk assessment
- 可能风险：翻译服务若不支持目标语言或 en 源翻译失败，状态词可能退回英文
- 性能/成本：翻译缓存键增加 source 维度，翻译调用量变化很小
- 部署/环境：无

## How to test
1. Safari 无痕：zh + Trans ON/OFF，状态词始终中文
2. Safari 无痕：ja + Trans ON，状态词显示为日语（从英文源翻译）
3. 普通窗口：清站点数据前后对比，偶发英文不再出现
4. Atlas/Chrome 内核：重复以上矩阵验证

## Rollback plan
- 回退 staging 上本次提交或切换回上一版本

## Open questions / follow-ups
- None
