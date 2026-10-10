import { useEffect, useState } from "react";
import { Switch } from "antd-mobile";
import { BottomSheet, Dialog, ImageViewer, Toast } from "@mobile/components/overlay/index.js";
import { SharePublishDialog } from "@react/components/SharePublishDialog.jsx";
import { downloadAssistantImage, imageDisplayUrl, imageUrl } from "@react/features/assistant/assistantWorkspaceCore.jsx";

/** 控制器里某个“待确认”状态出现时弹一次确认框，结果回给控制器。 */
function useConfirm(target, build, onResult) {
  useEffect(() => {
    if (!target) return;
    let settled = false;
    Dialog.confirm(build(target)).then((ok) => {
      settled = true;
      onResult(ok, target);
    });
    return () => {
      if (!settled) onResult(false, target);
    };
    // 只在目标变化时弹出；build / onResult 每次渲染都是新函数。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
}

function CostSheet({ payload, onCancel, onConfirm }) {
  const [skip, setSkip] = useState(false);
  const [last, setLast] = useState(payload);
  useEffect(() => {
    if (payload) {
      setLast(payload);
      setSkip(false);
    }
  }, [payload]);
  const data = payload || last;
  if (!data) return null;
  const total = Math.max(0, Number(data.total || 0));
  const available = Number.isFinite(Number(data.available)) ? Math.max(0, Number(data.available)) : null;
  const insufficient = available != null && total > available;
  return (
    <BottomSheet
      visible={Boolean(payload)}
      onClose={onCancel}
      title={data.title || "确认本次创作"}
      className="m-as-sheet"
      footer={(
        <div className="m-as-cost-actions">
          <button type="button" className="m-as-ghost-btn" onClick={onCancel}>取消</button>
          {insufficient ? (
            <button type="button" className="m-btn-primary" onClick={() => window.location.assign("/pricing?plan=topup")}>去充值</button>
          ) : (
            <button type="button" className="m-btn-primary" onClick={() => onConfirm(skip)}>确认生成</button>
          )}
        </div>
      )}
    >
      {data.summary && <p className="m-as-cost-summary">{data.summary}</p>}
      <div className="m-as-cost-rows">
        <div><span>本次预计</span><strong>{total.toLocaleString("zh-CN")} 积分</strong></div>
        <div><span>计费</span><strong>{data.unit} 积分 / {data.unitLabel} × {data.count} {data.unitLabel}</strong></div>
        <div><span>当前可用</span><strong>{available == null ? "读取中" : `${available.toLocaleString("zh-CN")} 积分`}</strong></div>
        <div className={insufficient ? "is-danger" : ""}>
          <span>{insufficient ? "还差" : "预留后余额"}</span>
          <strong>{available == null ? "待计算" : insufficient ? `${(total - available).toLocaleString("zh-CN")} 积分` : `${Math.max(0, available - total).toLocaleString("zh-CN")} 积分`}</strong>
        </div>
      </div>
      {!insufficient && (
        <label className="m-as-cost-skip">
          <span>不再每次确认</span>
          <Switch checked={skip} onChange={setSkip} />
        </label>
      )}
    </BottomSheet>
  );
}

function RenameSheet({ workspace }) {
  const { renamingId, renameDraft, setRenameDraft, renameSaving, cancelRename, commitRename } = workspace;
  return (
    <BottomSheet
      visible={Boolean(renamingId)}
      onClose={cancelRename}
      title="重命名对话"
      className="m-as-sheet"
      footer={(
        <div className="m-as-cost-actions">
          <button type="button" className="m-as-ghost-btn" onClick={cancelRename}>取消</button>
          <button type="button" className="m-btn-primary" disabled={renameSaving || !renameDraft.trim()} onClick={() => void commitRename()}>保存</button>
        </div>
      )}
    >
      <input
        className="m-as-rename"
        value={renameDraft}
        maxLength={80}
        autoFocus
        enterKeyHint="done"
        onChange={(event) => setRenameDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") void commitRename(); }}
      />
    </BottomSheet>
  );
}

/** 全屏看图：与 App 的预览页一致的操作（继续编辑除外，那是桌面端的修图工作台）。 */
function Viewer({ workspace }) {
  const { selectedImage, closeImage, stepImage, useGeneratedImageAsReference, favoriteAssistantImage, requestDeleteImage, requestPublishImage, conversationHasWork } = workspace;
  const gallery = selectedImage?.gallery || [];
  const item = selectedImage ? gallery[selectedImage.index] || selectedImage.item : null;
  const generated = Boolean(selectedImage?.meta);
  const save = async () => {
    try {
      await downloadAssistantImage(item);
      Toast.show({ icon: "success", content: "已保存，也可长按图片存到相册" });
    } catch (error) {
      Toast.show({ icon: "fail", content: error?.message || "保存失败" });
    }
  };
  return (
    <ImageViewer
      images={gallery.map((entry) => imageDisplayUrl(entry) || imageUrl(entry))}
      visible={Boolean(selectedImage)}
      index={selectedImage?.index || 0}
      onIndexChange={(index) => stepImage(index - (selectedImage?.index || 0))}
      onClose={closeImage}
      renderFooter={() => item && (
        <div className="m-viewer-actions">
          <button type="button" className="m-pressable" onClick={save}>下载</button>
          <button type="button" className="m-pressable" onClick={() => { useGeneratedImageAsReference(item); closeImage(); }}>作参考图</button>
          {generated && item.fileKey && <button type="button" className="m-pressable" onClick={() => void favoriteAssistantImage(item, selectedImage.meta)}>收藏</button>}
          {generated && <button type="button" className="m-pressable" onClick={() => requestPublishImage(item, selectedImage.meta)}>投稿</button>}
          {generated && !conversationHasWork && <button type="button" className="m-pressable" onClick={() => requestDeleteImage(item, selectedImage.meta)}>删除</button>}
        </div>
      )}
    />
  );
}

/** 控制器驱动的各种确认与弹层，换成手机端的底部弹层和确认框。 */
export function AssistantDialogs({ workspace }) {
  const {
    costPayload,
    cancelCost,
    confirmCost,
    stopConfirmOpen,
    setStopConfirmOpen,
    stopRun,
    activeCancelPolicy,
    deleteTarget,
    setDeleteTarget,
    deleteTargetHasWork,
    deleteConversationRow,
    toolActionTarget,
    setToolActionTarget,
    confirmAssistantToolAction,
    imageDeleteTarget,
    setImageDeleteTarget,
    confirmDeleteImage,
    shareTarget,
    setShareTarget,
    shareSubmitting,
    submitAssistantShare,
  } = workspace;

  useConfirm(stopConfirmOpen || null, () => ({
    title: "停止本次生成？",
    content: activeCancelPolicy?.message || "任务仍在进行中，停止后将按当前实际阶段处理费用。",
    confirmText: "停止",
    cancelText: "继续生成",
    danger: true,
  }), (ok) => {
    if (ok) void stopRun();
    else setStopConfirmOpen(false);
  });

  useConfirm(deleteTarget, (target) => ({
    title: deleteTargetHasWork ? "停止任务并删除对话？" : "删除这个对话？",
    content: deleteTargetHasWork
      ? "仍有正在执行或排队的任务。继续操作会先停止全部任务，再永久删除对话记录和其中生成的图片；尚未执行的排队任务会退款。"
      : `“${target.title || "新对话"}”的对话记录和其中生成的图片会一并永久删除，无法恢复。已收藏到资产库的图片不受影响。`,
    confirmText: deleteTargetHasWork ? "停止任务并删除" : "删除",
    danger: true,
  }), (ok) => {
    if (ok) void deleteConversationRow();
    else setDeleteTarget(null);
  });

  useConfirm(toolActionTarget, (target) => ({
    title: `确认${target?.action?.title || "执行这个工具"}？`,
    content: target?.action?.description || "确认后继续执行。可能产生费用的生成步骤仍会在目标页面单独确认。",
    confirmText: target?.action?.buttonLabel || "确认执行",
  }), (ok) => {
    if (ok) void confirmAssistantToolAction();
    else setToolActionTarget(null);
  });

  useConfirm(imageDeleteTarget, () => ({
    title: "删除这张图片？",
    content: "图片会从当前对话中移除，删除后无法恢复。",
    confirmText: "删除",
    danger: true,
  }), (ok) => {
    if (ok) void confirmDeleteImage();
    else setImageDeleteTarget(null);
  });

  return (
    <>
      <CostSheet payload={costPayload} onCancel={cancelCost} onConfirm={(skip) => void confirmCost(skip)} />
      <RenameSheet workspace={workspace} />
      <Viewer workspace={workspace} />
      <SharePublishDialog
        open={Boolean(shareTarget)}
        title={String(shareTarget?.meta?.prompt || shareTarget?.item?.revisedPrompt || "AI 助手创作").slice(0, 120)}
        submitting={shareSubmitting}
        light={document.documentElement.getAttribute("data-prefers-color-scheme") !== "dark"}
        onClose={() => !shareSubmitting && setShareTarget(null)}
        onSubmit={(options) => void submitAssistantShare(options)}
      />
    </>
  );
}
