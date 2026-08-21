import { useEffect, useRef, useState } from "react";
import { CommerceSelect } from "../../CommerceSelect.jsx";
import "../../AccessoryStudio.css";

function Menu({ id, label, summary, active, onToggle, disabled, children }) {
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
        aria-controls={`detail-toolbar-${id}`}
        aria-label={`${label}，当前：${summary}`}
        title={`${label}：${summary}`}
        onClick={() => onToggle(active ? "" : id)}
      >
        <strong>{label}</strong>
        <i className="bi bi-chevron-down" />
      </button>
      {active ? (
        <section
          id={`detail-toolbar-${id}`}
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

export function DetailTopToolbar({
  modelId,
  modelOptions,
  onChangeModelId,
  platform,
  platformOptions,
  onChangePlatform,
  market,
  marketOptions,
  onChangeMarket,
  language,
  languageOptions,
  onChangeLanguage,
  tone,
  toneOptions,
  onChangeTone,
  productName,
  onChangeProductName,
  sellingPoints,
  onChangeSellingPoints,
  textStable,
  onToggleTextStable,
  disabled,
}) {
  const [activeMenu, setActiveMenu] = useState("");
  const rootRef = useRef(null);

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
      aria-label="A+详情顶部设置"
    >
      <label className="commerce-header__model accessory-toolbar__model">
        <span>生成模型</span>
        <CommerceSelect
          value={modelId}
          options={modelOptions}
          onChange={onChangeModelId}
          placeholder="请选择模型"
          ariaLabel="选择详情生成模型"
          disabled={disabled}
        />
      </label>

      <Menu
        id="channel"
        label="投放设置"
        summary={`${platform || "平台"} · ${market || "市场"}`}
        active={activeMenu === "channel"}
        onToggle={setActiveMenu}
        disabled={disabled}
      >
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
              ariaLabel="选择详情投放平台"
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
              ariaLabel="选择详情目标市场"
              disabled={disabled}
            />
          </label>
          <label>
            <span>文案语言</span>
            <CommerceSelect
              value={language}
              options={languageOptions.map((item) => ({
                value: item,
                label: item,
              }))}
              onChange={onChangeLanguage}
              ariaLabel="选择详情文案语言"
              disabled={disabled}
            />
          </label>
          <label>
            <span>视觉风格</span>
            <CommerceSelect
              value={tone}
              options={toneOptions.map((item) => ({
                value: item,
                label: item,
              }))}
              onChange={onChangeTone}
              ariaLabel="选择详情视觉风格"
              disabled={disabled}
            />
          </label>
        </div>
      </Menu>

      <Menu
        id="product"
        label="商品信息"
        summary={productName || sellingPoints ? "已填写" : "可选"}
        active={activeMenu === "product"}
        onToggle={setActiveMenu}
        disabled={disabled}
      >
        <div className="accessory-toolbar__product-fields">
          <label>
            <span>商品名称</span>
            <input
              value={productName}
              onChange={(event) => onChangeProductName?.(event.target.value)}
              placeholder="例如：无线降噪蓝牙耳机"
              disabled={disabled}
            />
          </label>
          <label>
            <span>核心卖点</span>
            <textarea
              rows={3}
              value={sellingPoints}
              onChange={(event) => onChangeSellingPoints?.(event.target.value)}
              placeholder="填写核心卖点、适用人群、期望场景和具体参数…"
              disabled={disabled}
            />
          </label>
          <button
            type="button"
            className={`text-stability-control${textStable ? " active" : ""}`}
            role="switch"
            aria-checked={textStable}
            disabled={disabled}
            onClick={() => onToggleTextStable?.()}
          >
            <span>
              <i className="bi bi-fonts" />
            </span>
            <span>
              <strong>文字稳定性</strong>
              <small>锁定已提供文案，无法可靠生成时优先留白</small>
            </span>
            <i className="text-stability-switch">
              <b />
            </i>
          </button>
        </div>
      </Menu>
    </div>
  );
}
