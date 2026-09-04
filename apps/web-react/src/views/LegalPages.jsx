import { useEffect } from "react";
import { Link } from "react-router";
import "./legal-pages.css";

const privacySections = [
  ["我们处理的信息", "为提供服务，我们会处理账号邮箱与用户标识、你主动填写的资料、提示词、上传或生成的图片、AI 助手对话、任务与素材记录、社区投稿、反馈、积分与订单记录，以及登录时间、IP 地址、设备客户端和必要的安全日志。"],
  ["设备权限", "照片、相机、麦克风和语音识别仅在你使用选图、拍摄或语音输入时按需申请。拒绝权限不会影响不依赖该权限的功能，你可以在 App 权限管理或系统设置中随时调整。"],
  ["使用目的", "信息用于验证登录、同步账号、执行 AI 生成和助手请求、保存与展示作品、完成积分记账、处理反馈、发送业务通知、防止滥用以及排查服务故障。我们不进行跨应用跟踪。"],
  ["必要的服务提供方", "完成请求时，必要的提示词、图片或参数可能由模型推理、对象存储、邮件发送和支付服务提供方处理。我们仅提供完成对应功能所需的信息，并要求其按照约定目的处理。"],
  ["信息共享", "除完成你主动请求的功能、遵守法律义务、保护用户与平台安全，或取得你的另行同意外，我们不会出售或向无关第三方共享你的个人信息。你主动发布到社区的内容会按发布范围公开展示。"],
  ["存储与安全", "本机登录凭证保存在系统 Keychain 或 Keystore；服务端使用访问控制、令牌哈希、传输加密和审计措施保护数据。发现异常登录时，请在 App 账号与安全页撤销对应设备。"],
  ["你的控制权", "你可以在 App 内查看和修改资料，管理作品、素材、投稿、通知和登录设备，导出账号数据副本，并永久注销账号。注销会重新验证当前邮箱，并按注销页面说明处理相关数据。"],
  ["保留与删除", "我们在提供服务和满足安全、争议处理及法定义务所必需的期限内保留信息。账号注销后会匿名化身份并清理会话与 API 凭证；必要订单和安全记录仅保留匿名关联。"],
  ["政策更新与联系", "重要更新会通过 App 页面、公告或版本记录说明。如对个人信息处理有疑问，请通过 App 的“我的 > 问题反馈”联系我们。"],
];

const termsSections = [
  ["协议范围", "使用星空云绘即表示你理解并接受本协议。若你不同意其中任何内容，请停止注册或使用相关服务。服务规则、页面说明和付费确认信息均构成本协议的一部分。"],
  ["账号与安全", "账号通过受支持邮箱的验证码创建和登录。请妥善保护邮箱与登录设备，不得出借或转让账号。发现陌生设备时可在 App 的账号与安全页撤销对应会话。"],
  ["AI 服务与结果", "你提交的提示词、图片和必要参数会用于完成所请求的生成或分析。AI 结果可能不准确、不完整或与预期不同，使用前应自行审核，不应将其作为医疗、法律或金融等专业领域的唯一依据。"],
  ["内容与社区", "你应确保对上传、生成和发布的内容拥有必要权利。不得提交违法违规、侵权、欺诈、仇恨、骚扰或危害他人安全的内容。社区投稿可能经过审核，违规内容可被拒绝展示或移除。"],
  ["积分与权益", "部分能力会消耗站内积分，提交前以页面展示的模型价格和确认信息为准。积分仅用于站内服务，不是法定货币。移动端首发版本不提供积分购买或兑换。"],
  ["禁止行为", "不得绕过访问控制、批量滥用接口、攻击服务、干扰计费、冒用他人身份，或利用服务制作和传播违法内容。平台可以限制异常请求，并对严重违规账号暂停服务。"],
  ["服务变更与中断", "我们会持续改进模型与功能。维护、网络、上游模型或不可抗力可能导致暂时中断；重要变更会尽可能通过公告或更新记录说明。"],
  ["退出与注销", "你可以退出当前设备，也可以在 App 的账号与安全页申请永久注销。注销需要邮箱验证码再次确认，并会按页面说明处理账号身份、会话、公开投稿及依法需要保留的记录。"],
  ["联系我们", "如对本协议或服务处理有疑问，请通过 App 的“我的 > 问题反馈”提交，我们会依据问题类型进行处理。"],
];

function LegalPage({ title, summary, sections }) {
  useEffect(() => {
    document.title = `${title} - 星空云绘`;
  }, [title]);

  return (
    <main className="legal-page">
      <header className="legal-page__header">
        <Link className="legal-page__brand" to="/">星空云绘</Link>
        <h1>{title}</h1>
        <p>{summary}</p>
        <span>更新日期：2026-09-02</span>
      </header>
      <div className="legal-page__body">
        {sections.map(([heading, body], index) => (
          <section key={heading}>
            <h2>{index + 1}. {heading}</h2>
            <p>{body}</p>
          </section>
        ))}
      </div>
      <footer className="legal-page__footer">
        <Link to="/privacy">隐私政策</Link>
        <Link to="/terms">用户协议</Link>
        <Link to="/support">帮助与支持</Link>
      </footer>
    </main>
  );
}

export function PrivacyPolicyPage() {
  return <LegalPage title="隐私政策" summary="我们仅为账号、创作、交易与安全功能处理必要信息。" sections={privacySections} />;
}

export function TermsOfServicePage() {
  return <LegalPage title="用户协议" summary="本协议说明账号、AI 服务、内容发布、积分与使用规范。" sections={termsSections} />;
}

export function SupportPage() {
  useEffect(() => {
    document.title = "帮助与支持 - 星空云绘";
  }, []);
  return (
    <main className="legal-page">
      <header className="legal-page__header">
        <Link className="legal-page__brand" to="/">星空云绘</Link>
        <h1>帮助与支持</h1>
        <p>账号、创作、作品和服务问题均可通过 App 内反馈提交。</p>
      </header>
      <div className="legal-page__body">
        <section><h2>账号与登录</h2><p>App 支持 Gmail、Googlemail 和 QQ 邮箱验证码登录。登录异常时请确认邮箱地址可正常收信，并检查垃圾邮件目录。</p></section>
        <section><h2>创作与作品</h2><p>任务状态、失败原因和生成结果可在作品页查看。网络中断后，App 会在恢复连接时继续同步任务状态。</p></section>
        <section><h2>隐私与账号安全</h2><p>你可以在 App 的账号与安全页管理登录设备、导出数据或永久注销账号。</p></section>
        <section><h2>提交问题</h2><p>登录 App 后进入“我的 → 问题反馈”，选择问题类型并附上复现说明。处理进度和回复会保存在反馈记录中。</p><Link className="legal-page__action" to="/feedback">打开问题反馈</Link></section>
      </div>
      <footer className="legal-page__footer">
        <Link to="/privacy">隐私政策</Link>
        <Link to="/terms">用户协议</Link>
      </footer>
    </main>
  );
}
