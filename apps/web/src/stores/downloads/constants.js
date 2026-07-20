export const BROWSER_DOWNLOAD_LAUNCH_DELAY_MS = 900
export const TERMINAL_DOWNLOAD_STATUSES = new Set(['completed', 'failed', 'canceled'])
export const MAX_GUARDED_RETRIES = 2

export const DOWNLOAD_STATUS = {
  PENDING: 'pending',
  DOWNLOADING: 'downloading',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELED: 'canceled',
}
