# 管理端 UI 规范

更新时间：2026-08-02

本文记录 `apps/admin` 已落地的视觉系统。实现源为 `src/styles/theme.css`、`src/styles.css`、`src/AdminLayout.vue` 和 `src/chartTheme.ts`；新增页面应复用这些变量与组件，不再引用仓库外的设计稿。

## 设计目标

管理端是高频运营工具，优先保证扫描、筛选、比较和批量操作效率。视觉采用圆角卡片式运营后台：独立圆角侧栏、大标题顶栏、霓虹绿主色与高对比暗色表面；亮色为同语言浅色配套，不使用营销页构图或无关业务模块。

支持 light/dark 双主题。主题通过 `src/theme.ts` 切换 `html.dark` 并持久化到 localStorage；切换可从点击点做圆形扩散过渡。Element Plus 变量与应用令牌同步。

## 核心令牌

```css
:root {
  --bg: #eef0f3;
  --surface: #ffffff;
  --surface-2: #f5f6f8;
  --surface-3: #e8eaef;
  --border: #dde1e8;
  --border-strong: #c8ced8;
  --ink: #12141a;
  --ink-2: #5a6170;
  --ink-3: #8b93a3;
  --accent: #8fd400;
  --accent-hover: #7ab800;
  --accent-soft: #eef9d4;
  --accent-ink: #3d5c00;
  --accent-on: #12141a;
  --success: #0d9f6e;
  --warning: #d97706;
  --danger: #dc2626;
  --info: #0284c7;
  --violet: #7c3aed;
  --radius-card: 22px;
}

html.dark {
  --bg: #12141a;
  --surface: #1c1f27;
  --surface-2: #232733;
  --surface-3: #2b3040;
  --border: rgb(255 255 255 / 0.06);
  --border-strong: rgb(255 255 255 / 0.12);
  --ink: #f4f6fa;
  --ink-2: #9aa3b5;
  --ink-3: #6d7588;
  --accent: #b6ff00;
  --accent-hover: #c8ff3d;
  --accent-soft: rgb(182 255 0 / 0.12);
  --accent-ink: #b6ff00;
  --accent-on: #12141a;
}
```

`--accent` 专司品牌与主操作；`--success` 为偏青绿语义色，二者勿混用。压在 accent 底上的文字/图标使用 `--accent-on`。success/warning/danger/info/violet 各有对应 `*-soft` 背景变量。阴影统一用 `--shadow-sm|md|lg`。卡片圆角用 `--radius-card`（约 22px）。正文为 14px/1.5，字体栈以 Inter 和系统中文无衬线字体为主；数字使用 `.tnum` 的 tabular figures。

## 页面骨架

- 侧栏桌面宽约 248px，圆角独立于主区；按“总览、业务、社区运营、资金、系统”分组；当前路由使用实心 accent 底 + `--accent-on` 文字。投稿待审数显示在菜单徽标。
- 顶栏显示页面大标题（`route.meta.title`）、待办铃、太阳/月亮分段主题切换，以及右侧头像资料芯片（下拉：改密/退出）。待办来源为投稿数与运行中任务数，加载失败时静默降级。
- 主内容区使用 `--bg`，页面切换应用 `.anim-fade-up`。页面顶部统一标题、说明与主要动作。
- 小屏下侧栏允许收起；内容和筛选区允许换行；表格保持水平滚动，不压缩到不可读。

当前信息架构：

```text
总览      仪表盘
业务      用户管理 / 任务监控 / 模型配置
社区运营  提示词库 / 社区管理 / 投稿审核
资金      兑换码 / 审计日志
系统      内容管理 / 系统设置
```

## 组件规则

### 卡片与统计

普通内容使用 `.card` 或 `PageCard.vue`，以 surface、弱边框和大圆角区分层级。KPI 使用 `StatCard.vue`：标签、tabular 数值、辅助趋势/状态和 tone 图标块。页面 section 本身不额外套卡片；卡片用于独立工具或重复数据单元。

### 按钮与图标

命令按钮使用 Element Plus button。主色按钮文字为 `--accent-on`。常见工具动作优先图标并提供 tooltip；创建/保存/确认等明确命令可使用图标加文字。危险动作使用 danger tone 和二次确认，禁用态必须由真实业务条件驱动。

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

编辑与确认类弹窗统一使用 `components/AdminDialog.vue`（header 置顶 / body 中部滚动 / footer 置底；少边框、轻重悬浮阴影）。跨多个数据域的详情使用 drawer。表单 label、校验提示和单位必须明确；金额输入在 UI 用元，提交前通过 `yuanToFen` 转换。危险操作不能只靠颜色表达。

### 图表

图表通过 `EChart.vue` 和 `chartTheme.ts` 使用按需 ECharts。颜色序列为 neon green、orange、sky、amber、pink、violet、gray；坐标、tooltip、legend 和网格线从主题变量派生。容器必须有稳定高度，主题切换时重新应用 option。

## Element Plus 集成

`theme.css` 映射以下变量族：主色及状态色、背景、文字、边框、fill、圆角、shadow 和 disabled。dark 模式仍使用同一组语义变量，不在业务页面硬编码第二套颜色。

AutoImport 与 Components 插件只负责 Element Plus 的按需导入；自有组件仍显式 import。生成的 `auto-imports.d.ts`、`components.d.ts` 应随依赖/API 变化更新并提交。

## 动效与可访问性

- 壳层交互使用 GSAP（`composables/useAdminShellMotion.ts`）：侧栏入场 stagger、折叠宽度、路由内容切换与按钮 pulse；主题切换可用圆形扩散。弹层内容可用 0.28s pop-in。须尊重 `prefers-reduced-motion`。
- 键盘 focus 必须可见，图标按钮具有可访问名称或 tooltip。
- 状态不仅依靠颜色，须同时有文字或图标。
- 表单和按钮在移动端保持可点击尺寸；文字不得与徽标、图标重叠。

## 新页面检查清单

1. 路由 title、侧栏分组和权限守卫已配置。
2. 加载、空、错误、禁用和提交中状态完整。
3. 列表使用 cursor 分页，金额使用统一分/元转换。
4. light/dark 下表格、弹层、图表和状态色均可读。
5. 1280px 桌面和窄屏布局无重叠、截断或不可达操作。
6. 破坏性写操作有确认，并会被后端审计。
