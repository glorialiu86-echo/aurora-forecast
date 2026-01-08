# Aurora Capture 内部白盒模型说明（与 model.js 一一对应）

> 内部自检与维护用途。允许真实阈值、权重与分段逻辑。
> 不做对外解释，不做抽象化。

## 0. 文件与入口
- 对应文件：`model.js`
- 入口函数/暴露：`window.Model = { ... }`
- 主要模块顺序：
  1) 工具函数与权重常量 `W`
  2) 磁纬近似 `approxMagLat` / `magLat` / `aacgmV2MagLat`
  3) 评分与标签 `baseScoreFromSW` / `score5FromC10` / `labelByScore5`
  4) Aurora Oval 软约束 `ovalMinMlatFromC10` / `applyOvalConstraint`
  5) 1h 投递模型 `deliverModel`
  6) 3h 状态机 `state3h`
  7) 72h 代理规则 `p1a_fastWind` / `p1b_energyInput`
  8) 不可观测解释 `explainUnobservable`

---

## 1. 工具函数与权重入口（W）
### 1.1 工具函数
- `clamp(x, a, b)`：数值边界收敛，非数值直接返回原值。
- `abs(x)`：简单绝对值封装。

### 1.2 权重与阈值常量（W）
**来源类型：常量（硬编码）**

- 太阳风基准评分权重（`baseScoreFromSW`）：
  - `sv=0.28`、`sbt=0.26`、`sbz=0.32`、`sn=0.14`
- 缺字段保守压制：
  - `miss_bz=0.78`、`miss_bt=0.85`、`miss_v=0.85`
- 不可观测模块阈值：
  - `block_cloud_max_ge=65`
  - `block_moon_alt_ge=15`
  - `block_moon_frac_ge=0.50`
  - `block_twilight_sun_alt_gt=-10`
- Aurora Oval 软约束参数：
  - `oval_margin_deg=3.0`
  - `oval_in_deg=2.0`
  - `oval_edge_out_deg=6.0`
  - `oval_floor_factor=0.62`
  - `oval_edge_factor=0.82`

**硬约束 / 一票否决：无**（所有权重/阈值仅用于评分或解释，未直接否决）

---

## 2. 磁纬近似模块（空间约束基础）
### 2.1 `approxMagLat(lat, lon)`
**用途**：离线近似磁纬（近似 AACGMv2 语境）。

**参数来源**：
- `lat`、`lon`：外部定位/用户地理输入（物理观测）。
- `poleLat=85.9`、`poleLon=142.3`：固定常量。

**实现逻辑（关键公式）**：
- 使用 dip pole 作为参考点，计算地心球面距离 `c`：
  - `cosc = sin(lat)*sin(poleLat) + cos(lat)*cos(poleLat)*cos(lon-poleLon)`
  - `c = acos(clamp(cosc, -1, 1))`
- 定义 `MLAT = 90 - deg(c)`

**硬约束 / 一票否决**：无。

### 2.2 `magLat` / `aacgmV2MagLat`
- `magLat(lat, lon)`：直接调用 `approxMagLat`。
- `aacgmV2MagLat(lat, lon, _date)`：兼容旧接口，直接返回 `approxMagLat`，不做网络请求。

---

## 3. 评分与输出标签（能量输入评估）
### 3.1 `baseScoreFromSW(sw, missingKeys)`
**用途**：把太阳风参数映射到 0~10 内部基准分。

**参数来源**：
- `sw.v`、`sw.bt`、`sw.bz`、`sw.n`：物理观测输入。
- `missingKeys`：推导状态（字段缺失信息）。

**真实阈值与分段**：
- 归一化区间：
  - `v`：`(v - 380) / (650 - 380)`
  - `bt`：`(bt - 4) / (12 - 4)`
  - `bz`：`((-bz) - 1) / (10 - 1)`（`bz` 缺失则 `sbz=0`）
  - `n`：`(n - 1) / (8 - 1)`
- 加权汇总：
  - `raw = (sv*0.28 + sbt*0.26 + sbz*0.32 + sn*0.14) * 10`
- 缺字段惩罚：
  - `bz` 缺失：`raw *= 0.78`
  - `bt` 缺失：`raw *= 0.85`
  - `v` 缺失：`raw *= 0.85`
- 最终 `clamp(raw, 0, 10)`

**硬约束 / 一票否决**：无（仅评分衰减）。

### 3.2 `score5FromC10(c10)`
**用途**：将 0~10 分映射为 1~5 档。

**真实阈值**：
- `c10 >= 8.2` → 5
- `c10 >= 6.8` → 4
- `c10 >= 5.0` → 3
- `c10 >= 2.8` → 2
- else → 1

### 3.3 `labelByScore5(s)`
**用途**：映射评分到文案与 CSS 分类。

**真实映射**：
- 5 → `STRONGLY_RECOMMENDED` / `强烈推荐` / `g`
- 4 → `WORTH_GOING_OUT` / `值得出门` / `g`
- 3 → `WAIT_AND_OBSERVE` / `可蹲守` / `b`
- 2 → `LOW_PROBABILITY` / `低概率` / `y`
- 1 → `UNOBSERVABLE` / `不可观测` / `r`

---

## 4. 空间约束与 Aurora Oval（软约束）
### 4.1 `ovalMinMlatFromC10(c10)`
**用途**：根据活动强度估算“典型椭圆最低磁纬”。

**参数来源**：
- `c10`：0~10 活动强度（来自 `baseScoreFromSW` 或后续调整）。

**真实分段（线性）**：
- `0 → 72`
- `3 → 69`
- `5 → 66`
- `7 → 62`
- `9 → 58`
- `10 → 56`

实现：
- `x <= 3`：`72 - (3/3)*x`
- `x <= 5`：`69 - (3/2)*(x-3)`
- `x <= 7`：`66 - (4/2)*(x-5)`
- `x <= 9`：`62 - (4/2)*(x-7)`
- `x > 9`：`58 - (2/1)*(x-9)`

### 4.2 `applyOvalConstraint(c10, userMlat)`
**用途**：基于用户磁纬与椭圆位置进行“温和压制”。

**参数来源**：
- `c10`：来自能量输入评分。
- `userMlat`：由 `approxMagLat` 计算。
- 常量：`oval_margin_deg`、`oval_in_deg`、`oval_edge_out_deg`、`oval_floor_factor`、`oval_edge_factor`。

**关键逻辑**：
- `delta = userMlat - minMlat`
- `deltaEff = delta + oval_margin_deg`（抵消磁纬误差）

分区：
- **IN**：`deltaEff >= oval_in_deg` → `factor=1.0`
- **EDGE**：`-oval_edge_out_deg <= deltaEff < oval_in_deg`
  - 线性衰减到 `oval_edge_factor=0.82`
- **OUT**：`deltaEff < -oval_edge_out_deg`
  - `factor = oval_floor_factor=0.62`

上限封顶：
- `EDGE`：`cap=9.0`
- `OUT`：`cap=7.2`
- `IN`：`cap=10`

最终：`adjustedC10 = clamp(c10 * factor, 0, cap)`

**硬约束 / 一票否决**：无（仅软压制）。

---

## 5. 1 小时模型：`deliverModel(sw)`
**用途**：对即时条件做“交付式”粗判（独立于评分系统）。

**参数来源**：
- `sw.v`、`sw.bt`、`sw.n`（物理观测）。

**真实阈值**：
- `okBt = bt >= 6.5`
- `okV = v >= 430`
- `okN = n >= 2.0`
- `count = okBt + okV + okN`

**输出**：
- `{ count, okBt, okV, okN }`

**硬约束 / 一票否决**：无（只是计数输出）。

---

## 6. 3 小时模型：`state3h(sw)`（状态机与趋势判断）
**用途**：三小时趋势状态机，输出阶段性强度与语义标签。

**参数来源**：
- `sw.v`、`sw.bt`、`sw.bz`、`sw.n`（物理观测）。
- `bz` 缺失时设为 `999`。

**真实阈值 / 条件**：
- `trig = (bz <= -3.0)`
- `bg = (v >= 420 && bt >= 6.0)`
- `dense = (n >= 2.0)`

**状态机分支（按顺序短路）**：
1) `trig && bg` → `IN_OUTBURST` / `score: 8.0`
2) `bg && (dense || trig)` → `OUTBURST_BUILDING` / `score: 6.4`
3) `bg` → `OUTBURST_FADING` / `score: 5.4`
4) else → `SILENT` / `score: 3.0`

**硬约束 / 一票否决**：无（基于状态机输出）。

---

## 7. 72 小时代理规则（粗粒度）
### 7.1 `p1a_fastWind(sw)`
- 规则：`v >= 480` → true
- 参数来源：`sw.v`（物理观测）

### 7.2 `p1b_energyInput(sw)`
- 规则：`bt >= 6.5 && bz <= -2.0` → true
- 参数来源：`sw.bt`、`sw.bz`（物理观测）

**硬约束 / 一票否决**：无（返回布尔信号）。

---

## 8. 不可观测解释模块（阻断/解释）
### 8.1 结构与常量
- 枚举：
  - `CLOUD_COVER`
  - `BRIGHT_SKY`
  - `LOW_AURORA_CONTRAST`
- 文案映射 `BlockerText`
- 优先级 `BlockerPriority`（但实际逻辑直接写死：云 > 亮天 > 对比度不足）

### 8.2 `explainUnobservable(p)`
**参数来源**：
- `cloudMax`：三层云最大值（推导状态）。
- `moonAltDeg`、`moonFrac`：月亮高度 / 月相（推导状态）。
- `sunAltDeg`：太阳高度（推导状态）。

**真实阈值**：
- 云量遮挡：`cloudMax >= 65`
- 月光干扰：`moonAltDeg >= 15` 且 `moonFrac >= 0.50`
- 天光干扰：`sunAltDeg > -10`

**短路 / 优先级**：
1) 若命中云 → `CLOUD_COVER`
2) 否则若命中天色偏亮（含月光/天光） → `BRIGHT_SKY`
3) 否则 → `LOW_AURORA_CONTRAST`

**硬约束 / 一票否决**：
- 该模块用于给出“不可观测解释”，属于输出层硬解释，但不直接改变评分。

---

## 9. 决策映射与输出层级（整体关系）
### 9.1 评分线（能量输入 → 评分 → 标签）
- `baseScoreFromSW` → `score5FromC10` → `labelByScore5`
- 评分线可被 `applyOvalConstraint` 软约束调整后再进入 `score5FromC10`。

### 9.2 空间约束线
- `approxMagLat` → `applyOvalConstraint` → `adjustedC10` / `zone`
- **软约束**：仅乘法衰减 + 上限，不一票否决。

### 9.3 时间尺度线
- 1h：`deliverModel`（阈值计数）
- 3h：`state3h`（状态机 + 得分）
- 72h：`p1a_fastWind` / `p1b_energyInput`（布尔信号）

### 9.4 不可观测解释线
- `explainUnobservable` 根据环境遮挡输出主因文案。
- 作为“解释输出层”，不改变评分或状态，但用于劝退理由。

---

## 10. 约束类型归类（明确标注）
### 10.1 硬约束 / 一票否决
- **无**（模型中没有直接硬否决用户的单一条件；不可观测解释仅输出原因）。

### 10.2 软约束 / 衰减因子
- `baseScoreFromSW` 缺字段惩罚（`miss_bz` / `miss_bt` / `miss_v`）
- `applyOvalConstraint` 的 `factor` 与 `cap`

### 10.3 结构性组织逻辑
- `state3h` 状态机（分支顺序决定最终状态）
- 时间尺度拆分：1h / 3h / 72h 独立输出

---

## 11. 快速对照索引（函数 → 用途）
- `approxMagLat`：离线磁纬近似
- `baseScoreFromSW`：太阳风评分（0~10）
- `score5FromC10`：评分分档（1~5）
- `labelByScore5`：分档文案与样式
- `ovalMinMlatFromC10`：椭圆最低磁纬估计
- `applyOvalConstraint`：空间软约束
- `deliverModel`：1h 阈值计数
- `state3h`：3h 状态机
- `p1a_fastWind` / `p1b_energyInput`：72h 代理规则
- `explainUnobservable`：不可观测解释
