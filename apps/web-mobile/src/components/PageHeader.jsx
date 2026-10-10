import "./page-header.css";

/** Tab 页通用顶栏：标题居左，右侧可放操作。 */
export function PageHeader({ title, extra }) {
  return (
    <header className="m-page-header">
      <h1>{title}</h1>
      {extra}
    </header>
  );
}
