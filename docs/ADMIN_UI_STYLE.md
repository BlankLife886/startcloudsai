# 后台 UI 设计规范（基准：用户本地 Nexus ERP 项目）

来源：/Users/ycc/Documents/ERP（React + Tailwind + recharts）。新后台是 Vue3 + Element Plus，按本规范用 CSS 变量 + 自定义类复刻同等视觉，不引入 Tailwind。

## 1. 设计令牌（light / dark 双主题，:root 与 .dark）

```css
:root {
  --bg: #f4f5f7;          /* 页面背景 */
  --surface: #ffffff;      /* 卡片/侧边栏 */
  --surface-2: #f8f9fb;    /* 输入框底/次级底 */
  --surface-3: #eef0f3;    /* hover 底 */
  --border: #e5e7ec;
  --border-strong: #d4d7de;
  --ink: #16181d;          /* 主文字 */
  --ink-2: #5c6370;        /* 次级文字 */
  --ink-3: #9aa1ad;        /* 弱文字/图标 */
  --accent: #4f46e5;       /* 主色（靛蓝） */
  --accent-hover: #4338ca;
  --accent-soft: #eef2ff;  /* 选中菜单底 */
  --accent-ink: #4338ca;
  --success: #059669;  --success-soft: #ecfdf5;
  --warning: #d97706;  --warning-soft: #fffbeb;
  --danger:  #dc2626;  --danger-soft:  #fef2f2;
  --info:    #0284c7;  --info-soft:    #f0f9ff;
  --violet:  #7c3aed;  --violet-soft:  #f5f3ff;
  --shadow-sm: 0 1px 2px rgb(16 24 40 / .05);
  --shadow-md: 0 1px 2px rgb(16 24 40 / .04), 0 4px 12px rgb(16 24 40 / .06);
  --shadow-lg: 0 4px 8px rgb(16 24 40 / .04), 0 12px 32px rgb(16 24 40 / .12);
}
.dark {
  --bg:#0b0d11; --surface:#14161c; --surface-2:#191c23; --surface-3:#21252e;
  --border:#262a33; --border-strong:#343945;
  --ink:#eceef2; --ink-2:#9aa1ad; --ink-3:#646b78;
  --accent:#6366f1; --accent-hover:#818cf8; --accent-soft:#1e2143; --accent-ink:#a5b4fc;
  --success:#34d399; --success-soft:#0a2e21; --warning:#fbbf24; --warning-soft:#33260a;
  --danger:#f87171; --danger-soft:#391414; --info:#38bdf8; --info-soft:#0a2536;
  --violet:#a78bfa; --violet-soft:#251b3e;
}
```

字体：`"Inter", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`，正文 14px、行高 1.5；数字统一 `font-variant-numeric: tabular-nums`（类名 `.tnum`）。

## 2. 布局骨架

- **侧边栏**：宽 236px，`bg-surface` + 右侧 1px border。顶部 logo 块：36px 圆角方块（`--accent` 底白色图标，rounded-xl）+ 站名两行（15px bold / 11px `--ink-3`）。菜单**分组**（组标题 11px 加粗字距宽 `--ink-3`），菜单项 rounded-xl、13.5px、图标 17px：选中态 `--accent-soft` 底 + `--accent-ink` 文字；hover `--surface-3`。待办数徽标：红底白字圆形（如待审投稿数挂在"投稿审核"项）。底部用户卡：渐变圆头像（indigo→violet）+ 名字 + 角色 Badge + 退出图标按钮。
- **顶栏**：高 56px，`bg-surface` 70% 透明 + backdrop-blur，底 border。左侧面包屑（站名 / 当前页，13px）；右侧操作组：主题切换（月亮/太阳图标按钮）、通知铃铛（红点计数、点开 pop-in 下拉待办列表，每项 = 色块图标 + 文案 + 数字，跳对应页面）。
- **内容区**：`--bg` 背景，px-28 py-24 左右，页面切换 fade-up 动画（0.35s cubic-bezier(0.21,1.02,0.73,1)）。
- **页头组件 PageHeader**：大标题（约 20px semibold tracking-tight）+ 描述行（13px `--ink-3`）+ 右侧动作按钮区。

## 3. 组件规范

- **Card**：`rounded-2xl`（16px）+ 1px `--border` + `--surface` 底 + `--shadow-sm`。CardHeader：15px semibold 标题 + 12px `--ink-3` 副标题，px-20 pt-18 pb-12。
- **KPI 统计卡**：13px `--ink-3` 标签 + 大号 `.tnum` 数值（约 24-28px bold）+ 底部趋势行（同比小字，涨绿跌红）+ 右上角色块小图标（soft 底 + 对应色图标，rounded-lg）。
- **Badge**：圆角全圆 `rounded-full` px-10 py-2 12px 加粗，七种 tone（neutral/accent/success/warning/danger/info/violet）= soft 底 + 对应色文字，可带 1.5 圆点。状态映射：成功/已通过=success、待处理=warning、失败/违规=danger、运行中=info、精选=violet。
- **Button**：primary=`--accent` 底白字 hover 加深 + active scale(0.98)；secondary=白底 border-strong；ghost=无底 hover `--surface-3`；danger=danger-soft 底 danger 文字。md 高 38px rounded-xl / sm 高 32px rounded-lg。
- **表格**：表头 12px `--ink-3` 加粗、行 hover `--surface-2`、单元格 13px、数字列 `.tnum`；去掉 Element 默认深色边框感（细 `--border` 分隔线）。
- **弹层/抽屉**：rounded-2xl + `--shadow-lg`，进场 pop-in（scale 0.97→1，0.28s）。
- **图表（echarts 适配）**：主色序列 `['#6366f1','#38bdf8','#34d399','#fbbf24','#f472b6','#a78bfa','#94a3b8']`；tooltip 白底圆角 12px + `--shadow-md`；网格线 `--border`；面积图用主色 8% 透明渐变填充。
- **滚动条**：10px、`--border-strong` 圆角 thumb、透明轨道。

## 4. Element Plus 落地方式

1. 全局 `src/styles/theme.css`：定义上述 CSS 变量 + `.dark` 类 + 动画 keyframes + `.tnum`/`.card`/`.badge-*` 等工具类。
2. 覆盖 Element Plus 变量：`--el-color-primary: var(--accent)`、`--el-border-radius-base: 10px`、`--el-bg-color`、`--el-text-color-*`、`--el-border-color` 等映射到令牌；dark 模式同时挂 Element 的 `dark` 类与自定义 `.dark`。
3. 主题切换：顶栏按钮 toggle `documentElement.classList`，localStorage 持久化，默认 light。
4. 图标：继续用 @element-plus/icons-vue（线性风格接近 lucide），尺寸 16-17px。

## 5. 菜单信息架构（换肤后）

```
总览    仪表盘
业务    用户管理 / 订单 / 套餐 / 任务监控
社区运营 提示词库 / 社区管理 / 投稿审核
资金    财务 / 审计日志
系统    内容管理 / 系统设置
```

面包屑 = 「星空云绘 / {当前页}」。登录页保持现有"英雄图+玻璃拟态"设计不动（它是品牌页，不套 ERP 规范）。
