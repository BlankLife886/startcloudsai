const LISTING_TYPES = [
  ["white", "白底图"],
  ["scene", "场景图"],
  ["selling", "卖点图"],
  ["other", "其他"],
];

export function ListingBusinessSettings({
  structureMode,
  counts,
  allocatedCount,
  onChangeStructureMode,
  onChangeCounts,
}) {
  return (
    <section className="settings-section listing-structure-section">
      <h2>套图结构配置</h2>
      <div className="structure-mode-grid">
        {[
          ["smart", "智能匹配", "分析商品资料，自动组织 7 张高转化套图"],
          ["custom", "自定义配置", "自由选择图片类型和本次生成数量"],
        ].map(([id, label, hint]) => (
          <button
            key={id}
            type="button"
            className={structureMode === id ? "active" : ""}
            onClick={() => onChangeStructureMode(id)}
          >
            <span className="structure-mode-check">
              <i className="bi bi-check-lg" />
            </span>
            <span>
              <strong>{label}</strong>
              <small>{hint}</small>
            </span>
          </button>
        ))}
      </div>
      {structureMode === "custom" ? (
        <div className="listing-count-config">
          {LISTING_TYPES.map(([key, label]) => (
            <article key={key}>
              <span>
                <strong>{label}</strong>
                <small>图片类型与数量</small>
              </span>
              <div
                className="listing-stepper"
                data-click-guard="off"
                aria-label={`${label}数量`}
              >
                <button
                  type="button"
                  aria-label={`减少${label}`}
                  disabled={counts[key] <= (key === "white" ? 1 : 0)}
                  onClick={() =>
                    onChangeCounts((value) => ({
                      ...value,
                      [key]: Math.max(key === "white" ? 1 : 0, value[key] - 1),
                    }))
                  }
                >
                  <i className="bi bi-dash" />
                </button>
                <b>{counts[key]}</b>
                <button
                  type="button"
                  aria-label={`增加${label}`}
                  disabled={allocatedCount >= 7}
                  onClick={() =>
                    onChangeCounts((value) => ({
                      ...value,
                      [key]: value[key] + 1,
                    }))
                  }
                >
                  <i className="bi bi-plus" />
                </button>
              </div>
            </article>
          ))}
          <footer>
            <span>已分配 {allocatedCount}/7 张</span>
            <strong className={allocatedCount >= 1 ? "ready" : ""}>
              {allocatedCount >= 7
                ? "套图已满"
                : allocatedCount >= 1
                  ? "可以生成"
                  : "至少分配 1 张"}
            </strong>
          </footer>
        </div>
      ) : null}
    </section>
  );
}
