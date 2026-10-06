import "./ThemeSwitch.css";
import { useIsDark } from "../hooks/useIsDark.js";
import { setAppearance } from "../theme/appearance.js";
import { MoonGlyph3D, SunGlyph3D } from "./NavGlyph3D.jsx";

// 亮暗切换：3D 键帽。亮色模式显示太阳（暖金键帽），暗色模式显示月亮（深夜键帽），
// 切换时太阳落下、月亮从上方滑入；按下有键程下沉。
export function ThemeSwitch() {
  const dark = useIsDark();
  const label = dark ? "切换亮色模式" : "切换暗色模式";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={label}
      title={label}
      className={`theme-key nav-theme-switch${dark ? " is-night" : ""}`}
      onClick={() => setAppearance(dark ? "light" : "dark")}
    >
      <span className="theme-key__cap">
        <SunGlyph3D />
        <MoonGlyph3D />
      </span>
    </button>
  );
}
