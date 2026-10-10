import { useEffect, useRef, useState } from "react";
import { CommerceSelect } from "../../CommerceSelect.jsx";

function OptionButtons({ label, value, options, onChange, disabled }) {
  return (
    <div
      className="accessory-toolbar__options"
      role="radiogroup"
      aria-label={label}
    >
      {options.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={value === item.id}
          className={value === item.id ? "is-active" : ""}
          disabled={disabled}
          onClick={() => onChange?.(item.id)}
        >
          <strong>{item.label}</strong>
          {Array.isArray(item.shotIds) ? (
            <b className="accessory-toolbar__count">{item.shotIds.length}张</b>
          ) : null}
          {item.hint || item.anchor ? (
            <small>{item.hint || item.anchor}</small>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function Menu({
  id,
  label,
  summary,
  active,
  onToggle,
  disabled,
  badge,
  children,
}) {
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
        aria-controls={`accessory-toolbar-${id}`}
        aria-label={`${label}，当前：${summary}`}
        title={`${label}：${summary}`}
        onClick={() => onToggle(active ? "" : id)}
      >
        <strong>{label}</strong>
        {badge ? (
          <span className="accessory-toolbar__trigger-badge">{badge}</span>
        ) : null}
        <i className="bi bi-chevron-down" />
      </button>
      {active ? (
        <section
          id={`accessory-toolbar-${id}`}
          className="accessory-toolbar__popover"
          role="dialog"
          aria-label={`${label}设置`}
        >
          <header>
            <strong>{label}</strong>
            <button
              type="button"
              aria-label={`关闭${label}`}
              onClick={() => onToggle("")}
            >
              <i className="bi bi-x-lg" />
            </button>
          </header>
          {children}
        </section>
      ) : null}
    </div>
  );
}

export function AccessoryTopToolbar({
  modelId,
  modelOptions,
  onChangeModelId,
  category,
  categoryOptions,
  onChangeCategory,
  material,
  materialOptions,
  onChangeMaterial,
  scale,
  scaleOptions,
  onChangeScale,
  sizeMm,
  onChangeSizeMm,
  occlusion,
  occlusionOptions,
  onChangeOcclusion,
  crop,
  cropOptions,
  onChangeCrop,
  style,
  styleOptions,
  onChangeStyle,
  platform,
  platformOptions,
  onChangePlatform,
  market,
  marketOptions,
  onChangeMarket,
  productName,
  onChangeProductName,
  sku,
  onChangeSku,
  sellingPoints,
  onChangeSellingPoints,
  disabled,
}) {
  const [activeMenu, setActiveMenu] = useState("");
  const rootRef = useRef(null);
  const selected = (options, value) =>
    options.find((item) => item.id === value) || options[0] || {};

  useEffect(() => {
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setActiveMenu("");
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

  return (
    <div
      ref={rootRef}
      className="commerce-header__handheld commerce-header__accessory accessory-toolbar"
      aria-label="饰品顶部设置"
    >
      <label className="commerce-header__model accessory-toolbar__model">
        <span>生成模型</span>
        <CommerceSelect
          value={modelId}
          options={modelOptions}
          onChange={onChangeModelId}
          placeholder="请选择模型"
          ariaLabel="选择饰品生成模型"
          disabled={disabled}
        />
      </label>

      <Menu
        id="category"
        label="佩戴品类"
        summary={selected(categoryOptions, category).label || "请选择"}
        active={activeMenu === "category"}
        onToggle={setActiveMenu}
        disabled={disabled}
      >
        <OptionButtons
          label="选择饰品品类"
          value={category}
          options={categoryOptions}
          onChange={onChangeCategory}
          disabled={disabled}
        />
      </Menu>

      <Menu
        id="truth"
        label="商品真值"
        summary={`${selected(materialOptions, material).label || "自动"} · ${selected(scaleOptions, scale).label || "视觉比例"}`}
        active={activeMenu === "truth"}
        onToggle={setActiveMenu}
        disabled={disabled}
      >
        <div className="accessory-toolbar__fields">
          <label>
            <span>材质光学</span>
            <CommerceSelect
              value={material}
              options={materialOptions.map((item) => ({
                value: item.id,
                label: item.label,
              }))}
              onChange={onChangeMaterial}
              ariaLabel="选择饰品材质"
              disabled={disabled}
            />
          </label>
          <label>
            <span>尺度口径</span>
            <CommerceSelect
              value={scale}
              options={scaleOptions.map((item) => ({
                value: item.id,
                label: item.label,
              }))}
              onChange={onChangeScale}
              ariaLabel="选择饰品尺度口径"
              disabled={disabled}
            />
          </label>
        </div>
        {scale === "true" ? (
          <label className="accessory-toolbar__size">
            <span>关键尺寸</span>
            <div>
              <input
                inputMode="decimal"
                value={sizeMm}
                onChange={(event) => onChangeSizeMm?.(event.target.value)}
                placeholder="例如 18.5"
                disabled={disabled}
              />
              <b>mm</b>
            </div>
          </label>
        ) : null}
        <OptionButtons
          label="选择遮挡策略"
          value={occlusion}
          options={occlusionOptions}
          onChange={onChangeOcclusion}
          disabled={disabled}
        />
      </Menu>

      <Menu
        id="visual"
        label="商业画面"
        summary={`${selected(cropOptions, crop).label || "景别"} · ${selected(styleOptions, style).label || "风格"}`}
        active={activeMenu === "visual"}
        onToggle={setActiveMenu}
        disabled={disabled}
      >
        <OptionButtons
          label="选择饰品景别"
          value={crop}
          options={cropOptions}
          onChange={onChangeCrop}
          disabled={disabled}
        />
        <OptionButtons
          label="选择饰品视觉风格"
          value={style}
          options={styleOptions}
          onChange={onChangeStyle}
          disabled={disabled}
        />
        <div className="accessory-toolbar__fields">
          <label>
            <span>投放平台</span>
            <CommerceSelect
              value={platform}
              options={platformOptions.map((item) => ({
                value: item,
                label: item,
              }))}
              onChange={onChangePlatform}
              ariaLabel="选择饰品投放平台"
              disabled={disabled}
            />
          </label>
          <label>
            <span>目标市场</span>
            <CommerceSelect
              value={market}
              options={marketOptions.map((item) => ({
                value: item,
                label: item,
              }))}
              onChange={onChangeMarket}
              ariaLabel="选择饰品目标市场"
              disabled={disabled}
            />
          </label>
        </div>
      </Menu>

      <Menu
        id="product"
        label="商品信息"
        summary={productName || sku || sellingPoints ? "已填写" : "可选"}
        active={activeMenu === "product"}
        onToggle={setActiveMenu}
        disabled={disabled}
      >
        <div className="accessory-toolbar__product-fields">
          <label>
            <span>饰品名称</span>
            <input
              value={productName}
              onChange={(event) => onChangeProductName?.(event.target.value)}
              placeholder="例如：18K 玫瑰金吊坠"
              disabled={disabled}
            />
          </label>
          <label>
            <span>SKU / 货号</span>
            <input
              value={sku}
              onChange={(event) => onChangeSku?.(event.target.value)}
              placeholder="用于追踪本次成图"
              disabled={disabled}
            />
          </label>
          <label>
            <span>已确认卖点与要求</span>
            <textarea
              rows={3}
              value={sellingPoints}
              onChange={(event) => onChangeSellingPoints?.(event.target.value)}
              placeholder="只填写可由商品资料确认的信息"
              disabled={disabled}
            />
          </label>
        </div>
      </Menu>
    </div>
  );
}
