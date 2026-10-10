import { useCallback, useRef, useState } from "react";
import notificationService from "@react/legacy-modules/services/notification.js";

export function useDownloadAction({ successMessage = "下载已开始", errorMessage = "下载失败", notify = false } = {}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = useCallback(async (action, options = {}) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await action();
      if (result !== false && (options.notifySuccess ?? notify)) {
        notificationService.success(options.successMessage || successMessage);
      }
      return result;
    } catch (error) {
      if ((options.notifyError ?? notify) && !error?.downloadNotificationShown) {
        notificationService.error(
          options.errorMessage || error?.message || errorMessage,
        );
      }
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [errorMessage, notify, successMessage]);

  return { busy, run };
}
