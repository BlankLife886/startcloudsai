const stages = [
  {
    label: "公开展示",
    detail: "首页、提示词、社区、价格、更新、关于、登录",
    state: "/auth 已通过",
  },
  { label: "本地工具", detail: "拼图、图片压缩", state: "待迁移" },
  {
    label: "账户与活动",
    detail: "账户、钱包、通知、签到、激励计划",
    state: "待迁移",
  },
  { label: "AI 工作台", detail: "创作台及各生成工作台", state: "待迁移" },
  { label: "智能画布", detail: "原生接入现有 React 画布", state: "待迁移" },
];

export function MigrationPreview() {
  return (
    <main className="migration-preview">
      <header className="migration-preview__header">
        <img src="/brand/starcloud-logo.svg" alt="" />
        <div>
          <h1>主站 React 迁移预览</h1>
          <p>当前生产路由仍由 Vue 提供。</p>
        </div>
      </header>

      <section className="migration-preview__table" aria-label="迁移阶段">
        {stages.map((stage) => (
          <article key={stage.label}>
            <div>
              <strong>{stage.label}</strong>
              <span>{stage.detail}</span>
            </div>
            <em className={stage.state === "待迁移" ? "" : "is-active"}>
              {stage.state}
            </em>
          </article>
        ))}
      </section>
    </main>
  );
}
