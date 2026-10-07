import { useEffect, useState } from "react";
import { Switch } from "antd-mobile";
import { ActionSheet, BottomSheet } from "@mobile/components/overlay/index.js";

// 与 App 的质量叫法一致。
const QUALITY_LABELS = { low: "快速", medium: "标准", standard: "标准", high: "高清", hd: "高清" };
const qualityItems = (items) => items.map((item) => ({ ...item, label: QUALITY_LABELS[String(item.id).toLowerCase()] || item.label }));

// 与桌面端开启自动授权时的预设一致。
const AUTO_APPROVE_PRESETS = [30, 60, 100, 200];

function ToolRow({ icon, tone, title, subtitle, disabled, onClick, trailing }) {
  return (
    <button type="button" className="m-as-tool" disabled={disabled} onClick={onClick}>
      <span className={`m-as-tool-icon is-${tone}`}><i className={`bi ${icon}`} /></span>
      <span className="m-as-tool-text">
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      {trailing ?? <i className="bi bi-chevron-right m-as-tool-arrow" />}
    </button>
  );
}

function Chips({ items, value, onChange }) {
  return (
    <div className="m-as-chips">
      {items.map((item) => (
        <button key={item.id} type="button" className={`m-as-chip${String(value) === String(item.id) ? " is-on" : ""}`} onClick={() => onChange(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** “+”工具面板：与 App 的工具列表一致（添加图片、图片参数），另加桌面端已有的自动授权与记忆。 */
export function ToolsSheet({ visible, onClose, workspace, onOpenMemory }) {
  const {
    mode,
    creationType,
    fileInputRef,
    maxReferences,
    atReferenceLimit,
    references,
    generationRatio,
    setGenerationRatio,
    generationResolution,
    setGenerationResolution,
    generationQuality,
    setGenerationQuality,
    generationCount,
    setGenerationCount,
    availableRatios,
    availableResolutions,
    availableQualities,
    availableCounts,
    assistantAutoApprove,
    assistantAutoApproveBudgetCents,
    setAssistantAutoApprove,
  } = workspace;
  const [view, setView] = useState("tools");
  useEffect(() => {
    if (!visible) setView("tools");
  }, [visible]);

  const imageOnly = mode === "image";
  const attachSubtitle = imageOnly
    ? maxReferences <= 0 ? "当前模型不支持参考图" : `参考图 ${references.length}/${maxReferences}，从相册或相机选择`
    : "图片、PDF、Word、Excel、PPT 等";

  const toggleAutoApprove = () => {
    if (assistantAutoApprove) {
      void setAssistantAutoApprove(false);
      return;
    }
    ActionSheet.show({
      cancelText: "取消",
      actions: AUTO_APPROVE_PRESETS.map((budget) => ({
        key: String(budget),
        text: `单轮 ${budget} 积分内直接出图`,
        onClick: () => void setAssistantAutoApprove(true, budget),
      })),
    });
  };

  const ratioLabel = generationRatio === "auto" ? "自动比例" : generationRatio;
  const qualityLabel = qualityItems(availableQualities).find((item) => item.id === generationQuality)?.label;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={view === "image" ? "图片参数" : "更多工具"} className="m-as-sheet">
      {view === "image" ? (
        <div className="m-as-image-settings">
          {availableResolutions.length > 0 && (
            <>
              <h3 className="m-as-sheet-label">分辨率</h3>
              <Chips items={availableResolutions} value={generationResolution} onChange={setGenerationResolution} />
            </>
          )}
          {availableRatios.length > 0 && (
            <>
              <h3 className="m-as-sheet-label">画面比例</h3>
              <Chips items={availableRatios} value={generationRatio} onChange={setGenerationRatio} />
            </>
          )}
          {availableQualities.length > 0 && (
            <>
              <h3 className="m-as-sheet-label">质量</h3>
              <Chips items={qualityItems(availableQualities)} value={generationQuality} onChange={setGenerationQuality} />
            </>
          )}
          {availableCounts.length > 0 && (
            <>
              <h3 className="m-as-sheet-label">生成张数</h3>
              <Chips items={availableCounts.map((count) => ({ id: count, label: `${count} 张` }))} value={generationCount} onChange={(value) => setGenerationCount(Number(value))} />
            </>
          )}
          <button type="button" className="m-btn-primary m-as-sheet-done" onClick={onClose}>完成</button>
        </div>
      ) : (
        <div className="m-as-group">
          <ToolRow
            icon="bi-image"
            tone="ink"
            title={imageOnly ? "添加参考图" : "添加图片或文档"}
            subtitle={attachSubtitle}
            disabled={imageOnly && (maxReferences <= 0 || atReferenceLimit)}
            onClick={() => {
              onClose();
              fileInputRef.current?.click();
            }}
          />
          {imageOnly && (
            <ToolRow
              icon="bi-aspect-ratio"
              tone="rose"
              title="图片参数"
              subtitle={[generationResolution, ratioLabel, qualityLabel, `${generationCount} 张`].filter(Boolean).join(" · ")}
              onClick={() => setView("image")}
            />
          )}
          {creationType === "agent" && (
            <ToolRow
              icon={assistantAutoApprove ? "bi-lightning-charge-fill" : "bi-lightning-charge"}
              tone="gold"
              title="自动授权"
              subtitle={assistantAutoApprove
                ? `已开启：单轮 ${assistantAutoApproveBudgetCents} 积分内直接出图`
                : "已关闭：出图前先给你方案卡确认"}
              onClick={toggleAutoApprove}
              trailing={<Switch checked={assistantAutoApprove} onChange={toggleAutoApprove} />}
            />
          )}
          <ToolRow
            icon="bi-bookmark-heart"
            tone="green"
            title="记忆"
            subtitle="助手记住的偏好、商品与提醒"
            onClick={() => {
              onClose();
              onOpenMemory();
            }}
          />
        </div>
      )}
    </BottomSheet>
  );
}
