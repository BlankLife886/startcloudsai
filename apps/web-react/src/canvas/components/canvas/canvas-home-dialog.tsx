import type { ReactNode } from "react";
import { ConfigProvider, Modal } from "antd";
import { X } from "lucide-react";

import { useThemeStore } from "@/stores/use-theme-store";

const DIALOG_CSS = `
.sc-cd-root { z-index: 12000; }
.sc-cd-root .ant-modal-mask,
.sc-cd-root .ant-modal-wrap { z-index: 12000; }
.sc-cd-root .ant-modal { padding: 0; transform-origin: center center; }
.sc-cd-root .ant-modal.ant-zoom-enter-active,
.sc-cd-root .ant-modal.ant-zoom-appear-active {
  animation: sc-cd-in 0.34s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.sc-cd-root .ant-modal.ant-zoom-leave-active {
  animation: sc-cd-out 0.26s cubic-bezier(0.4, 0, 0.2, 1) both;
}
.sc-cd-root .ant-fade-enter-active,
.sc-cd-root .ant-fade-appear-active { animation: sc-cd-mask-in 0.28s ease both; }
.sc-cd-root .ant-fade-leave-active { animation: sc-cd-mask-out 0.22s ease both; }
@keyframes sc-cd-in {
  from { opacity: 0; transform: translateY(16px) scale(0.94); }
  to { opacity: 1; transform: none; }
}
@keyframes sc-cd-out {
  from { opacity: 1; transform: none; }
  to { opacity: 0; transform: translateY(10px) scale(0.92); }
}
@keyframes sc-cd-mask-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes sc-cd-mask-out { from { opacity: 1; } to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .sc-cd-root .ant-modal.ant-zoom-enter-active,
  .sc-cd-root .ant-modal.ant-zoom-appear-active,
  .sc-cd-root .ant-modal.ant-zoom-leave-active,
  .sc-cd-root .ant-fade-enter-active,
  .sc-cd-root .ant-fade-appear-active,
  .sc-cd-root .ant-fade-leave-active { animation-duration: 0.01ms !important; }
}
.sc-cd-root .ant-modal-container,
.sc-cd-root .ant-modal-content {
  padding: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  border: 0 !important;
}
.sc-cd-card {
  position: relative;
  width: 100%;
  padding: 36px 36px 28px;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 24px;
  background: radial-gradient(circle at 16% 0%, rgba(124,58,237,0.18), transparent 36%), #111214 !important;
  box-shadow: 0 30px 88px rgba(0,0,0,0.56);
  color: #f7f7f8;
  box-sizing: border-box;
}
.sc-cd-card.is-danger {
  background: radial-gradient(circle at 16% 0%, rgba(244,63,94,0.18), transparent 36%), #111214 !important;
}
.sc-cd-close {
  appearance: none !important;
  position: absolute;
  top: 18px;
  right: 18px;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid rgba(255,255,255,0.14) !important;
  border-radius: 999px !important;
  background: rgba(12,13,16,0.62) !important;
  color: #fff !important;
  cursor: pointer;
}
.sc-cd-close:hover { background: rgba(255,255,255,0.14); }
.sc-cd-eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 18px;
  color: #a8a8b2;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.2em;
}
.sc-cd-eyebrow i {
  display: block;
  width: 24px;
  height: 2px;
  background: linear-gradient(90deg, #8b5cf6, #f43f8f);
}
.sc-cd-title {
  margin: 0;
  color: #fff;
  font-size: 36px;
  font-weight: 750;
  letter-spacing: -0.04em;
  line-height: 1.05;
}
.sc-cd-desc {
  margin: 14px 0 0;
  max-width: 28em;
  color: #b4b4be;
  font-size: 14px;
  line-height: 1.7;
}
.sc-cd-list { display: flex; flex-direction: column; gap: 8px; margin-top: 24px; }
.sc-cd-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  background: rgba(255,255,255,0.04);
}
.sc-cd-item strong {
  overflow: hidden;
  color: #fff;
  font-size: 14px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-cd-item span, .sc-cd-more { color: #9a9aa6; font-size: 12px; }
.sc-cd-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 24px;
  color: #c4c4ce;
  font-size: 12px;
  font-weight: 650;
}
.sc-cd-field input {
  height: 48px;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 14px;
  background: rgba(255,255,255,0.05);
  padding: 0 14px;
  color: #fff;
  font-size: 15px;
  outline: none;
}
.sc-cd-field input::placeholder { color: #7c7c88; }
.sc-cd-field input:focus {
  border-color: rgba(167,139,250,0.55);
  background: rgba(255,255,255,0.08);
  box-shadow: 0 0 0 4px rgba(139,92,246,0.16);
}
.sc-cd-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 28px;
}
.sc-cd-btn {
  appearance: none !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 6px !important;
  height: 40px !important;
  width: 100% !important;
  padding: 0 16px !important;
  border: 0 !important;
  border-radius: 12px !important;
  background: rgba(167,139,250,0.12) !important;
  color: #ede9fe !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  line-height: 1 !important;
  text-decoration: none !important;
  cursor: pointer !important;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease !important;
}
.sc-cd-btn:hover { background: rgba(167,139,250,0.2) !important; color: #fff !important; }
.sc-cd-btn:active { transform: translateY(0.5px); }
.sc-cd-btn.is-solid {
  background: #6d5cff !important;
  color: #fff !important;
  box-shadow: 0 8px 18px rgba(109,92,255,0.28);
}
.sc-cd-btn.is-solid:hover { background: #5b4dff !important; color: #fff !important; }
.sc-cd-btn.is-danger {
  background: #e11d48 !important;
  color: #fff !important;
  box-shadow: 0 8px 18px rgba(225,29,72,0.22);
}
.sc-cd-btn.is-danger:hover { background: #be123c !important; color: #fff !important; }
.sc-cd-root.is-light .sc-cd-card {
  border-color: rgba(124,58,237,0.1);
  background: radial-gradient(circle at 16% 0%, rgba(167,139,250,0.16), transparent 36%), #fff !important;
  box-shadow: 0 24px 64px rgba(49,32,107,0.14);
  color: #2a2540;
}
.sc-cd-root.is-light .sc-cd-card.is-danger {
  background: radial-gradient(circle at 16% 0%, rgba(244,63,94,0.1), transparent 36%), #fff !important;
}
.sc-cd-root.is-light .sc-cd-close {
  border-color: rgba(124,58,237,0.12) !important;
  background: rgba(245,243,255,0.92) !important;
  color: #5b21b6 !important;
}
.sc-cd-root.is-light .sc-cd-close:hover { background: #ede9fe !important; }
.sc-cd-root.is-light .sc-cd-eyebrow { color: #8b83a3; }
.sc-cd-root.is-light .sc-cd-title { color: #2a2540; }
.sc-cd-root.is-light .sc-cd-desc { color: #7a738f; }
.sc-cd-root.is-light .sc-cd-item {
  border-color: rgba(124,58,237,0.1);
  background: rgba(245,243,255,0.9);
}
.sc-cd-root.is-light .sc-cd-item strong { color: #2a2540; }
.sc-cd-root.is-light .sc-cd-item span,
.sc-cd-root.is-light .sc-cd-more { color: #8b83a3; }
.sc-cd-root.is-light .sc-cd-field { color: #6b6480; }
.sc-cd-root.is-light .sc-cd-field input {
  border-color: rgba(124,58,237,0.14);
  background: #fff;
  color: #2a2540;
}
.sc-cd-root.is-light .sc-cd-field input::placeholder { color: #9a93b0; }
.sc-cd-root.is-light .sc-cd-field input:focus {
  border-color: rgba(124,58,237,0.42);
  box-shadow: 0 0 0 4px rgba(167,139,250,0.16);
}
.sc-cd-root.is-light .sc-cd-btn {
  background: rgba(109,92,255,0.08) !important;
  color: #4c1d95 !important;
}
.sc-cd-root.is-light .sc-cd-btn:hover {
  background: rgba(109,92,255,0.14) !important;
  color: #4c1d95 !important;
}
.sc-cd-root.is-light .sc-cd-btn.is-solid {
  background: #6d5cff !important;
  color: #fff !important;
}
.sc-cd-root.is-light .sc-cd-btn.is-solid:hover { background: #5b4dff !important; color: #fff !important; }
.sc-cd-root.is-light .sc-cd-btn.is-danger {
  background: #e11d48 !important;
  color: #fff !important;
}
.sc-cd-root.is-light .sc-cd-btn.is-danger:hover { background: #be123c !important; color: #fff !important; }
.sc-cd-card.is-cost .sc-cd-title { padding-right: 48px; font-size: 28px; }
.sc-cd-card.is-cost .sc-cd-desc { margin-top: 10px; }
.sc-cd-card.is-cost .sc-cd-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 22px;
}
.sc-cd-card.is-cost .sc-cd-btn {
  width: 100% !important;
  height: 40px !important;
  border: 0 !important;
  background: rgba(109, 92, 255, 0.1) !important;
  color: #6d5cff !important;
  box-shadow: none !important;
}
.sc-cd-card.is-cost .sc-cd-btn:hover {
  background: rgba(109, 92, 255, 0.16) !important;
  color: #5b4dff !important;
}
.sc-cd-card.is-cost .sc-cd-btn.is-solid {
  background: #6d5cff !important;
  color: #fff !important;
  box-shadow: 0 8px 18px rgba(109, 92, 255, 0.28) !important;
}
.sc-cd-card.is-cost .sc-cd-btn.is-solid:hover {
  background: #5b4dff !important;
  color: #fff !important;
}
.sc-cd-quote {
  overflow: hidden;
  margin-top: 22px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 20px;
  background: rgba(255,255,255,0.04);
}
.sc-cd-quote-hero {
  padding: 20px 20px 16px;
  background: radial-gradient(circle at 0% 0%, rgba(167,139,250,0.22), transparent 58%);
}
.sc-cd-quote-hero span {
  display: block;
  color: #8b7cff;
  font-size: 12px;
  font-weight: 650;
}
.sc-cd-quote-hero p {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 6px 0 0;
}
.sc-cd-quote-hero s {
  color: rgba(255,255,255,0.38);
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}
.sc-cd-quote-hero strong {
  color: #fff;
  font-size: 40px;
  font-weight: 760;
  letter-spacing: -0.05em;
  line-height: 0.95;
  font-variant-numeric: tabular-nums;
}
.sc-cd-quote-hero em {
  color: #8b7cff;
  font-size: 15px;
  font-style: normal;
  font-weight: 650;
}
.sc-cd-quote-hero p.is-pending strong { font-size: 20px; letter-spacing: -0.03em; }
.sc-cd-quote-lines {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 14px 20px;
  list-style: none;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
}
.sc-cd-quote-lines li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
}
.sc-cd-quote-lines span {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: #f4f4f6;
  font-size: 13px;
  font-weight: 650;
}
.sc-cd-quote-lines i {
  overflow: hidden;
  color: #9a9aa6;
  font-size: 12px;
  font-style: normal;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-cd-quote-lines em {
  color: #9a9aa6;
  font-size: 12px;
  font-style: normal;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.sc-cd-quote-lines b {
  min-width: 1.25em;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.sc-cd-quote-flow {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  padding: 14px 20px 16px;
  background: rgba(255,255,255,0.03);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
}
.sc-cd-quote-flow > div { min-width: 0; }
.sc-cd-quote-flow > div:last-child { text-align: right; }
.sc-cd-quote-flow svg { color: #8b7cff; }
.sc-cd-quote-flow b {
  display: block;
  color: #9a9aa6;
  font-size: 11px;
  font-weight: 650;
}
.sc-cd-quote-flow strong {
  display: block;
  margin-top: 4px;
  color: #fff;
  font-size: 16px;
  font-weight: 720;
  font-variant-numeric: tabular-nums;
}
.sc-cd-quote.is-danger .sc-cd-quote-flow svg,
.sc-cd-quote.is-danger .sc-cd-quote-flow > div:last-child strong { color: #fb7185; }
.sc-cd-cost-note {
  margin: 10px 0 0;
  color: #b4b4be;
  font-size: 12px;
  line-height: 1.6;
}
.sc-cd-cost-skip {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  color: #c4c4ce;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}
.sc-cd-cost-skip input {
  width: 15px;
  height: 15px;
  accent-color: #7c3aed;
}
.sc-cd-root.is-light .sc-cd-quote {
  border-color: rgba(124,58,237,0.1);
  background: #fff;
}
.sc-cd-root.is-light .sc-cd-quote-hero {
  background: radial-gradient(circle at 0% 0%, rgba(109,92,255,0.12), transparent 62%);
}
.sc-cd-root.is-light .sc-cd-quote-hero span { color: #7c3aed; }
.sc-cd-root.is-light .sc-cd-quote-hero strong { color: #4c1d95; }
.sc-cd-root.is-light .sc-cd-quote-hero em { color: #7c3aed; }
.sc-cd-root.is-light .sc-cd-quote-lines { box-shadow: inset 0 1px 0 rgba(124,58,237,0.08); }
.sc-cd-root.is-light .sc-cd-quote-lines span { color: #2a2540; }
.sc-cd-root.is-light .sc-cd-quote-lines i,
.sc-cd-root.is-light .sc-cd-quote-lines em { color: #8b83a3; }
.sc-cd-root.is-light .sc-cd-quote-lines b { color: #2a2540; }
.sc-cd-root.is-light .sc-cd-quote-flow {
  background: #f7f5ff;
  box-shadow: inset 0 1px 0 rgba(124,58,237,0.08);
}
.sc-cd-root.is-light .sc-cd-quote-flow svg { color: #7c3aed; }
.sc-cd-root.is-light .sc-cd-quote-flow b { color: #8b83a3; }
.sc-cd-root.is-light .sc-cd-quote-flow strong { color: #2a2540; }
.sc-cd-root.is-light .sc-cd-quote.is-danger .sc-cd-quote-flow svg,
.sc-cd-root.is-light .sc-cd-quote.is-danger .sc-cd-quote-flow > div:last-child strong { color: #e11d48; }
.sc-cd-root.is-light .sc-cd-cost-note { color: #7a738f; }
.sc-cd-root.is-light .sc-cd-cost-skip { color: #6b6480; }
`;

if (typeof document !== "undefined") {
    const style = (document.getElementById("sc-cd-style") as HTMLStyleElement | null) || document.createElement("style");
    style.id = "sc-cd-style";
    style.textContent = DIALOG_CSS;
    if (!style.parentNode) document.head.appendChild(style);
}

export function CanvasHomeDialog({
    open,
    onClose,
    afterOpenChange,
    tone = "default",
    variant = "default",
    eyebrow,
    title,
    description,
    closeLabel,
    children,
    footer,
}: {
    open: boolean;
    onClose: () => void;
    afterOpenChange?: (open: boolean) => void;
    tone?: "default" | "danger";
    variant?: "default" | "cost";
    eyebrow?: string;
    title?: string;
    description?: string;
    closeLabel: string;
    children?: ReactNode;
    footer: ReactNode;
}) {
    const light = useThemeStore((state) => state.theme) !== "dark";

    return (
        <ConfigProvider getPopupContainer={() => document.body} getTargetContainer={() => document.body}>
            <Modal
                open={open}
                onCancel={onClose}
                afterOpenChange={afterOpenChange}
                footer={null}
                closable={false}
                centered
                width={variant === "cost" ? 480 : 520}
                zIndex={12000}
                mask={{ closable: true }}
                getContainer={() => document.body}
                rootClassName={light ? "sc-cd-root is-light" : "sc-cd-root"}
                styles={{
                    mask: {
                        background: light ? "rgba(28, 25, 40, 0.28)" : "rgba(4, 5, 8, 0.36)",
                        backdropFilter: "blur(6px)",
                    },
                    container: {
                        padding: 0,
                        background: "transparent",
                        boxShadow: "none",
                    },
                }}
            >
                <div className={["sc-cd-card", tone === "danger" ? "is-danger" : "", variant === "cost" ? "is-cost" : ""].filter(Boolean).join(" ")}>
                    <button type="button" className="sc-cd-close" onClick={onClose} aria-label={closeLabel}>
                        <X width={16} height={16} />
                    </button>
                    {eyebrow ? (
                        <p className="sc-cd-eyebrow">
                            <i />
                            {eyebrow}
                        </p>
                    ) : null}
                    {title ? <h3 className="sc-cd-title">{title}</h3> : null}
                    {description ? <p className="sc-cd-desc">{description}</p> : null}
                    {children}
                    <div className="sc-cd-actions">{footer}</div>
                </div>
            </Modal>
        </ConfigProvider>
    );
}
