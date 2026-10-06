import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import notificationService from "@react/legacy-modules/services/notification.js";
import {
  NOTIFICATION_CATEGORIES,
  loadNotificationPreferences,
  previewNotificationAlert,
  setDesktopNotifications,
  updateNotificationPreferences,
  useDesktopNotifications,
  useNotificationPreferences,
} from "./notificationAlert.js";
import "./notification-preferences.css";

function Switch({ label, hint, checked, disabled = false, onChange }) {
  return (
    <label className="account-switch">
      <span>
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true">
        <em />
      </i>
    </label>
  );
}

function desktopHint(desktop) {
  if (!desktop.supported) return "当前浏览器不支持系统通知";
  if (desktop.permission === "denied") return "浏览器已拒绝通知权限，请在地址栏左侧的网站设置里允许后再开启";
  return desktop.enabled ? "页面在后台时，新通知会出现在系统通知中心" : "仅对当前浏览器生效，开启时会请求通知权限";
}

/** 账号设置里的「通知提醒」：新通知到达时怎么提醒。 */
export function NotificationPreferencesPanel({ userId }) {
  const prefs = useNotificationPreferences();
  const desktop = useDesktopNotifications();
  const location = useLocation();
  const panelRef = useRef(null);

  useEffect(() => {
    void loadNotificationPreferences(userId);
  }, [userId]);

  // 从铃铛面板的齿轮进来时定位到这里
  useEffect(() => {
    if (location.hash === "#notification-preferences") {
      panelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [location.hash]);

  // 乐观更新：每次提交完整设置，失败时回滚并提示
  const save = async (patch) => {
    try {
      await updateNotificationPreferences(patch);
    } catch (error) {
      notificationService.error(error?.message || "提醒设置保存失败");
    }
  };

  const toggleDesktop = async (on) => {
    const enabled = await setDesktopNotifications(on);
    if (on && !enabled) notificationService.warning("浏览器未授权通知，桌面提醒没有开启");
  };

  return (
    <section ref={panelRef} id="notification-preferences" className="account-panel notify-prefs">
      <h2>通知提醒</h2>
      <p>新通知到达时的提醒方式。静默的分类仍会出现在通知列表和铃铛红点里。</p>
      <div className="notify-prefs__group">
        <Switch
          label="提示音"
          hint={prefs.sound ? "新通知到达时播放一声轻提示音" : "已关闭，只有画面提醒"}
          checked={prefs.sound}
          onChange={(on) => save({ sound: on })}
        />
        <Switch
          label="桌面提醒"
          hint={desktopHint(desktop)}
          checked={desktop.enabled}
          disabled={!desktop.supported || desktop.permission === "denied"}
          onChange={toggleDesktop}
        />
        <Switch
          label="免打扰时段"
          hint={prefs.quietHours.enabled ? "时段内不出声、不弹桌面提醒" : "关闭"}
          checked={prefs.quietHours.enabled}
          onChange={(on) => save({ quietHours: { enabled: on } })}
        />
        {prefs.quietHours.enabled ? (
          <div className="notify-prefs__quiet">
            <label>
              <span>开始</span>
              <input
                type="time"
                value={prefs.quietHours.start}
                      onChange={(event) => event.target.value && save({ quietHours: { start: event.target.value } })}
              />
            </label>
            <i className="bi bi-arrow-right" aria-hidden="true" />
            <label>
              <span>结束</span>
              <input
                type="time"
                value={prefs.quietHours.end}
                      onChange={(event) => event.target.value && save({ quietHours: { end: event.target.value } })}
              />
            </label>
          </div>
        ) : null}
      </div>

      <h3 className="notify-prefs__subtitle">按分类提醒</h3>
      <div className="notify-prefs__group">
        {NOTIFICATION_CATEGORIES.map(([id, label, hint]) => (
          <Switch
            key={id}
            label={label}
            hint={prefs.categories[id] === "silent" ? `静默 · ${hint}` : hint}
            checked={prefs.categories[id] !== "silent"}
              onChange={(on) => save({ categories: { [id]: on ? "alert" : "silent" } })}
          />
        ))}
      </div>
      <button type="button" className="account-btn notify-prefs__test" onClick={previewNotificationAlert}>
        <i className="bi bi-bell" aria-hidden="true" /> 测试提醒
      </button>
    </section>
  );
}
