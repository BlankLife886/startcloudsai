// antd-mobile 通过 html[data-prefers-color-scheme] 切换深色变量，这里跟随系统设置。
export function installColorScheme() {
  const query = window.matchMedia?.("(prefers-color-scheme: dark)");
  const apply = () => {
    document.documentElement.setAttribute("data-prefers-color-scheme", query?.matches ? "dark" : "light");
  };
  apply();
  query?.addEventListener?.("change", apply);
}
