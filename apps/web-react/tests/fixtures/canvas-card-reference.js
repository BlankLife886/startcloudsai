const referenceOption=document.querySelector('[data-variant="c"]').cloneNode(true);
referenceOption.dataset.variant='d';
referenceOption.querySelector('h2').textContent='D · 参考图方向';
referenceOption.querySelector('.caption small').textContent='提示词 → 参考图 → 参数 → 结果';
const referenceCard=referenceOption.querySelector('.card');referenceCard.className='card d';
referenceCard.querySelector('.title strong').textContent='图片生成';
const model=referenceCard.querySelector('.model');
const modelField=document.createElement('label');modelField.className='field model-field';
const modelLabel=document.createElement('span');modelLabel.textContent='模型';modelField.append(modelLabel,model);referenceCard.querySelector('.fields').prepend(modelField);
referenceCard.querySelector('.body').append(referenceCard.querySelector('.parameter-section'));
const add=document.createElement('button');add.type='button';add.className='ref-add';add.textContent='＋ 添加';add.title='演示：添加一张参考图';
referenceCard.querySelector('.references').append(add);
const results=document.createElement('section');results.className='results';results.innerHTML='<div class="results-head"><span>生成结果 <small>· 演示</small></span><button class="clear-results" type="button">清空</button></div><div class="result-grid"></div>';
referenceCard.querySelector('.footer').append(results);
const q=s=>referenceCard.querySelector(s);let amount=1,sizeMode='ratio';
function updateReference(){q('.chars').textContent=q('.prompt').value.length+' 字';q('.stepper output').textContent=amount+' 张';q('[data-step="-1"]').disabled=amount===1;q('[data-step="1"]').disabled=amount===4;q('.cost').textContent=(q('.model').selectedIndex?48:32)*amount+' 积分';const [w,h]=Array.from(referenceCard.querySelectorAll('.exact input')).map(i=>Number(i.value));const valid=w>=256&&w<=4096&&h>=256&&h<=4096;q('.size-hint').textContent=sizeMode==='ratio'?`${q('[aria-label="宽高比"]').value} · ${q('[aria-label="分辨率"]').value}`:valid?`${w} × ${h} px`:'宽高需在 256–4096 px 之间';q('.action').disabled=sizeMode==='exact'&&!valid}
function showResults(){q('.result-grid').innerHTML='';for(let i=0;i<amount;i++){const item=document.createElement('div');item.className='result';item.innerHTML='<i class="bottle"></i><span class="result-label">演示图片 '+(i+1)+'</span>';q('.result-grid').append(item)}}
referenceCard.addEventListener('input',updateReference);referenceCard.addEventListener('change',updateReference);
referenceCard.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{amount=Math.max(1,Math.min(4,amount+Number(b.dataset.step)));updateReference()});
referenceCard.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{sizeMode=b.dataset.mode;referenceCard.querySelectorAll('[data-mode]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));referenceCard.querySelectorAll('.ratio-field').forEach(x=>x.classList.toggle('hide',sizeMode==='exact'));q('.exact').style.display=sizeMode==='exact'?'grid':'none';updateReference()});
add.onclick=()=>{const count=referenceCard.querySelectorAll('.ref').length;if(count>=4){q('.notice').textContent='演示最多添加 4 张参考图';return}const item=q('.ref').cloneNode(true);item.querySelector('.name').textContent='@图'+(count+1)+' 新参考图';add.before(item);q('.asset-section .section-title small').textContent=(count+1)+' 张参考图';q('.meta span:last-child').textContent=(count+1)+' 个图片引用 · 可直接编辑'};
q('.clear-results').onclick=()=>{q('.result-grid').innerHTML='<div class="result-empty">暂无结果</div>'};q('.action').onclick=()=>{showResults();q('.notice').textContent='仅更新演示结果，未发起真实生成或扣费。'};
document.querySelector('#gallery').append(referenceOption);
const choice=document.createElement('button');choice.dataset.view='d';choice.textContent='D · 参考图方向';document.querySelector('.choices').append(choice);
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.querySelectorAll('.option').forEach(x=>x.classList.toggle('hide',b.dataset.view!=='all'&&x.dataset.variant!==b.dataset.view))});
updateReference();showResults();choice.click();
document.querySelector('.top h1').textContent='生成卡片 · 参考图布局';
