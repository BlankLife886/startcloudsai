// 方案卡等处显示“可用积分”：多张卡片共用一次请求，钱包有变化（扣费、充值、别的标签页）时跟着更新。
import { useEffect, useState } from "react";
import { refreshWalletSnapshot, WALLET_UPDATED_EVENT } from "@react/legacy-modules/services/walletSync.js";

const FRESH_MS = 30_000;
let latest = null;
let latestAt = 0;

function availableCents(snapshot) {
  if (!snapshot) return null;
  const value = Number(snapshot.normalBalanceCents ?? snapshot.availableCents ?? snapshot.balanceCents);
  return Number.isFinite(value) ? value : null;
}

if (typeof window !== "undefined") {
  window.addEventListener(WALLET_UPDATED_EVENT, (event) => {
    latest = availableCents(event.detail);
    latestAt = Date.now();
  });
}

// enabled 为 false 时不发请求（例如卡片已执行或已收起）。读不到时返回 null，界面就不显示余额。
export function useAssistantWalletBalance(enabled = true) {
  const [balance, setBalance] = useState(latest);
  useEffect(() => {
    if (!enabled) return undefined;
    const onUpdate = (event) => setBalance(availableCents(event.detail));
    window.addEventListener(WALLET_UPDATED_EVENT, onUpdate);
    if (latest === null || Date.now() - latestAt > FRESH_MS) {
      void refreshWalletSnapshot().catch(() => null);
    } else {
      setBalance(latest);
    }
    return () => window.removeEventListener(WALLET_UPDATED_EVENT, onUpdate);
  }, [enabled]);
  return balance;
}
