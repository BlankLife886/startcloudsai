import "@react/legacy-styles/generated/components/layout/ThemeDayNightSwitch.css";
import { useIsDark } from "../hooks/useIsDark.js";
import { setAppearance } from "../theme/appearance.js";

const circles = ["moon-dot--1", "moon-dot--2", "moon-dot--3"];
const rays = ["light-ray--1", "light-ray--2", "light-ray--3"];
const clouds = ["dark cloud--1", "dark cloud--2", "dark cloud--3", "light cloud--4", "light cloud--5", "light cloud--6"];

export function ThemeSwitch() {
  const dark = useIsDark();

  function toggle() {
    setAppearance(dark ? "light" : "dark");
  }

  return (
    <label className="theme-dn-switch nav-theme-switch" title={dark ? "切换亮色模式" : "切换暗色模式"}>
      <input
        className="theme-dn-switch__input"
        name="appearance-theme"
        type="checkbox"
        role="switch"
        checked={dark}
        aria-label={dark ? "切换亮色模式" : "切换暗色模式"}
        aria-checked={dark}
        onChange={toggle}
      />
      <div className="theme-dn-switch__slider" aria-hidden="true">
        <div className="theme-dn-switch__sun-moon">
          {circles.map((name) => (
            <svg key={name} className={`theme-dn-switch__moon-dot theme-dn-switch__${name}`} viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
          ))}
          {rays.map((name) => (
            <svg key={name} className={`theme-dn-switch__light-ray theme-dn-switch__${name}`} viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
          ))}
          {clouds.map((entry) => {
            const [tone, name] = entry.split(" ");
            return <svg key={entry} className={`theme-dn-switch__cloud theme-dn-switch__cloud--${tone} theme-dn-switch__${name}`} viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>;
          })}
        </div>
        <div className="theme-dn-switch__stars">
          {[1, 2, 3, 4].map((index) => (
            <svg key={index} className={`theme-dn-switch__star theme-dn-switch__star--${index}`} viewBox="0 0 20 20">
              <path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z" />
            </svg>
          ))}
        </div>
      </div>
    </label>
  );
}
