import { PageHeader } from "./PageHeader.jsx";
import "./coming-soon.css";

/** 手机版还没做的 Tab：说明会有什么，并提供电脑版入口。 */
export function ComingSoon({ title, icon: Icon, headline, points, desktopPath }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="m-tab-body m-soon">
        <span className="m-soon-icon"><Icon size={32} fontSize={32} /></span>
        <strong>{headline}</strong>
        <ul>
          {points.map((point) => <li key={point}>{point}</li>)}
        </ul>
        <span className="m-soon-tag">手机版正在制作中</span>
        <button type="button" className="m-btn-primary m-pressable" onClick={() => window.location.assign(desktopPath)}>
          先用电脑版打开
        </button>
      </div>
    </>
  );
}
