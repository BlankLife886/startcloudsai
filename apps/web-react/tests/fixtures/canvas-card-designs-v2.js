// Move existing controls, preserving the parameter and preview event handlers.
const revisionNames = {
  a: ['A · 精修面板', '参数清晰 / 层级更轻'],
  b: ['B · 紧凑控制台', '横向参数 / 素材条'],
  c: ['C · 创作面板', '提示词优先 / 自适应双栏'],
};
for (const option of document.querySelectorAll('.option')) {
  const variant = option.dataset.variant;
  const [title, description] = revisionNames[variant];
  option.querySelector('h2').textContent = title;
  option.querySelector('.caption small').textContent = description;
  document.querySelector(`[data-view="${variant}"]`).textContent = title;
  const card = option.querySelector('.card');
  const body = card.querySelector('.body');
  const assets = card.querySelector('.asset-section');
  const prompt = card.querySelector('.prompt');
  const heading = prompt.previousElementSibling;
  heading.style.removeProperty('margin-top');
  const meta = prompt.nextElementSibling;
  const section = document.createElement('section');
  section.className = 'section prompt-section';
  section.append(heading, prompt, meta);
  if (variant === 'c') {
    body.prepend(section);
    body.append(assets, card.querySelector('.parameter-section'));
    card.prepend(card.querySelector('.head'));
    heading.firstChild.textContent = '这次想创作什么？ ';
  } else {
    body.append(section);
    if (variant === 'b') card.prepend(card.querySelector('.head'));
  }
}
document.querySelector('.top h1').textContent = '生成卡片 · 第二轮设计';
