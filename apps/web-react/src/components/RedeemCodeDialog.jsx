import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { redeemWalletCode } from "@legacy/services/meApi.js";
import { formatPoints } from "@legacy/services/billingApi.js";
import notificationService from "@legacy/services/notification.js";
import "@legacy/components/layout/RedeemCodeDialog.vue?react-style";

const ERROR_MESSAGES = {
  code_invalid: "兑换码不存在，请检查后重试",
  code_redeemed: "该兑换码已被使用",
  code_expired: "兑换码已过期",
  code_disabled: "兑换码已停用",
  rate_limited: "操作过于频繁，请稍后再试",
};

export function RedeemCodeDialog({ open, isDark, onClose, onSuccess }) {
  const inputRef = useRef(null);
  const mountedRef = useRef(true);
  const closeRef = useRef(onClose);
  const redeemingRef = useRef(false);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    setCode("");
    redeemingRef.current = false;
    setRedeeming(false);
    requestAnimationFrame(() => inputRef.current?.focus());
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !redeemingRef.current) closeRef.current?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    const value = code.trim().toUpperCase();
    if (!value) {
      notificationService.info("请输入兑换码（格式 SC-XXXX-XXXX-XXXX）");
      return;
    }
    if (redeemingRef.current) return;
    redeemingRef.current = true;
    setRedeeming(true);
    try {
      const result = await redeemWalletCode(value);
      notificationService.success(
        `已入账 ${formatPoints(result?.grantCents || 0)}`,
      );
      window.dispatchEvent(
        new CustomEvent("starclouds:wallet-updated", { detail: result }),
      );
      await onSuccess?.(result);
      if (mountedRef.current) {
        setCode("");
        onClose?.();
      }
    } catch (error) {
      const mapped = ERROR_MESSAGES[error?.code];
      if (mapped) notificationService.error(mapped);
      else if (error?.status === 404)
        notificationService.info("兑换功能即将开放，敬请期待");
      else notificationService.error(error?.message || "兑换失败，请稍后再试");
    } finally {
      redeemingRef.current = false;
      if (mountedRef.current) setRedeeming(false);
    }
  };

  if (!open) return null;
  return createPortal(
    <div
      className={`redeem-dialog-layer${isDark ? " is-dark" : ""}`}
      role="presentation"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !redeeming && onClose?.()
      }
    >
      <section
        className="redeem-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="redeem-dialog-title"
      >
        <header className="redeem-dialog__head">
          <div>
            <h2 id="redeem-dialog-title">兑换积分</h2>
            <p>输入兑换码即可入账。</p>
          </div>
          <button
            type="button"
            className="redeem-dialog__close"
            aria-label="关闭"
            disabled={redeeming}
            onClick={onClose}
          >
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </header>
        <form className="redeem-dialog__form" onSubmit={submit}>
          <input
            ref={inputRef}
            value={code}
            type="text"
            className="redeem-dialog__input"
            placeholder="SC-XXXX-XXXX-XXXX"
            maxLength={20}
            autoComplete="off"
            spellCheck="false"
            aria-label="兑换码"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <button
            type="submit"
            className="redeem-dialog__submit"
            disabled={redeeming}
          >
            {redeeming ? "兑换中…" : "立即兑换"}
          </button>
        </form>
      </section>
    </div>,
    document.body,
  );
}
