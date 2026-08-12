import { useEffect, useMemo, useRef, useState } from "react";
import { updateProfile } from "@legacy/services/meApi.js";
import { uploadFile } from "@legacy/services/tasksApi.js";
import notificationService from "@legacy/services/notification.js";
import "@react/legacy-styles/generated/views/AccountSettingsView.css";
import { useAuth } from "../auth/AuthContext.jsx";

function profileFromUser(user) {
  return {
    username: user?.username || "",
    bio: user?.bio || "",
    location: user?.location || "",
    websiteUrl: user?.websiteUrl || "",
  };
}

function normalizeProfile(profile) {
  return {
    username: String(profile?.username || "").trim(),
    bio: String(profile?.bio || "").trim(),
    location: String(profile?.location || "").trim(),
    websiteUrl: String(profile?.websiteUrl || "").trim(),
  };
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("zh-CN", { hour12: false });
}

function loadAvatarImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("头像图片读取失败"));
    };
    image.src = objectUrl;
  });
}

async function createAvatarUpload(file) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("请选择 PNG、JPEG 或 WebP 图片");
  }
  if (file.size > 10 * 1024 * 1024) throw new Error("头像图片不能超过 10MB");
  const image = await loadAvatarImage(file);
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理头像图片");
  context.drawImage(
    image,
    (image.naturalWidth - side) / 2,
    (image.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    512,
    512,
  );
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  );
  canvas.width = 1;
  canvas.height = 1;
  if (!blob) throw new Error("头像处理失败");
  return new File([blob], `avatar-${Date.now()}.jpg`, { type: "image/jpeg" });
}

export function AccountSettingsView() {
  const auth = useAuth();
  const avatarInputRef = useRef(null);
  const mountedRef = useRef(true);
  const [profile, setProfile] = useState(() => profileFromUser(auth.user));
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [preferenceSaving, setPreferenceSaving] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!saving) setProfile(profileFromUser(auth.user));
  }, [auth.user, saving]);

  const normalized = useMemo(() => normalizeProfile(profile), [profile]);
  const saved = useMemo(() => normalizeProfile(auth.user), [auth.user]);
  const dirty = JSON.stringify(normalized) !== JSON.stringify(saved);
  const usernameError = normalized.username ? "" : "昵称不能为空";
  const websiteError =
    normalized.websiteUrl && !/^https?:\/\/[^\s]+$/i.test(normalized.websiteUrl)
      ? "请输入完整的 http:// 或 https:// 地址"
      : "";
  const canSave = dirty && !usernameError && !websiteError && !saving;
  const requireCostConfirm = auth.user?.requireCostConfirm !== false;
  const displayName = auth.user?.username || auth.user?.email || "创作者";

  const updateField = (field, value) => {
    setProfile((current) => ({ ...current, [field]: value }));
  };

  const saveProfile = async (event) => {
    event?.preventDefault();
    if (!normalized.username) {
      notificationService.warning("用户名不能为空");
      return;
    }
    if (websiteError) {
      notificationService.warning("个人网站需要填写完整的 http/https 地址");
      return;
    }
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const result = await updateProfile(normalized);
      const patch = result?.user || normalized;
      auth.setUser((current) => ({ ...(current || {}), ...patch }));
      if (mountedRef.current)
        setProfile(profileFromUser({ ...auth.user, ...patch }));
      notificationService.success("个人资料已保存");
    } catch (error) {
      notificationService.error(error?.message || "保存失败");
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const setCostConfirmPreference = async (enabled) => {
    if (preferenceSaving) return;
    const previous = requireCostConfirm;
    const next = Boolean(enabled);
    auth.setUser((current) => ({
      ...(current || {}),
      requireCostConfirm: next,
    }));
    setPreferenceSaving(true);
    try {
      const result = await updateProfile({ requireCostConfirm: next });
      auth.setUser((current) => ({
        ...(current || {}),
        ...(result?.user || { requireCostConfirm: next }),
      }));
      notificationService.success(
        next ? "已开启生成前费用确认" : "已关闭生成前费用确认",
      );
    } catch (error) {
      auth.setUser((current) => ({
        ...(current || {}),
        requireCostConfirm: previous,
      }));
      notificationService.error(error?.message || "创作偏好保存失败");
    } finally {
      if (mountedRef.current) setPreferenceSaving(false);
    }
  };

  const onAvatarSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || avatarUploading) return;
    setAvatarUploading(true);
    try {
      const upload = await uploadFile(await createAvatarUpload(file));
      const result = await updateProfile({ avatarUrl: upload.url });
      const patch = result?.user || { avatarUrl: upload.url };
      auth.setUser((current) => ({ ...(current || {}), ...patch }));
      notificationService.success("头像已更新");
    } catch (error) {
      notificationService.error(error?.message || "头像上传失败");
    } finally {
      if (mountedRef.current) setAvatarUploading(false);
    }
  };

  return (
    <main className="account">
      <header className="account-top">
        <div>
          <h1>账号设置</h1>
          <p>公开资料、创作偏好与账号信息</p>
        </div>
        <div className="account-top__meta">
          <span className={dirty ? "is-dirty" : ""}>
            <i
              className={`bi ${dirty ? "bi-circle-fill" : "bi-check2-circle"}`}
            />
            {dirty ? "有未保存修改" : "资料已同步"}
          </span>
          <button
            type="button"
            className="account-btn is-primary"
            disabled={!canSave}
            onClick={saveProfile}
          >
            {saving ? "保存中…" : "保存资料"}
          </button>
        </div>
      </header>

      <div className="account-stage">
        <form className="account-panel account-profile" onSubmit={saveProfile}>
          <div className="account-avatar">
            <button
              type="button"
              className="account-avatar__preview"
              disabled={avatarUploading}
              aria-label="更换头像"
              onClick={() => avatarInputRef.current?.click()}
            >
              <img
                src={auth.user?.avatarUrl || "/brand/avatar-placeholder.svg"}
                alt="头像"
                loading="eager"
                decoding="async"
              />
              <span>
                <i
                  className={`bi ${avatarUploading ? "bi-arrow-repeat spin" : "bi-camera"}`}
                />
              </span>
            </button>
            <div>
              <strong>{displayName}</strong>
              <p data-no-translate>{auth.user?.email}</p>
              <button
                type="button"
                className="account-btn is-ghost"
                disabled={avatarUploading}
                onClick={() => avatarInputRef.current?.click()}
              >
                {avatarUploading ? "上传中…" : "更换头像"}
              </button>
            </div>
            <input
              ref={avatarInputRef}
              className="account-avatar__input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onAvatarSelected}
            />
          </div>

          <div className="account-fields">
            <label>
              <span>昵称</span>
              <input
                value={profile.username}
                maxLength={64}
                placeholder="展示名称"
                aria-invalid={Boolean(usernameError)}
                onChange={(event) =>
                  updateField("username", event.target.value)
                }
              />
            </label>
            <label>
              <span>所在地</span>
              <input
                value={profile.location}
                maxLength={80}
                placeholder="上海 / Remote"
                onChange={(event) =>
                  updateField("location", event.target.value)
                }
              />
            </label>
            <label className="is-wide">
              <span>个人网站</span>
              <input
                value={profile.websiteUrl}
                maxLength={300}
                inputMode="url"
                placeholder="https://example.com"
                aria-invalid={Boolean(websiteError)}
                onChange={(event) =>
                  updateField("websiteUrl", event.target.value)
                }
              />
            </label>
            {websiteError && (
              <p className="account-error is-wide">{websiteError}</p>
            )}
            <label className="is-wide account-bio">
              <span>
                个人简介 <em>{profile.bio.length}/280</em>
              </span>
              <textarea
                value={profile.bio}
                maxLength={280}
                rows={3}
                placeholder="创作方向、擅长风格或正在进行的项目…"
                onChange={(event) => updateField("bio", event.target.value)}
              />
            </label>
          </div>
        </form>

        <aside className="account-side">
          <section className="account-panel">
            <h2>创作偏好</h2>
            <p>余额不足、预算超限等安全拦截始终保留。</p>
            <label
              className={`account-switch${preferenceSaving ? " is-saving" : ""}`}
            >
              <span>
                <strong>生成前费用确认</strong>
                <small>
                  {requireCostConfirm
                    ? "提交前显示费用明细"
                    : "校验通过后直接提交"}
                </small>
              </span>
              <input
                type="checkbox"
                checked={requireCostConfirm}
                disabled={preferenceSaving}
                aria-label="生成前费用确认"
                onChange={(event) =>
                  setCostConfirmPreference(event.target.checked)
                }
              />
              <i aria-hidden="true">
                <em />
              </i>
            </label>
            <small className="account-sync">
              <i
                className={`bi ${preferenceSaving ? "bi-arrow-repeat spin" : "bi-check2-circle"}`}
              />
              {preferenceSaving ? "正在保存…" : "已同步到当前账号"}
            </small>
          </section>
          <section className="account-panel account-identity">
            <h2>账号信息</h2>
            <dl>
              <div>
                <dt>登录邮箱</dt>
                <dd data-no-translate>{auth.user?.email || "—"}</dd>
              </div>
              <div>
                <dt>账号 ID</dt>
                <dd data-no-translate>{auth.user?.id || "—"}</dd>
              </div>
              <div>
                <dt>注册时间</dt>
                <dd>{formatTime(auth.user?.createdAt)}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </main>
  );
}
