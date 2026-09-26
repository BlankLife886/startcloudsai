import { useEffect, useRef, useState } from "react";
import { CommerceSelect } from "../CommerceSelect.jsx";
import "../AccessoryStudio.css";
import "./WorkbenchTopToolbar.css";

function toOptions(list) {
  return (list || []).map((item) =>
    item && typeof item === "object"
      ? { value: item.id ?? item.value, label: item.label }
      : { value: item, label: item },
  );
}

function OptionButtons({ label, value, options, onChange, disabled, columns }) {
  return (
    <div
      className="accessory-toolbar__options"
      role="radiogroup"
      aria-label={label}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((item) => {
        const id = item.id ?? item.value ?? item;
        const text = item.label ?? item;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value === id}
            className={value === id ? "is-active" : ""}
            disabled={disabled}
            onClick={() => onChange?.(id)}
          >
            {item.icon ? <i className={`bi ${item.icon} workbench-toolbar__icon`} /> : null}
            <strong>{text}</strong>
            {item.hint ? <small>{item.hint}</small> : null}
          </button>
        );
      })}
    </div>
  );
}

function Menu({ id, label, summary, active, onToggle, disabled, badge, wide, children }) {
  return (
    <div
      className={`commerce-header__tune accessory-toolbar__menu${active ? " is-open" : ""}`}
    >
      <button
        type="button"
        className={`commerce-header__tune-trigger accessory-toolbar__trigger${active ? " is-open" : ""}`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={active}
        aria-controls={`workbench-toolbar-${id}`}
        aria-label={`${label}，当前：${summary}`}
        title={`${label}：${summary}`}
        onClick={() => onToggle(active ? "" : id)}
      >
        <strong>{label}</strong>
        {badge ? <span className="accessory-toolbar__trigger-badge">{badge}</span> : null}
        <i className="bi bi-chevron-down" />
      </button>
      {active ? (
        <section
          id={`workbench-toolbar-${id}`}
          className={`accessory-toolbar__popover${wide ? " workbench-toolbar__popover--wide" : ""}`}
          role="dialog"
          aria-label={`${label}设置`}
        >
          <header>
            <strong>{label}</strong>
            <button type="button" aria-label={`关闭${label}`} onClick={() => onToggle("")}>
              <i className="bi bi-x-lg" />
            </button>
          </header>
          {children}
        </section>
      ) : null}
    </div>
  );
}

// 预置字段：既可从建议里点选，也可以直接输入（对齐 seeany 各单点工具的“请选择，或直接输入”）
function PresetField({ field, disabled }) {
  const value = String(field.value || "");
  const listId = `workbench-preset-${field.key}`;
  return (
    <label className="workbench-toolbar__preset">
      <span className="workbench-toolbar__preset-head">
        <span>{field.label}</span>
        {value ? (
          <button
            type="button"
            className="workbench-toolbar__preset-clear"
            aria-label={`清空${field.label}`}
            disabled={disabled}
            onClick={() => field.onChange?.("")}
          >
            清空
          </button>
        ) : null}
      </span>
      <input
        list={listId}
        value={value}
        placeholder={field.placeholder || "请选择，或直接输入"}
        disabled={disabled}
        maxLength={60}
        onChange={(event) => field.onChange?.(event.target.value)}
      />
      <datalist id={listId}>
        {(field.options || []).map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <div className="workbench-toolbar__preset-chips" role="group" aria-label={`${field.label}建议`}>
        {(field.options || []).map((option) => (
          <button
            key={option}
            type="button"
            className={value === option ? "is-active" : ""}
            aria-pressed={value === option}
            disabled={disabled}
            onClick={() => field.onChange?.(value === option ? "" : option)}
          >
            {option}
          </button>
        ))}
      </div>
    </label>
  );
}

export function WorkbenchTopToolbar({
  modeId,
  modelId,
  modelOptions = [],
  onChangeModelId,
  // 投放设置
  distribution = [],
  // 画面预设：{ fields, filledCount, extra, resolution }
  presets = null,
  // 商品信息
  product,
  // 创意商拍
  shoot,
  disabled,
}) {
  const [activeMenu, setActiveMenu] = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    const onPointer = (event) => {
      const target = event.target;
      if (rootRef.current?.contains(target)) return;
      // 弹层（AI 卖点、预览等 portal 对话框）与 portal 下拉选项里的点击不关闭工具栏菜单
      if (
        target instanceof Element &&
        target.closest('[aria-modal="true"], .commerce-select-menu')
      ) {
        return;
      }
      setActiveMenu("");
    };
    const onKey = (event) => {
      if (event.key === "Escape") setActiveMenu("");
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    setActiveMenu("");
  }, [modeId]);

  const distributionSummary = distribution
    .map((item) => item.value)
    .filter(Boolean)
    .join(" · ");
  const presetFields = presets?.fields || [];
  const presetExtra = presets?.extra || [];
  const presetResolution = presets?.resolution || null;
  const hasPresetMenu =
    presetFields.length > 0 || presetExtra.length > 0 || Boolean(presetResolution);
  const presetFilled = Number(presets?.filledCount) || 0;
  const presetSummary = [
    presetFilled ? `已填 ${presetFilled} 项` : presetFields.length ? "未填写" : "",
    ...presetExtra.map((item) => item.value).filter(Boolean),
    presetResolution?.value || "",
  ]
    .filter(Boolean)
    .join(" · ");
  const productFilled = Boolean(
    product?.name?.trim() || product?.sellingPoints?.trim(),
  );

  return (
    <div
      ref={rootRef}
      className="commerce-header__handheld commerce-header__accessory accessory-toolbar workbench-toolbar"
      aria-label="工作台顶部设置"
    >
      <label className="commerce-header__model accessory-toolbar__model">
        <span>生成模型</span>
        <CommerceSelect
          value={modelId}
          options={modelOptions}
          onChange={onChangeModelId}
          placeholder="请选择模型"
          ariaLabel="选择生成模型"
          disabled={disabled}
        />
      </label>

      {distribution.length ? (
        <Menu
          id="distribution"
          label="投放设置"
          summary={distributionSummary || "默认"}
          active={activeMenu === "distribution"}
          onToggle={setActiveMenu}
          disabled={disabled}
        >
          <div className="accessory-toolbar__fields">
            {distribution.map((item) => (
              <label key={item.key}>
                <span>{item.label}</span>
                <CommerceSelect
                  value={item.value}
                  options={toOptions(item.options)}
                  onChange={item.onChange}
                  ariaLabel={item.aria || `选择${item.label}`}
                  disabled={disabled}
                />
              </label>
            ))}
          </div>
        </Menu>
      ) : null}

      {hasPresetMenu ? (
        <Menu
          id="presets"
          label="画面预设"
          summary={presetSummary || "默认"}
          badge={presetFilled ? `${presetFilled}` : ""}
          active={activeMenu === "presets"}
          onToggle={setActiveMenu}
          disabled={disabled}
          wide={presetFields.length > 2}
        >
          {presetFields.length ? (
            <div
              className={`workbench-toolbar__presets${presetFields.length > 2 ? " is-grid" : ""}`}
            >
              {presetFields.map((field) => (
                <PresetField key={field.key} field={field} disabled={disabled} />
              ))}
            </div>
          ) : null}
          {presetExtra.map((item) => (
            <div key={item.key} className="workbench-toolbar__group">
              <span className="workbench-toolbar__group-label">{item.label}</span>
              <OptionButtons
                label={item.aria || `选择${item.label}`}
                value={item.value}
                options={item.options}
                onChange={item.onChange}
                disabled={disabled}
                columns={item.columns || 3}
              />
            </div>
          ))}
          {presetResolution ? (
            <div className="workbench-toolbar__group">
              <span className="workbench-toolbar__group-label">
                清晰度
                <small>越高越清晰，生成更慢</small>
              </span>
              <OptionButtons
                label="选择清晰度"
                value={presetResolution.value}
                options={presetResolution.options.map((item) => ({
                  id: item,
                  label: item,
                  hint:
                    item === "4K"
                      ? "印刷 / 放大细节"
                      : item === "2K"
                        ? "主流平台推荐"
                        : "快速预览",
                }))}
                onChange={presetResolution.onChange}
                disabled={disabled}
                columns={presetResolution.options.length}
              />
            </div>
          ) : null}
        </Menu>
      ) : null}

      {shoot ? (
        <Menu
          id="shoot"
          label="商业目标"
          summary={`${shoot.useCaseLabel || "商品上架"} · ${shoot.goalLabel || "促进转化"}`}
          active={activeMenu === "shoot"}
          onToggle={setActiveMenu}
          disabled={disabled}
        >
          <div className="workbench-toolbar__group">
            <span className="workbench-toolbar__group-label">图片用途</span>
            <OptionButtons
              label="选择图片用途"
              value={shoot.useCase}
              options={shoot.useCaseOptions}
              onChange={shoot.onChangeUseCase}
              disabled={disabled}
              columns={4}
            />
          </div>
          <div className="workbench-toolbar__group">
            <span className="workbench-toolbar__group-label">商业目标</span>
            <OptionButtons
              label="选择商业目标"
              value={shoot.goal}
              options={shoot.goalOptions}
              onChange={shoot.onChangeGoal}
              disabled={disabled}
              columns={4}
            />
          </div>
          <div className="accessory-toolbar__product-fields">
            <label>
              <span>目标人群</span>
              <input
                value={shoot.audience || ""}
                onChange={(event) => shoot.onChangeAudience?.(event.target.value)}
                placeholder="例如：25-35岁城市通勤人群"
                disabled={disabled}
              />
            </label>
            <label>
              <span>必须保留的元素</span>
              <input
                value={shoot.protectedElements || ""}
                onChange={(event) => shoot.onChangeProtectedElements?.(event.target.value)}
                placeholder="Logo、包装文字、颜色、比例…"
                disabled={disabled}
              />
            </label>
          </div>
        </Menu>
      ) : null}

      {product ? (
        <Menu
          id="product"
          label="商品信息"
          summary={productFilled ? "已填写" : "可选"}
          badge={productFilled ? "✓" : ""}
          active={activeMenu === "product"}
          onToggle={setActiveMenu}
          disabled={disabled}
        >
          <div className="accessory-toolbar__product-fields">
            <label>
              <span>{product.nameLabel || "商品名称"}</span>
              <input
                value={product.name || ""}
                onChange={(event) => product.onChangeName?.(event.target.value)}
                placeholder={product.namePlaceholder || "例如：无线降噪蓝牙耳机"}
                disabled={disabled}
              />
            </label>
            {product.sku !== undefined ? (
              <label>
                <span>SKU / 货号</span>
                <input
                  value={product.sku || ""}
                  onChange={(event) => product.onChangeSku?.(event.target.value)}
                  placeholder="用于追踪本次成图"
                  disabled={disabled}
                />
              </label>
            ) : null}
            <label>
              <span>核心卖点与要求</span>
              <textarea
                rows={4}
                value={product.sellingPoints || ""}
                onChange={(event) => product.onChangeSellingPoints?.(event.target.value)}
                placeholder="填写核心卖点、适用人群、期望场景和具体参数…"
                disabled={disabled}
              />
            </label>
            <div className="workbench-toolbar__product-tools">
              {product.onGenerateBrief ? (
                <button
                  type="button"
                  className="workbench-toolbar__brief"
                  disabled={disabled || !product.canGenerateBrief}
                  title={product.canGenerateBrief ? undefined : "先上传商品图"}
                  onClick={product.onGenerateBrief}
                >
                  <i className="bi bi-stars" />
                  AI 帮写卖点
                </button>
              ) : null}
              {product.textStable !== undefined ? (
                <button
                  type="button"
                  className={`workbench-toolbar__switch${product.textStable ? " is-on" : ""}`}
                  role="switch"
                  aria-checked={Boolean(product.textStable)}
                  disabled={disabled}
                  onClick={product.onToggleTextStable}
                >
                  <span>
                    <strong>文字稳定性</strong>
                    <small>锁定已提供文案，不可靠时留白</small>
                  </span>
                  <i>
                    <b />
                  </i>
                </button>
              ) : null}
            </div>
          </div>
        </Menu>
      ) : null}
    </div>
  );
}
