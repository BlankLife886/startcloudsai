import { request } from "@/request";

export interface AdminBadgeCounts {
  pendingSubmissions: number;
  runningTasks: number;
  pendingTrialApplications: number;
  pendingFeedback: number;
}

const CACHE_MS = 30_000;
const RETRY_DELAY_MS = 15_000;

let cached: AdminBadgeCounts | null = null;
let expiresAt = 0;
let retryAfter = 0;
let lastError: unknown = null;
let inFlight: Promise<AdminBadgeCounts> | null = null;

function normalizeBadgeCounts(data: Partial<AdminBadgeCounts>): AdminBadgeCounts {
  return {
    pendingSubmissions: Number(data.pendingSubmissions || 0),
    runningTasks: Number(data.runningTasks || 0),
    pendingTrialApplications: Number(data.pendingTrialApplications || 0),
    pendingFeedback: Number(data.pendingFeedback || 0),
  };
}

/** 侧栏和仪表盘共享请求、缓存与失败退避，连续切页不会重复访问接口。 */
export function loadAdminBadgeCounts() {
  const now = Date.now();
  if (cached && now < expiresAt) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  if (lastError && now < retryAfter) return Promise.reject(lastError);

  inFlight = request<Partial<AdminBadgeCounts>>(
    "/api/v1/admin/badge-counts",
    { silent: true, scope: "persistent" },
  )
    .then((data) => {
      cached = normalizeBadgeCounts(data);
      expiresAt = Date.now() + CACHE_MS;
      retryAfter = 0;
      lastError = null;
      return cached;
    })
    .catch((error: unknown) => {
      lastError = error;
      retryAfter = Date.now() + RETRY_DELAY_MS;
      throw error;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
