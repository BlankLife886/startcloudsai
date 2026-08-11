import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router";
import "@legacy/views/AccessLimitedView.vue?react-style";

export function AccessLimitedView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const type = searchParams.get("type") || "hidden";
  const copy = useMemo(() => {
    if (type === "maintenance") return { icon: "bi-tools", eyebrow: "MAINTENANCE", title: "页面维护中", reason: "当前页面正在维护，请稍后再试。" };
    if (type === "forbidden") return { icon: "bi-shield-lock-fill", eyebrow: "FORBIDDEN", title: "没有访问权限", reason: "当前页面暂不对你开放。" };
    return { icon: "bi-eye-slash-fill", eyebrow: "LIMITED", title: "访问受限", reason: "当前功能暂不可用。" };
  }, [type]);
  const reason = searchParams.get("reason") || copy.reason;

  return (
    <main className="limited-shell">
      <section className="limited-panel">
        <div className="limited-icon"><i className={`bi ${copy.icon}`} /></div>
        <div className="limited-copy"><p>{copy.eyebrow}</p><h1>{copy.title}</h1><span>{reason}</span></div>
        <button type="button" className="limited-action" onClick={() => navigate("/")}>返回首页</button>
      </section>
    </main>
  );
}
