export function CloneBusinessSettings({
  cloneType,
  cloneFidelity,
  onChangeType,
  onChangeFidelity,
}) {
  return (
    <section className="settings-section clone-settings-section">
      <h2>复刻类型</h2>
      <div className="clone-type-grid">
        {[
          ["电商商品图", "bi-box-seam"],
          ["服饰电商图", "bi-person"],
          ["营销海报", "bi-megaphone"],
          ["社媒图文", "bi-phone"],
          ["创意海报", "bi-palette"],
          ["其他", "bi-grid"],
        ].map(([item, icon]) => (
          <button
            key={item}
            type="button"
            className={cloneType === item ? "active" : ""}
            onClick={() => onChangeType(item)}
          >
            <i className={`bi ${icon}`} />
            {item}
          </button>
        ))}
      </div>
      <h2 className="clone-subheading">复刻程度</h2>
      <div className="clone-fidelity-grid">
        <button
          type="button"
          className={cloneFidelity === "style" ? "active" : ""}
          onClick={() => onChangeFidelity("style")}
        >
          <span className="structure-mode-check">
            <i className="bi bi-check-lg" />
          </span>
          <span>
            <strong>参考风格</strong>
            <small>参考整体风格和结构，允许重构色彩与场景。</small>
          </span>
        </button>
        <button
          type="button"
          className={cloneFidelity === "strict" ? "active" : ""}
          onClick={() => onChangeFidelity("strict")}
        >
          <span className="structure-mode-check">
            <i className="bi bi-check-lg" />
          </span>
          <span>
            <strong>高度复刻</strong>
            <small>保持视觉结构，重点替换商品和用户文案。</small>
          </span>
        </button>
      </div>
    </section>
  );
}
