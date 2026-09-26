// A complete single-file demo site for the HTML node: hash-routed pages, responsive navigation, dark mode,
// modal sign-up, tabs, pricing toggle, carousel, accordion and a validated contact form.
export const HTML_DEMO_SITE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>nimbus.app</title>
<style>
:root{--bg:#f7f6fb;--card:#fff;--text:#17151f;--muted:#6b6780;--line:#ebe8f2;--brand:#6d4aff;--brand2:#3d7bff;--radius:16px}
[data-theme=dark]{--bg:#121118;--card:#1c1a24;--text:#f2f0f8;--muted:#9d98b0;--line:#2a2735}
*{box-sizing:border-box;margin:0}
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif;background:var(--bg);color:var(--text);transition:background .3s,color .3s;line-height:1.6}
a{color:inherit;text-decoration:none}
button{font:inherit;cursor:pointer;border:0;background:none;color:inherit}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
header{position:sticky;top:0;z-index:20;backdrop-filter:blur(14px);background:color-mix(in srgb,var(--bg) 82%,transparent);border-bottom:1px solid var(--line)}
.nav{display:flex;align-items:center;gap:28px;height:64px}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:18px}
.logo i{width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,var(--brand),var(--brand2))}
.links{display:flex;gap:6px;flex:1}
.links a{padding:8px 14px;border-radius:10px;color:var(--muted);font-size:14px;font-weight:600;transition:.2s}
.links a:hover{color:var(--text);background:var(--line)}
.links a.on{color:var(--brand);background:color-mix(in srgb,var(--brand) 10%,transparent)}
.icon-btn{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;border:1px solid var(--line);background:var(--card)}
.btn{display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border-radius:12px;font-weight:700;font-size:14px;transition:transform .15s,box-shadow .2s}
.btn:active{transform:scale(.97)}
.btn-primary{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;box-shadow:0 10px 24px -8px rgba(109,74,255,.6)}
.btn-primary:hover{box-shadow:0 14px 30px -8px rgba(109,74,255,.75)}
.btn-ghost{border:1px solid var(--line);background:var(--card)}
.burger{display:none}
.page{display:none;animation:in .45s ease both}
.page.on{display:block}
@keyframes in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.hero{padding:88px 0 64px;text-align:center}
.pill{display:inline-flex;gap:8px;align-items:center;padding:6px 14px;border-radius:99px;background:var(--card);border:1px solid var(--line);font-size:13px;color:var(--muted)}
.pill b{color:var(--brand)}
h1{font-size:clamp(34px,6vw,64px);line-height:1.1;letter-spacing:-.02em;margin:22px auto 18px;max-width:820px}
h1 span{background:linear-gradient(135deg,var(--brand),var(--brand2));-webkit-background-clip:text;color:transparent}
.lead{color:var(--muted);font-size:clamp(15px,2vw,18px);max-width:600px;margin:0 auto 32px}
.cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.mock{margin:56px auto 0;max-width:900px;border-radius:22px;background:var(--card);border:1px solid var(--line);box-shadow:0 40px 80px -30px rgba(40,20,120,.35);padding:18px;display:grid;grid-template-columns:180px 1fr;gap:16px;min-height:280px}
.mock aside{display:flex;flex-direction:column;gap:10px}
.mock aside div{height:12px;border-radius:6px;background:var(--line)}
.mock aside div:first-child{width:60%;background:linear-gradient(90deg,var(--brand),var(--brand2))}
.mock .board{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.mock .board div{border-radius:14px;background:var(--bg);border:1px solid var(--line)}
section{padding:72px 0}
h2{font-size:clamp(26px,4vw,40px);letter-spacing:-.01em;margin-bottom:10px}
.sub{color:var(--muted);margin-bottom:36px}
.tabs{display:inline-flex;padding:4px;border-radius:14px;background:var(--card);border:1px solid var(--line);margin-bottom:24px;flex-wrap:wrap}
.tabs button{padding:9px 18px;border-radius:10px;font-weight:600;font-size:14px;color:var(--muted);transition:.2s}
.tabs button.on{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff}
.panel{display:none;grid-template-columns:1.1fr 1fr;gap:28px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:32px}
.panel.on{display:grid;animation:in .35s ease both}
.panel ul{padding-left:18px;color:var(--muted)}
.panel .art{height:220px;border-radius:18px;background:radial-gradient(circle at 30% 30%,#b9a6ff,transparent 60%),radial-gradient(circle at 70% 70%,#8fc2ff,transparent 55%),var(--bg)}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:24px;transition:transform .25s,box-shadow .25s}
.card:hover{transform:translateY(-4px);box-shadow:0 20px 40px -24px rgba(40,20,120,.35)}
.card .ic{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--brand) 12%,transparent);font-size:20px;margin-bottom:14px}
.card p{color:var(--muted);font-size:14px}
.switch{display:inline-flex;align-items:center;gap:12px;margin-bottom:32px;font-weight:600}
.toggle{width:48px;height:28px;border-radius:99px;background:var(--line);position:relative;transition:.25s}
.toggle::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.2);transition:.25s}
.toggle.on{background:var(--brand)}
.toggle.on::after{left:23px}
.save{font-size:12px;padding:3px 8px;border-radius:99px;background:#dcfce7;color:#15803d}
.price{font-size:40px;font-weight:800;margin:10px 0}
.price small{font-size:14px;color:var(--muted);font-weight:500}
.card.pop{border:2px solid var(--brand);position:relative}
.card.pop::before{content:"最受欢迎";position:absolute;top:-12px;left:24px;background:var(--brand);color:#fff;font-size:12px;padding:2px 10px;border-radius:99px}
.card li{list-style:none;color:var(--muted);font-size:14px;padding:4px 0}
.card li::before{content:"✓  ";color:var(--brand);font-weight:800}
.carousel{position:relative;overflow:hidden;border-radius:22px;background:var(--card);border:1px solid var(--line)}
.track{display:flex;transition:transform .5s cubic-bezier(.2,.8,.2,1)}
.slide{min-width:100%;padding:40px;text-align:center}
.slide q{font-size:clamp(17px,2.4vw,22px);display:block;max-width:640px;margin:0 auto 16px}
.slide span{color:var(--muted);font-size:14px}
.dots{display:flex;gap:8px;justify-content:center;padding-bottom:22px}
.dots button{width:8px;height:8px;border-radius:99px;background:var(--line);transition:.3s}
.dots button.on{width:24px;background:var(--brand)}
.faq{max-width:760px}
.faq details{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 20px;margin-bottom:10px}
.faq summary{font-weight:700;cursor:pointer;list-style:none;display:flex;justify-content:space-between}
.faq summary::after{content:"+";color:var(--brand);font-size:20px;transition:.2s}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq p{color:var(--muted);margin-top:10px}
form{display:grid;gap:14px;max-width:560px}
label{font-size:13px;font-weight:700}
input,textarea,select{width:100%;margin-top:6px;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--text);font:inherit;outline:none;transition:.2s}
input:focus,textarea:focus,select:focus{border-color:var(--brand);box-shadow:0 0 0 4px color-mix(in srgb,var(--brand) 15%,transparent)}
.err{color:#e5484d;font-size:12px;min-height:16px}
.bad{border-color:#e5484d!important}
footer{border-top:1px solid var(--line);padding:32px 0;color:var(--muted);font-size:13px}
.modal{position:fixed;inset:0;background:rgba(10,8,20,.45);display:grid;place-items:center;opacity:0;pointer-events:none;transition:.25s;z-index:50;padding:20px}
.modal.on{opacity:1;pointer-events:auto}
.dialog{background:var(--card);border-radius:22px;padding:28px;width:min(420px,100%);transform:scale(.94);transition:.25s}
.modal.on .dialog{transform:none}
.toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);background:var(--text);color:var(--bg);padding:12px 18px;border-radius:12px;font-weight:600;font-size:14px;opacity:0;transition:.3s;z-index:60}
.toast.on{opacity:1;transform:translate(-50%,0)}
.drawer{display:none}
@media (max-width:820px){
 .links{display:none}.burger{display:grid}.nav .btn-primary{display:none}
 .drawer{display:block;max-height:0;overflow:hidden;transition:max-height .3s}
 .drawer.on{max-height:320px}
 .drawer a{display:block;padding:14px 24px;border-top:1px solid var(--line);font-weight:600}
 .grid3{grid-template-columns:1fr}.panel{grid-template-columns:1fr;padding:22px}
 .mock{grid-template-columns:1fr}.mock aside{display:none}
 .hero{padding:56px 0 40px}section{padding:52px 0}
}
</style>
</head>
<body>
<header>
 <div class="wrap nav">
  <a class="logo" href="#/"><i></i>Nimbus</a>
  <nav class="links"><a href="#/" data-link>首页</a><a href="#/features" data-link>功能</a><a href="#/pricing" data-link>定价</a><a href="#/contact" data-link>联系</a></nav>
  <button class="icon-btn" id="theme" title="切换深色">🌙</button>
  <button class="btn btn-primary" data-open>免费试用</button>
  <button class="icon-btn burger" id="burger" title="菜单">☰</button>
 </div>
 <div class="drawer" id="drawer"><a href="#/">首页</a><a href="#/features">功能</a><a href="#/pricing">定价</a><a href="#/contact">联系</a></div>
</header>

<main>
 <div class="page" data-page="/">
  <div class="wrap hero">
   <span class="pill"><b>新</b> AI 自动整理已上线 →</span>
   <h1>把灵感、任务和文档<br/><span>放进同一块白板</span></h1>
   <p class="lead">Nimbus 帮团队在一个空间里写作、规划和协作。实时同步，离线可用，所有设备无缝衔接。</p>
   <div class="cta"><button class="btn btn-primary" data-open>立即开始 · 免费</button><a class="btn btn-ghost" href="#/features">了解功能</a></div>
   <div class="mock"><aside><div></div><div></div><div></div><div></div><div style="width:70%"></div></aside><div class="board"><div></div><div></div><div></div><div></div><div></div><div></div></div></div>
  </div>
  <section><div class="wrap">
   <h2>团队都在说</h2><p class="sub">超过 12,000 个团队每天在用 Nimbus。</p>
   <div class="carousel"><div class="track" id="track">
    <div class="slide"><q>我们把周会从 1 小时缩短到 20 分钟，所有决定都留在了白板上。</q><span>林悦 · 产品负责人 @ Aurora</span></div>
    <div class="slide"><q>离线也能写，上线自动合并，出差党的福音。</q><span>陈默 · 独立设计师</span></div>
    <div class="slide"><q>AI 整理把零散笔记变成了清晰的行动项，太省心了。</q><span>周然 · 工程经理 @ Kite</span></div>
   </div><div class="dots" id="dots"></div></div>
  </div></section>
 </div>

 <div class="page" data-page="/features"><section><div class="wrap">
  <h2>为专注而设计</h2><p class="sub">点一下标签，看看每个场景怎么用。</p>
  <div class="tabs" id="tabs"><button class="on" data-tab="0">写作</button><button data-tab="1">规划</button><button data-tab="2">协作</button></div>
  <div class="panel on"><div><h3>沉浸式写作</h3><p class="sub" style="margin:8px 0 12px">Markdown、斜杠命令、双向链接。</p><ul><li>专注模式隐藏一切干扰</li><li>版本历史随时回溯</li></ul></div><div class="art"></div></div>
  <div class="panel"><div><h3>看板与时间线</h3><p class="sub" style="margin:8px 0 12px">同一份数据，多种视图。</p><ul><li>拖拽排期，自动提醒</li><li>里程碑一目了然</li></ul></div><div class="art"></div></div>
  <div class="panel"><div><h3>实时协作</h3><p class="sub" style="margin:8px 0 12px">光标、评论、@提及。</p><ul><li>多人同时编辑不冲突</li><li>访客链接一键分享</li></ul></div><div class="art"></div></div>
  <div class="grid3" style="margin-top:28px">
   <div class="card"><div class="ic">⚡</div><h3>毫秒级同步</h3><p>本地优先架构，任何操作即时响应。</p></div>
   <div class="card"><div class="ic">🔒</div><h3>端到端加密</h3><p>你的数据只属于你，我们也看不到。</p></div>
   <div class="card"><div class="ic">🧩</div><h3>100+ 集成</h3><p>连接 Slack、GitHub、Figma 等常用工具。</p></div>
  </div>
 </div></section></div>

 <div class="page" data-page="/pricing"><section><div class="wrap">
  <h2>简单透明的价格</h2><p class="sub">随时升级或取消。</p>
  <div class="switch">月付 <button class="toggle" id="bill" aria-label="切换年付"></button> 年付 <span class="save">省 20%</span></div>
  <div class="grid3">
   <div class="card"><h3>个人</h3><div class="price" data-m="0" data-y="0">¥0<small>/月</small></div><ul><li>无限笔记</li><li>3 个白板</li><li>7 天历史</li></ul><button class="btn btn-ghost" style="margin-top:16px;width:100%;justify-content:center" data-open>开始使用</button></div>
   <div class="card pop"><h3>专业</h3><div class="price" data-m="48" data-y="38">¥48<small>/月</small></div><ul><li>无限白板</li><li>AI 整理</li><li>永久历史</li></ul><button class="btn btn-primary" style="margin-top:16px;width:100%;justify-content:center" data-open>试用 14 天</button></div>
   <div class="card"><h3>团队</h3><div class="price" data-m="98" data-y="78">¥98<small>/人/月</small></div><ul><li>权限管理</li><li>SSO 登录</li><li>专属支持</li></ul><a class="btn btn-ghost" style="margin-top:16px;width:100%;justify-content:center" href="#/contact">联系销售</a></div>
  </div>
  <div class="faq" style="margin-top:48px"><h2 style="font-size:24px;margin-bottom:16px">常见问题</h2>
   <details open><summary>可以随时取消吗？</summary><p>可以，取消后当期结束前仍可使用全部功能。</p></details>
   <details><summary>支持发票吗？</summary><p>支持增值税普通发票和专用发票，在账单页面申请即可。</p></details>
   <details><summary>数据可以导出吗？</summary><p>随时导出 Markdown、PDF 或 JSON，没有任何锁定。</p></details>
  </div>
 </div></section></div>

 <div class="page" data-page="/contact"><section><div class="wrap">
  <h2>和我们聊聊</h2><p class="sub">通常在 1 个工作日内回复。</p>
  <form id="form" novalidate>
   <label>姓名<input name="name" placeholder="你的名字" /><div class="err"></div></label>
   <label>邮箱<input name="email" placeholder="you@company.com" /><div class="err"></div></label>
   <label>团队规模<select name="size"><option>1–10 人</option><option>11–50 人</option><option>50 人以上</option></select></label>
   <label>留言<textarea name="msg" rows="4" placeholder="想了解什么？"></textarea><div class="err"></div></label>
   <button class="btn btn-primary" style="justify-content:center">发送</button>
  </form>
 </div></section></div>
</main>

<footer><div class="wrap">© 2026 Nimbus · 这是一个在画布里运行的示例网站，所有交互都可点击</div></footer>

<div class="modal" id="modal"><div class="dialog">
 <h3 style="font-size:22px">开始免费试用</h3><p class="sub" style="margin:6px 0 18px">无需信用卡，30 秒完成。</p>
 <form id="signup" novalidate style="gap:12px"><label>工作邮箱<input name="email" placeholder="you@company.com" /><div class="err"></div></label>
 <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary">创建账号</button></div></form>
</div></div>
<div class="toast" id="toast"></div>

<script>
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
function route(){const p=(location.hash.replace(/^#/,"")||"/");const page=$$(".page").find(e=>e.dataset.page===p)||$$(".page")[0];$$(".page").forEach(e=>e.classList.toggle("on",e===page));$$("[data-link]").forEach(a=>a.classList.toggle("on",a.getAttribute("href")==="#"+page.dataset.page));$("#drawer").classList.remove("on");window.scrollTo({top:0})}
addEventListener("hashchange",route);route();
$("#burger").onclick=()=>$("#drawer").classList.toggle("on");
$("#theme").onclick=e=>{const d=document.documentElement;const dark=d.dataset.theme!=="dark";d.dataset.theme=dark?"dark":"";e.currentTarget.textContent=dark?"☀️":"🌙"};
function toast(t){const el=$("#toast");el.textContent=t;el.classList.add("on");clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove("on"),2200)}
$$("[data-open]").forEach(b=>b.onclick=()=>$("#modal").classList.add("on"));
$("#modal").onclick=e=>{if(e.target.id==="modal"||e.target.hasAttribute("data-close"))$("#modal").classList.remove("on")};
addEventListener("keydown",e=>{if(e.key==="Escape")$("#modal").classList.remove("on")});
$$("#tabs button").forEach(b=>b.onclick=()=>{$$("#tabs button").forEach(x=>x.classList.toggle("on",x===b));$$(".panel").forEach((p,i)=>p.classList.toggle("on",i==b.dataset.tab))});
$("#bill").onclick=e=>{const y=e.currentTarget.classList.toggle("on");$$(".price").forEach(p=>{p.firstChild.textContent="¥"+(y?p.dataset.y:p.dataset.m)})};
const slides=$$(".slide"),dots=$("#dots");let cur=0;slides.forEach((_,i)=>{const b=document.createElement("button");b.onclick=()=>go(i);dots.append(b)});
function go(i){cur=(i+slides.length)%slides.length;$("#track").style.transform="translateX(-"+cur*100+"%)";$$("#dots button").forEach((d,j)=>d.classList.toggle("on",j===cur))}go(0);setInterval(()=>go(cur+1),4000);
const mail=v=>/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(v);
function check(f,rules){let ok=true;for(const[n,test,msg]of rules){const el=f.elements[n];const bad=!test(el.value.trim());el.classList.toggle("bad",bad);el.parentElement.querySelector(".err").textContent=bad?msg:"";if(bad)ok=false}return ok}
$("#form").onsubmit=e=>{e.preventDefault();if(check(e.target,[["name",v=>v.length>0,"请填写姓名"],["email",mail,"邮箱格式不正确"],["msg",v=>v.length>=5,"至少写 5 个字"]])){e.target.reset();toast("已发送，我们会尽快联系你 ✉️")}};
$("#signup").onsubmit=e=>{e.preventDefault();if(check(e.target,[["email",mail,"请输入有效的工作邮箱"]])){$("#modal").classList.remove("on");e.target.reset();toast("账号已创建，欢迎来到 Nimbus 🎉")}};
</script>
</body>
</html>`;
