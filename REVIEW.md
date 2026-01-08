# Review Summary

## What changed
- Planned: add fixed i18n map for specific short UI terms and status labels to bypass machine translation
- Planned: route selected status labels in Upstream live card and geo section through fixed mapping
- Planned: add special-case rule for destination coordinate help text (zh keeps Chinese, non-zh uses fixed English)
- Planned: ensure Trans ON/OFF and language changes re-apply the fixed and special-case rules consistently
- Documented final canonical English for status/notice phrases to drive FIXED_I18N_MAP

## Files touched
- Modified: trans.js, app.js, index.html
- Added:
- Deleted:

## Behavior impact
- User-visible: specific UI labels (cloud cover, moon altitude, updated, data freshness, solar wind, acquired, generated) display fixed English when Trans ON and non-zh, revert to Chinese when Trans OFF
- User-visible: destination coordinate help text shows Chinese in zh and fixed English in non-zh without machine translation
- Unchanged: business logic, data fetching, layout/DOM structure, and the footer署名 @小狮子佑酱

## Risk assessment
- Possible failure modes: fixed map misses a string variant and falls back to machine translation or Chinese
- Performance / cost / quota impact: reduced translation API usage for mapped phrases
- Deployment or environment risks: none; changes are client-side and limited to i18n

## How to test
1. In Safari, toggle Trans ON with a non-zh language environment
2. Verify mapped labels show fixed English in Upstream live card and geo section; destination help text shows fixed English
3. Toggle Trans OFF; verify the same labels revert to original Chinese
4. Click Get current position; verify “已获取/已获取位置/已生成。” map correctly under Trans ON
5. Switch 1h / 3h / 72h and open tool intro/modal; verify fixed mapping remains applied

## Rollback plan
- Revert the commit on staging or switch back to the previous staging revision

## Open questions / follow-ups
- Confirm exact DOM nodes for destination coordinate help text and status labels before implementation
- Confirm whether any additional short labels should be added to the fixed map

## FIXED_I18N_MAP canonical terms (finalized)
Status terms (English is canonical; allow en -> target translation only; disallow zh -> target translation)
- 静默 -> stand in silence
- 爆发进行中 -> in outburst
- 爆发中 -> in outburst (alias)
- 爆发概率上升 -> outburst building
- 爆发后衰落期 -> fading after outburst
- 值得出门 -> worth going out
- 可蹲守 -> wait-and-observe
- 低概率 -> low probability
- 不可观测 -> unobservable
- 不可观测。 -> (remove; do not keep this variant)

Progress / status prompts
- 拉取数据中… -> Fetching data…
- 等待生成。 -> Waiting…
- 已生成。 -> Generated.
- 已获取 ✓ -> Acquired ✓
- 已获取当前位置 -> Location acquired
- 📍 正在获取当前位置… -> Getting current location…
- 📍 无法获取定位 -> Unable to get location

Warnings / errors
- ⚠️ 数据可信度提醒 -> ⚠️ Data reliability notice
- ⚠️ 磁纬过低：已停止生成 -> ⚠️ MLAT too low: generation stopped
- 磁纬过低，已停止生成 -> MLAT too low. Generation stopped
- ⚠️ 磁纬限制：不可观测 -> ⚠️ MLAT limit: unobservable
- ⚠️ 磁纬较低：仅极端事件才可能 -> ⚠️ Low MLAT: only extreme events may work
- ⚠️ 经纬度输入无效 -> ⚠️ Invalid coordinates
- ⚠️ 经纬度超出范围 -> ⚠️ Coordinates out of range
- ⚠️ 无法获取定位 -> ⚠️ Unable to get location
- ⚠️ 定位处理异常 -> ⚠️ Location error
- ⚠️ 定位返回无效坐标 -> ⚠️ Invalid location returned

Badge roots
- 太阳风 -> Solar wind
- 云量 -> Cloud cover
