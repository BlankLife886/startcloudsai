import "./ThemeSwitch.css";
import { useIsDark } from "../hooks/useIsDark.js";
import { useAppearancePreference } from "../hooks/useAppearancePreference.js";
import { setAppearance } from "../theme/appearance.js";
import { MoonGlyph3D, SunGlyph3D } from "./NavGlyph3D.jsx";

const LABELS = { light: "浅色", dark: "深色", system: "跟随系统" };
const NEXT = { light: "dark", dark: "system", system: "light" };

// 亮暗切换：圆形按钮，点击依次切换 浅色 → 深色 → 跟随系统（默认）。
// 按钮显示当前实际生效的太阳或月亮，切换时太阳落下、月亮从上方滑入；跟随系统时右下角带角标。
export function ThemeSwitch() {
  const dark = useIsDark();
  const preference = useAppearancePreference();
  const next = NEXT[preference] || "light";
  const label = `外观：${LABELS[preference] || LABELS.system}，点击切换为${LABELS[next]}`;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`theme-key nav-theme-switch${dark ? " is-night" : ""}`}
      onClick={() => setAppearance(next)}
    >
      <span className="theme-key__cap">
        <SunGlyph3D />
        <MoonGlyph3D />
      </span>
      {preference === "system" && (
        <span className="theme-key__face" aria-hidden="true">
          <i className="bi bi-circle-half" />
        </span>
      )}
    </button>
  );
}
