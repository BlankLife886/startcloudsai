import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DotLoading, NoticeBar, Skeleton } from "antd-mobile";
import { LeftOutline } from "antd-mobile-icons";
import { ActionSheet, Dialog, ImageViewer, Toast } from "@mobile/components/overlay/index.js";
import { useAuth } from "@react/auth/AuthContext.jsx";
import { useTextToImageJobs } from "@react/features/text-to-image/useTextToImageJobs.js";
import { useReferenceDraft } from "@react/features/text-to-image/useReferenceDraft.js";
import { pendingBatchEntries } from "@react/features/text-to-image/submissionBatch.js";
import { downloadAuthenticatedMedia } from "@react/legacy-modules/services/authenticatedMedia.js";
import { goLogin } from "@mobile/app/login.js";
import { subscribeCreateInbox, takeCreatePayload } from "@mobile/app/createInbox.js";
import { useKeyboardInset } from "@mobile/hooks/useKeyboardInset.js";
import { useGoBack } from "@mobile/app/navigation.js";
import { Composer } from "./Composer.jsx";
import { ParamsSheet, ReferencesSheet } from "./ParamsSheet.jsx";
import { CreationTurn } from "./CreationTurn.jsx";
import { useCreateSettings } from "./useCreateSettings.js";
import { useGenerate } from "./useGenerate.jsx";
import { ACTIVE_STATUSES, buildWorkGroups, mergeTasks } from "./workGroups.js";
import "./create.css";

const BUSY_LABELS = { uploading: "上传中", submitting: "提交中", recovering: "核对中" };

function useNow(enabled) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

const NEAR_BOTTOM = 160;

function distanceToBottom() {
  return document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
}

function TimelineSkeleton() {
  return (
    <div className="m-timeline">
      {[0, 1].map((index) => (
        <div key={index} className="m-turn">
          <Skeleton animated className="m-skeleton-bubble" />
          <Skeleton animated className="m-skeleton-image" />
        </div>
      ))}
    </div>
  );
}

export default function CreatePage({ active = true }) {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const form = useCreateSettings(user?.id);
  const { references, setReferences, referencesReady } = useReferenceDraft(user?.id);
  const jobs = useTextToImageJobs({ authenticated: isAuthenticated, userId: user?.id, historyActive: true });
  const keyboardInset = useKeyboardInset();
  const goBack = useGoBack("/design");
  const inputRef = useRef(null);
  const topSentinelRef = useRef(null);
  const timelineRef = useRef(null);
  const [sheet, setSheet] = useState("");
  const [viewer, setViewer] = useState(null);
  const [regenerate, setRegenerate] = useState(false);

  const groups = useMemo(() => buildWorkGroups(mergeTasks(jobs.historyTasks, jobs.tasks)), [jobs.historyTasks, jobs.tasks]);
  // 与 App 一样按对话排列：最早的在上，最新的贴着输入栏，往上滑看历史。
  const timeline = useMemo(() => [...groups].reverse(), [groups]);
  const hasActive = groups.some((group) => group.pendingCount > 0);
  const now = useNow(hasActive);
  const modelLabels = useMemo(() => new Map(form.models.map((item) => [item.id, item.label])), [form.models]);

  // ── 滚动：停在底部时新内容出现也保持在底部；往上加载更早的作品时保持当前位置不跳 ──
  const pinnedRef = useRef(true);
  const anchorRef = useRef(null);
  const initialScrollDone = useRef(false);
  const scrollToBottom = useCallback((smooth = false) => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const onScroll = () => {
      pinnedRef.current = distanceToBottom() < NEAR_BOTTOM;
      // 加载期间用户还在滑：跟着更新锚点位置，加载完不会被拽回去。
      const anchor = anchorRef.current;
      if (anchor?.key) {
        const node = timelineRef.current?.querySelector(`[data-turn="${CSS.escape(anchor.key)}"]`);
        if (node) anchor.top = node.getBoundingClientRect().top;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [active]);

  // 页面在后台时轮询照样会更新列表，但不能去滚动别的页面。
  useLayoutEffect(() => {
    if (!active || !timeline.length) return;
    const anchor = anchorRef.current;
    if (anchor && !jobs.historyLoadingMore) {
      anchorRef.current = null;
      const node = anchor.key && timelineRef.current?.querySelector(`[data-turn="${CSS.escape(anchor.key)}"]`);
      if (node) window.scrollBy(0, node.getBoundingClientRect().top - anchor.top);
      return;
    }
    if (!initialScrollDone.current) {
      initialScrollDone.current = true;
      scrollToBottom();
      return;
    }
    if (pinnedRef.current) scrollToBottom();
  }, [active, jobs.historyLoadingMore, scrollToBottom, timeline]);

  // 输入栏高度变化、图片排版变化时，停在底部的继续贴底。
  useEffect(() => {
    const node = timelineRef.current;
    if (!node || !active) return undefined;
    const observer = new ResizeObserver(() => { if (pinnedRef.current && !anchorRef.current) scrollToBottom(); });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, scrollToBottom, timeline.length > 0]);

  // 滑到顶部附近自动加载更早的作品。
  useEffect(() => {
    const node = topSentinelRef.current;
    if (!node || !jobs.historyHasMore || !initialScrollDone.current) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || jobs.historyLoadingMore || anchorRef.current) return;
      // 记住此刻最上面那组在屏幕上的位置，加载完把它放回原处。
      const turn = timelineRef.current?.querySelector("[data-turn]");
      anchorRef.current = { key: turn?.dataset.turn || "", top: turn?.getBoundingClientRect().top || 0 };
      jobs.loadMoreHistory();
    }, { rootMargin: "600px 0px 0px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [jobs, jobs.historyHasMore, jobs.historyLoadingMore, timeline.length]);

  const { generate, resumePending, quoting, busy } = useGenerate({
    jobs,
    form,
    references,
    setReferences,
    user,
    authenticated: isAuthenticated,
    onSubmitted: () => {
      inputRef.current?.blur();
      pinnedRef.current = true;
      window.setTimeout(() => scrollToBottom(true), 60);
    },
  });

  // “重新生成”先把参数写回表单，等表单状态生效后再走一遍正常的生成流程。
  useEffect(() => {
    if (!regenerate) return;
    setRegenerate(false);
    void generate();
  }, [generate, regenerate]);

  const addReferenceFiles = useCallback((fileList) => {
    const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    setReferences((current) => {
      const slots = Math.max(0, form.maxReferences - current.length);
      if (files.length > slots) Toast.show({ content: `最多 ${form.maxReferences} 张参考图` });
      return [...current, ...files.slice(0, slots).map((file) => ({
        id: crypto.randomUUID(), name: file.name, file, url: "", preview: URL.createObjectURL(file),
      }))];
    });
  }, [form.maxReferences, setReferences]);

  const addReferenceUrl = useCallback((url) => {
    setReferences((current) => {
      if (current.length >= form.maxReferences) {
        Toast.show({ content: `最多 ${form.maxReferences} 张参考图` });
        return current;
      }
      if (current.some((item) => item.url === url)) return current;
      Toast.show({ content: "已添加为参考图" });
      return [...current, { id: crypto.randomUUID(), name: "作品参考图", url, preview: url }];
    });
  }, [form.maxReferences, setReferences]);

  // 接收首页、提示词等投递过来的提示词：覆盖当前描述。
  const formUpdate = form.update;
  useEffect(() => {
    const receive = (payload) => {
      if (!payload?.prompt) return;
      formUpdate({ prompt: payload.prompt });
      Toast.show({ content: "已带入提示词，点下方按钮即可生成" });
    };
    receive(takeCreatePayload());
    return subscribeCreateInbox((payload) => receive(takeCreatePayload() || payload));
  }, [formUpdate]);

  const removeReference = useCallback((id) => {
    setReferences((current) => current.filter((item) => item.id !== id));
  }, [setReferences]);

  const reuse = useCallback((group, count = Math.max(1, group.cells.length)) => {
    const task = group.lead;
    form.update({
      prompt: task.prompt || "",
      ...(task.publicModelKey ? { modelId: task.publicModelKey } : {}),
      ...(task.aspectRatio ? { ratio: task.aspectRatio } : {}),
      ...(task.resolutionScale ? { resolution: task.resolutionScale } : {}),
      ...(task.imageQuality ? { quality: task.imageQuality } : {}),
      count,
      polish: task.promptPolishEnabled === true,
      translate: task.autoTranslateEnabled === true,
    });
  }, [form]);

  const removeTasks = useCallback(async (tasks, content) => {
    if (tasks.some((task) => ACTIVE_STATUSES.has(task.status))) {
      Toast.show({ content: "生成中的作品暂不能删除" });
      return;
    }
    const ok = await Dialog.confirm({ content, confirmText: "确认删除", danger: true });
    if (!ok) return;
    try {
      for (const task of tasks) await jobs.removeTask(task);
      Toast.show({ icon: "success", content: "已删除" });
    } catch (error) {
      Toast.show({ icon: "fail", content: error?.message || "删除失败" });
    }
  }, [jobs]);

  const saveImage = useCallback(async (cell) => {
    const handler = Toast.show({ icon: "loading", content: "正在保存", duration: 0 });
    try {
      await downloadAuthenticatedMedia(cell.url, `starclouds-${cell.task.id}.png`);
      handler.close();
      Toast.show({ icon: "success", content: "已保存，也可长按大图存到相册" });
    } catch (error) {
      handler.close();
      Toast.show({ icon: "fail", content: error?.message || "保存失败" });
    }
  }, []);

  const copyPrompt = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      Toast.show({ content: "提示词已复制" });
    } catch {
      Toast.show({ content: "复制失败，请长按文字手动复制" });
    }
  }, []);

  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const groupOf = useCallback((cell) => groupsRef.current.find((item) => item.cells.some((entry) => entry.key === cell.key)), []);

  // 长按提示词气泡：整组操作。
  const openPromptMenu = useCallback((group) => {
    ActionSheet.show({
      closeOnAction: true,
      cancelText: "取消",
      actions: [
        { key: "reuse", text: "复用这组参数", onClick: () => { reuse(group); inputRef.current?.focus(); } },
        { key: "copy", text: "复制提示词", disabled: !group.lead.prompt, onClick: () => copyPrompt(group.lead.prompt) },
        { key: "delete", text: "删除这组", danger: true, onClick: () => removeTasks(group.tasks, `删除这组作品（${group.cells.length} 张）？删除后无法恢复。`) },
      ],
    });
  }, [copyPrompt, removeTasks, reuse]);

  // 长按图片：与 App 相同的单张操作。
  const openCellMenu = useCallback((cell) => {
    const group = groupOf(cell);
    const siblings = Array.isArray(cell.task.outputs) ? cell.task.outputs.length : 1;
    ActionSheet.show({
      closeOnAction: true,
      cancelText: "取消",
      actions: [
        { key: "regenerate", text: "重新生成", disabled: !group || !cell.task.prompt, onClick: () => { reuse(group, 1); setRegenerate(true); } },
        { key: "reference", text: "作为参考图", onClick: () => addReferenceUrl(cell.url) },
        { key: "save", text: "下载", onClick: () => saveImage(cell) },
        { key: "copy", text: "复制提示词", disabled: !cell.task.prompt, onClick: () => copyPrompt(cell.task.prompt) },
        {
          key: "delete",
          text: "删除这张",
          danger: true,
          onClick: () => removeTasks([cell.task], siblings > 1
            ? `这条任务的 ${siblings} 张图会一起删除，删除后无法恢复。`
            : "只删除这张图，同一组里的其他结果会保留，删除后无法恢复。"),
        },
      ],
    });
  }, [addReferenceUrl, copyPrompt, groupOf, removeTasks, reuse, saveImage]);

  const openImage = useCallback((cell) => {
    const group = groupOf(cell);
    if (!group) return;
    setViewer({ images: group.images, index: group.images.findIndex((image) => image.key === cell.key) });
  }, [groupOf]);

  const pendingCount = pendingBatchEntries(jobs.pendingBatch).length;
  const viewerImage = viewer ? viewer.images[viewer.index] : null;

  let body;
  if (authLoading || (isAuthenticated && jobs.historyLoading && !groups.length)) {
    body = <TimelineSkeleton />;
  } else if (!isAuthenticated) {
    body = (
      <div className="m-empty">
        <span>登录后，生成的作品会出现在这里</span>
        <button type="button" className="m-btn-primary m-pressable" onClick={goLogin}>登录</button>
      </div>
    );
  } else if (!groups.length) {
    body = <div className="m-empty"><span>生成后会出现在这里，往上滑就能看历史</span></div>;
  } else {
    body = (
      <div ref={timelineRef} className="m-timeline">
        <div ref={topSentinelRef} className="m-feed-end">
          {jobs.historyLoadingMore ? <DotLoading /> : jobs.historyHasMore ? "" : "没有更早的作品了"}
        </div>
        {timeline.map((group) => (
          <CreationTurn
            key={group.key}
            group={group}
            // 只有生成中的组需要每秒走的计时，其余组拿固定值以免跟着重渲染
            now={group.pendingCount ? now : 0}
            modelLabel={modelLabels.get(group.lead.publicModelKey) || group.lead.modelName || ""}
            onOpenImage={openImage}
            onCellMenu={openCellMenu}
            onPromptMenu={openPromptMenu}
          />
        ))}
      </div>
    );
  }

  const notice = pendingCount > 0 ? (
    <NoticeBar
      className="m-pending-notice"
      color="alert"
      content={`还有 ${pendingCount} 张未提交，参数已保留`}
      extra={(
        <span className="m-notice-actions">
          <button type="button" onClick={resumePending} disabled={busy}>恢复提交</button>
          <button type="button" onClick={jobs.discardPendingBatch} disabled={busy}>结束</button>
        </span>
      )}
    />
  ) : null;

  return (
    <div className="m-create">
      <header className="m-header">
        <button type="button" className="m-header-back m-pressable" aria-label="返回" onClick={goBack}>
          <LeftOutline />
        </button>
        <h1>文生图</h1>
        <span className="m-header-side" />
      </header>

      <main className="m-main">{body}</main>

      <Composer
        form={form}
        references={references}
        notice={notice}
        onAddFiles={addReferenceFiles}
        onRemoveReference={removeReference}
        onOpenReferences={() => setSheet("references")}
        onOpenSettings={() => setSheet("settings")}
        onGenerate={generate}
        busy={busy || !referencesReady}
        busyLabel={quoting ? "核算中" : BUSY_LABELS[jobs.submissionPhase] || "准备中"}
        keyboardInset={keyboardInset}
        inputRef={inputRef}
      />

      <ParamsSheet visible={sheet === "settings"} onClose={() => setSheet("")} form={form} />
      <ReferencesSheet
        visible={sheet === "references"}
        onClose={() => setSheet("")}
        references={references}
        maxReferences={form.maxReferences}
        onAdd={() => {
          setSheet("");
          document.querySelector(".m-composer input[type=file]")?.click();
        }}
        onRemove={(id) => {
          removeReference(id);
          if (references.length <= 1) setSheet("");
        }}
      />

      <ImageViewer
        images={viewer ? viewer.images.map((image) => image.previewUrl) : []}
        visible={Boolean(viewer)}
        index={viewer?.index || 0}
        onIndexChange={(index) => setViewer((current) => (current ? { ...current, index } : current))}
        onClose={() => setViewer(null)}
        renderFooter={() => viewerImage && (
          <div className="m-viewer-actions">
            <button type="button" className="m-pressable" onClick={() => saveImage(viewerImage)}>下载</button>
            <button type="button" className="m-pressable" onClick={() => { addReferenceUrl(viewerImage.url); setViewer(null); }}>作参考图</button>
            <button type="button" className="m-pressable" onClick={() => openCellMenu(viewerImage)}>更多</button>
          </div>
        )}
      />
    </div>
  );
}
