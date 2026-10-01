import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";

gsap.registerPlugin(useGSAP);

const EMPTY_STATE = {
  chat: {
    title: "今天想聊点什么？",
    hint: "只进行对话，不会调用图片生成",
    suggestions: [
      { icon: "bi-chat-left-dots", text: "用三句话介绍你能帮我做什么" },
      { icon: "bi-lightbulb", text: "帮我把一个模糊的想法讲清楚" },
      { icon: "bi-pencil-square", text: "把这段话改得更简洁有力" },
      { icon: "bi-book", text: "用更口语的方式解释一个概念" },
    ],
  },
  agent: {
    title: "今天想完成什么？",
    hint: "可以回答问题，也可以整理生图方案",
    suggestions: [
      { icon: "bi-stars", text: "画一张星空下的雪山桌面壁纸" },
      { icon: "bi-palette", text: "帮我规划一套品牌视觉方案" },
      { icon: "bi-file-earmark-slides", text: "制作一份 6 页的产品发布会 PPT", requiresEditableFiles: true },
      { icon: "bi-layers", text: "把我上传的海报拆成可编辑 PSD", requiresEditableFiles: true },
      { icon: "bi-list-check", text: "帮我把灵感整理成可执行的创作步骤" },
    ],
  },
  image: {
    title: "今天想画什么？",
    hint: "描述画面，也可以上传参考图",
    suggestions: [
      { icon: "bi-stars", text: "画一张星空下的雪山桌面壁纸" },
      { icon: "bi-phone", text: "设计一个极简风格的天气 App 图标" },
      { icon: "bi-palette2", text: "生成一组同风格的海报配色" },
      { icon: "bi-camera-reels", text: "把参考图改成电影感夜景" },
    ],
  },
};

function emptyStateSuggestions(creationId, editableFilesEnabled) {
  const suggestions = (EMPTY_STATE[creationId] || EMPTY_STATE.chat).suggestions;
  return suggestions.filter((item) => !item.requiresEditableFiles || editableFilesEnabled).slice(0, 4);
}

function motionDisabled() {
  return document.documentElement.classList.contains("settings-no-animations");
}

export function AssistantEmptyState({ creation, editableFilesEnabled, onPick }) {
  const rootRef = useRef(null);
  const copy = EMPTY_STATE[creation.id] || EMPTY_STATE.chat;

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return undefined;

      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        if (motionDisabled()) return undefined;

        const title = root.querySelector(".empty-title");
        const label = root.querySelector(".empty-mode-label");
        const cards = gsap.utils.toArray(".suggestion-grid button", root);

        gsap
          .timeline({ defaults: { ease: "power2.out" } })
          .from(title, { y: 8, opacity: 0, duration: 0.36, clearProps: "transform,opacity" })
          .from(label, { y: 6, opacity: 0, duration: 0.3, clearProps: "transform,opacity" }, "-=0.22")
          .from(cards, {
            y: 10,
            opacity: 0,
            duration: 0.34,
            stagger: 0.05,
            clearProps: "transform,opacity",
          }, "-=0.18");
        return undefined;
      });

      return () => media.revert();
    },
    { scope: rootRef, dependencies: [creation.id, editableFilesEnabled], revertOnUpdate: true },
  );

  return (
    <section ref={rootRef} className="assistant-empty-state" aria-label="空白创作区">
      <div className="assistant-empty-content">
        <h1 className="empty-title">{copy.title}</h1>
        <p className="empty-mode-label">
          <span className="empty-mode-chip">{creation.label}</span>
          <span className="empty-mode-hint">{copy.hint}</span>
        </p>
        <div className="suggestion-grid">
          {emptyStateSuggestions(creation.id, editableFilesEnabled).map((item) => (
            <button key={item.text} type="button" onClick={() => onPick(item.text)}>
              <span>{item.text}</span>
              <i className="bi bi-arrow-right suggestion-arrow" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
