# 管理端 UI 规范

更新时间：2026-07-21

本文记录 `apps/admin` 已落地的视觉系统。实现源为 `src/styles/theme.css`、`src/styles.css`、`src/AdminLayout.vue` 和 `src/chartTheme.ts`；新增页面应复用这些变量与组件，不再引用仓库外的设计稿。

## 设计目标

管理端是高频运营工具，优先保证扫描、筛选、比较和批量操作效率。页面采用克制的 ERP 式布局：固定侧栏、紧凑顶栏、稳定内容宽度、低对比背景和明确的状态色，不使用营销页构图。

支持 light/dark 双主题。主题通过 `src/theme.ts` 切换 `html.dark` 并持久化到 localStorage；Element Plus 变量与应用令牌同步。

## 核心令牌

```css
:root {
  --bg: #f4f5f7;
  --surface: #ffffff;
  --surface-2: #f8f9fb;
  --surface-3: #eef0f3;
  --border: #e5e7ec;
  --border-strong: #d4d7de;
  --ink: #16181d;
  --ink-2: #5c6370;
  --ink-3: #9aa1ad;
  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --accent-soft: #eef2ff;
  --success: #059669;
  --warning: #d97706;
  --danger: #dc2626;
  --info: #0284c7;
  --violet: #7c3aed;
}

html.dark {
  --bg: #0b0d11;
  --surface: #14161c;
  --surface-2: #191c23;
  --surface-3: #21252e;
  --border: #262a33;
  --border-strong: #343945;
  --ink: #eceef2;
  --ink-2: #9aa1ad;
  --ink-3: #646b78;
  --accent: #6366f1;
  --accent-hover: #818cf8;
  --accent-soft: #1e2143;
}
```

success/warning/danger/info/violet 各有对应 `*-soft` 背景变量。阴影统一用 `--shadow-sm|md|lg`。正文为 14px/1.5，字体栈以 Inter 和系统中文无衬线字体为主；数字使用 `.tnum` 的 tabular figures。

## 页面骨架

- 侧栏桌面宽 236px，按“总览、业务、社区运营、资金、系统”分组；当前路由使用 accent soft 背景。投稿待审数显示在菜单徽标。
- 顶栏高 56px，显示面包屑、待办铃、主题切换和用户菜单。待办来源为投稿数与运行中任务数，加载失败时静默降级。
- 主内容区使用 `--bg`，页面切换应用 `.anim-fade-up`。页面顶部统一标题、说明与主要动作。
- 小屏下侧栏切换为抽屉式导航，内容和筛选区允许换行；表格保持水平滚动，不压缩到不可读。

当前信息架构：

```text
总览      仪表盘
业务      用户管理 / 任务监控
社区运营  提示词库 / 社区管理 / 投稿审核
资金      兑换码 / 审计日志
系统      内容管理 / 系统设置
```

## 组件规则

### 卡片与统计

普通内容使用 `.card` 或 `PageCard.vue`，以 surface、1px border 和小阴影区分层级。KPI 使用 `StatCard.vue`：标签、tabular 数值、辅助趋势/状态和 tone 图标块。页面 section 本身不额外套卡片；卡片用于独立工具或重复数据单元。

### 按钮与图标

命令按钮使用 Element Plus button。常见工具动作优先图标并提供 tooltip；创建/保存/确认等明确命令可使用图标加文字。危险动作使用 danger tone 和二次确认，禁用态必须由真实业务条件驱动。

### 状态

`.badge` 提供 neutral、accent、success、warning、danger、info、violet。建议映射：

| 状态 | tone |
| --- | --- |
| 成功、已完成、已通过、active | success |
| 待处理、pending、queued | warning |
| 运行中 | info |
| 失败、拒绝、违规、banned | danger |
| 精选、特殊运营标记 | violet |
| 普通元数据 | neutral |

### 表格、分页和筛选

- 表头 12px，正文 13px，行 hover 使用 `--surface-2`，金额/计数加 `.tnum`。
- 列表页使用 cursor 分页和 `CursorPager.vue`，不要展示虚假的总页数。
- 筛选项按高频顺序排列；搜索提交、重置和主要动作在窄屏允许换行。
- 空态、加载失败和重试使用 `ListError.vue` 或等效统一状态，不把 API 错误直接塞进表格行。

### 弹层与表单

编辑使用 dialog，跨多个数据域的详情使用 drawer。表单 label、校验提示和单位必须明确；金额输入在 UI 用元，提交前通过 `yuanToFen` 转换。危险操作不能只靠颜色表达。

### 图表

图表通过 `EChart.vue` 和 `chartTheme.ts` 使用按需 ECharts。颜色序列为 indigo、sky、green、amber、pink、violet、gray；坐标、tooltip、legend 和网格线从主题变量派生。容器必须有稳定高度，主题切换时重新应用 option。

## Element Plus 集成

`theme.css` 映射以下变量族：主色及状态色、背景、文字、边框、fill、圆角、shadow 和 disabled。dark 模式仍使用同一组语义变量，不在业务页面硬编码第二套颜色。

AutoImport 与 Components 插件只负责 Element Plus 的按需导入；自有组件仍显式 import。生成的 `auto-imports.d.ts`、`components.d.ts` 应随依赖/API 变化更新并提交。

## 动效与可访问性

- 页面进入使用 0.35s fade-up，弹层内容可用 0.28s pop-in；不使用影响操作节奏的长动画。
- 键盘 focus 必须可见，图标按钮具有可访问名称或 tooltip。
- 状态不仅依靠颜色，须同时有文字或图标。
- 表单和按钮在移动端保持可点击尺寸；文字不得与徽标、图标重叠。
- 新动效应尊重 `prefers-reduced-motion`。

## 新页面检查清单

1. 路由 title、侧栏分组和权限守卫已配置。
2. 加载、空、错误、禁用和提交中状态完整。
3. 列表使用 cursor 分页，金额使用统一分/元转换。
4. light/dark 下表格、弹层、图表和状态色均可读。
5. 1280px 桌面和窄屏布局无重叠、截断或不可达操作。
6. 破坏性写操作有确认，并会被后端审计。
