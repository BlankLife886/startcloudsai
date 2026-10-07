import { useCallback, useState } from "react";
import { Dialog, Toast } from "@mobile/components/overlay/index.js";
import { quoteServerAiJob } from "@react/legacy-modules/services/aiWallpaper.js";
import { getWallet } from "@react/legacy-modules/services/meApi.js";
import { buildT2iPayload } from "@react/features/text-to-image/t2iRequest.js";
import { batchQuotePayload, pendingBatchEntries } from "@react/features/text-to-image/submissionBatch.js";
import { QUEUE_CAPACITY_CODES, isInsufficientBalanceFailure } from "@react/features/text-to-image/submissionState.js";
import { goLogin } from "@mobile/app/login.js";

const RECHARGE_PATH = "/wallet";

function payloadSettings(form, expectedUnitPriceCents = null) {
  const { settings, model, backgroundRemovalModel, feature } = form;
  return {
    ...settings,
    model,
    imageSize: { sizeMode: "ratio" },
    outputFormat: "auto",
    moderation: "",
    backgroundRemovalModelId: backgroundRemovalModel?.id || "",
    selectedSkillIds: [],
    superResolutionEnabled: feature.superResolutionEnabled !== false,
    expectedUnitPriceCents,
  };
}

async function quote(form, batch) {
  const sample = batchQuotePayload(batch) || buildT2iPayload(payloadSettings(form), {
    sourceUrls: [], batchId: "", batchIndex: 0, batchSize: 1, batchCreatedAt: new Date().toISOString(),
  });
  const [wallet, quoted] = await Promise.allSettled([getWallet(), quoteServerAiJob(sample)]);
  const quotedUnit = quoted.status === "fulfilled" ? Number(quoted.value?.unitPriceCents) : Number.NaN;
  const hasQuote = Number.isFinite(quotedUnit);
  const count = batch ? pendingBatchEntries(batch).length : form.settings.count;
  const removal = (batch ? sample.input?.autoBackgroundRemovalEnabled : form.settings.autoRemove)
    ? Math.max(0, Number(form.backgroundRemovalModel?.pricePoints || 0))
    : 0;
  // 服务端核价只含生成本身，抠图按次另计；核价失败时退回目录价（已含抠图）。
  const unit = hasQuote ? quotedUnit + removal : form.unitCost;
  return {
    count,
    unit,
    total: unit * count,
    quotedUnit: hasQuote ? quotedUnit : null,
    available: wallet.status === "fulfilled"
      ? Math.max(0, Number(wallet.value?.availableCents ?? wallet.value?.balanceCents ?? 0))
      : null,
  };
}

function goRecharge() {
  window.location.assign(RECHARGE_PATH);
}

/** 提交生成：核价 → 确认 → 提交批次；规则与桌面端一致，只是确认与提示换成手机交互。 */
export function useGenerate({ jobs, form, references, setReferences, user, authenticated, onSubmitted }) {
  const [quoting, setQuoting] = useState(false);

  const confirmCost = useCallback(async (batch) => {
    setQuoting(true);
    let cost;
    try {
      cost = await quote(form, batch);
    } finally {
      setQuoting(false);
    }
    if (cost.available != null && cost.total > cost.available) {
      const recharge = await Dialog.confirm({
        title: "积分不足",
        content: `本次需要 ${cost.total} 积分，当前可用 ${cost.available} 积分。`,
        confirmText: "去充值",
        cancelText: "取消",
      });
      if (recharge) goRecharge();
      return null;
    }
    if (user?.requireCostConfirm === false && !batch) return cost;
    const ok = await Dialog.confirm({
      title: batch ? "继续提交剩余图片" : "确认生成",
      content: (
        <div className="m-cost-confirm">
          <div><span>生成</span><strong>{cost.count} 张</strong></div>
          <div><span>消耗</span><strong>{cost.total} 积分</strong></div>
          {cost.available != null && <div><span>生成后余额</span><strong>{cost.available - cost.total} 积分</strong></div>}
        </div>
      ),
      confirmText: "生成",
      cancelText: "取消",
    });
    return ok ? cost : null;
  }, [form, user?.requireCostConfirm]);

  const submit = useCallback(async ({ retryBatch = null, cost }) => {
    try {
      await jobs.createBatch({
        count: form.settings.count,
        references,
        retryBatch,
        confirmedUnitPrice: retryBatch ? cost?.quotedUnit ?? null : null,
        buildPayload: (batch) => buildT2iPayload(payloadSettings(form, cost?.quotedUnit ?? null), batch),
        onReferencePrepared: (id, prepared) => setReferences((current) => current.map((item) => (item.id === id ? { ...item, ...prepared } : item))),
      });
      onSubmitted?.();
    } catch (error) {
      if (error?.name === "AbortError" && !error.batch) return;
      if (QUEUE_CAPACITY_CODES.has(error?.code)) {
        Toast.show({ content: `${error.message}，名额释放后可继续提交`, duration: 3000 });
        return;
      }
      if (error?.code === "price_changed") {
        Toast.show({ content: "价格有更新，请重新确认费用" });
        return;
      }
      Toast.show({ icon: "fail", content: error?.message || "提交失败，请稍后重试", duration: 3000 });
    }
  }, [form, jobs, onSubmitted, references, setReferences]);

  const generate = useCallback(async () => {
    if (!authenticated) {
      goLogin();
      return;
    }
    if (quoting || jobs.submitting || jobs.submissionPhase === "recovering") return;
    if (!form.settings.prompt.trim()) {
      Toast.show({ content: "先描述一下你想要的画面" });
      return;
    }
    if (!form.model) {
      Toast.show({ content: "暂无可用模型，请稍后再试" });
      return;
    }
    try {
      const cost = await confirmCost(null);
      if (cost) await submit({ cost });
    } catch (error) {
      Toast.show({ icon: "fail", content: error?.message || "费用读取失败，请稍后重试" });
    }
  }, [authenticated, confirmCost, form.model, form.settings.prompt, jobs.submissionPhase, jobs.submitting, quoting, submit]);

  const resumePending = useCallback(async () => {
    const batch = jobs.pendingBatch;
    if (!batch) return;
    const remaining = pendingBatchEntries(batch);
    if (remaining.length && remaining.every((entry) => isInsufficientBalanceFailure(entry.error))) {
      goRecharge();
      return;
    }
    try {
      const cost = await confirmCost(batch);
      if (cost) await submit({ retryBatch: batch, cost });
    } catch (error) {
      Toast.show({ icon: "fail", content: error?.message || "费用读取失败，请稍后重试" });
    }
  }, [confirmCost, jobs.pendingBatch, submit]);

  return {
    generate,
    resumePending,
    quoting,
    busy: quoting || jobs.submitting || jobs.submissionPhase === "recovering",
  };
}
