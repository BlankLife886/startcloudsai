import { useNavigate } from "react-router";
import "./not-found.css";

export function NotFoundView() {
  const navigate = useNavigate();
  return (
    <div className="not-found-container">
      <div className="container text-center">
        <div className="error-code">404</div>
        <h1 className="mb-4">页面未找到</h1>
        <p className="mb-5">抱歉，您访问的页面不存在或已被移除。</p>
        <div className="d-flex justify-content-center gap-3">
          <button className="btn theme-button" onClick={() => navigate("/")}>
            <i className="bi bi-house-door" /> 返回首页
          </button>
          <button
            className="btn btn-outline-secondary"
            onClick={() => navigate(-1)}
          >
            <i className="bi bi-arrow-left" /> 返回上一页
          </button>
        </div>
      </div>
    </div>
  );
}
