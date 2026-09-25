import { getSettings, iigLog } from './settings.js';

const VIDEO_MODELS = {
  'grok-imagine-video': { label: 'Grok Video · экономный', rates: { '480p': 0.05, '720p': 0.07 }, imageInput: 0.002 },
  'grok-imagine-video-1.5': { label: 'Grok Video 1.5 · лучшее качество', rates: { '480p': 0.08, '720p': 0.14, '1080p': 0.25 }, imageInput: 0.01 },
};

function xaiConfig(settings = getSettings()) {
  const directKey = String(settings.apiKeys?.xai || (settings.apiType === 'xai' ? settings.apiKey : '') || '').trim();
  if (directKey) return { ...settings, apiKey: directKey, endpoint: settings.apiType === 'xai' ? settings.endpoint : 'https://api.x.ai' };
  const saved = (settings.connectionProfiles || []).find(p => p?.apiType === 'xai' && p?.apiKey);
  if (saved) return saved;
  throw new Error('Не найден сохранённый xAI API-ключ.');
}
function geminiConfig(settings = getSettings()) {
  const directKey = String(settings.apiKeys?.gemini || (settings.apiType === 'gemini' ? settings.apiKey : '') || '').trim();
  if (directKey) return { apiKey: directKey };
  const saved = (settings.connectionProfiles || []).find(p => p?.apiType === 'gemini' && p?.apiKey);
  if (saved?.apiKey) return { apiKey: String(saved.apiKey).trim() };
  throw new Error('Не найден сохранённый Gemini API-ключ. Открой профиль Gemini / nano-banana в Silly Images Plus и сохрани ключ.');
}
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const VEO_MODELS = {
  'veo-3.1-lite-generate-preview': { label: 'Veo 3.1 Lite · самый дешёвый', rates: { '720p': 0.05, '1080p': 0.08 } },
  'veo-3.1-fast-generate-preview': { label: 'Veo 3.1 Fast · баланс', rates: { '720p': 0.10, '1080p': 0.12, '4k': 0.30 } },
  'veo-3.1-generate-preview': { label: 'Veo 3.1 · максимум', rates: { '720p': 0.40, '1080p': 0.40, '4k': 0.60 } },
};

function endpointBase(settings) {
  return String(settings.endpoint || 'https://api.x.ai').trim().replace(/\/+$/, '');
}
function headers(settings) {
  if (!settings.apiKey) throw new Error('В профиле xAI не найден API-ключ.');
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.apiKey}` };
}
async function imageAsDataUrl(src) {
  if (String(src).startsWith('data:image/')) return src;
  const response = await fetch(src, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Не удалось прочитать исходную картинку (HTTP ${response.status}).`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('Исходный файл не является изображением.');
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Не удалось подготовить картинку для Grok Video.'));
    reader.readAsDataURL(blob);
  });
}
async function parseJson(response) {
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `HTTP ${response.status}`;
    throw new Error(String(message));
  }
  return data || {};
}
export async function fetchXaiVideoModels() {
  const settings = xaiConfig();
  const response = await fetch(`${endpointBase(settings)}/v1/video-generation-models`, { headers: { Authorization: `Bearer ${settings.apiKey}` }, cache: 'no-store' });
  const data = await parseJson(response);
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  return list.map(x => typeof x === 'string' ? x : x?.id || x?.name).filter(Boolean);
}
export function estimateXaiVideoCost({ model, duration, resolution }) {
  const info = VIDEO_MODELS[model] || VIDEO_MODELS['grok-imagine-video-1.5'];
  const rate = info.rates[resolution];
  return Number.isFinite(rate) ? duration * rate + info.imageInput : null;
}
export async function generateXaiVideoFromImage(imageSrc, options, onStatus = () => {}) {
  const settings = xaiConfig();
  const model = options.model || 'grok-imagine-video';
  const info = VIDEO_MODELS[model];
  if (!info) throw new Error(`Неизвестная video-модель: ${model}`);
  let resolution = options.resolution || '480p';
  if (!info.rates[resolution]) resolution = model === 'grok-imagine-video' ? '720p' : '480p';
  const duration = Math.max(1, Math.min(15, Number(options.duration) || 5));
  onStatus('Подготавливаю исходную картинку…');
  const dataUrl = await imageAsDataUrl(imageSrc);
  const body = {
    model,
    image: { url: dataUrl },
    duration,
    resolution,
    generate_audio: options.generateAudio !== false,
  };
  const prompt = String(options.prompt || '').trim();
  if (prompt) body.prompt = prompt;
  onStatus('Отправляю в Grok Video…');
  const start = await fetch(`${endpointBase(settings)}/v1/videos/generations`, {
    method: 'POST', headers: headers(settings), body: JSON.stringify(body),
  });
  const started = await parseJson(start);
  const requestId = started.request_id;
  if (!requestId) throw new Error('xAI не вернул request_id.');
  const begun = Date.now();
  while (Date.now() - begun < 12 * 60 * 1000) {
    await new Promise(r => setTimeout(r, 5000));
    const elapsed = Math.round((Date.now() - begun) / 1000);
    onStatus(`Grok оживляет сцену… ${elapsed}с`);
    const poll = await fetch(`${endpointBase(settings)}/v1/videos/${encodeURIComponent(requestId)}`, {
      headers: { Authorization: `Bearer ${settings.apiKey}` }, cache: 'no-store',
    });
    const result = await parseJson(poll);
    if (result.status === 'done') {
      const url = result.video?.url || result.video_url || result.url;
      if (!url) throw new Error('Видео готово, но xAI не вернул URL.');
      iigLog('INFO', `xAI video ready: model=${model}, duration=${duration}, resolution=${resolution}`);
      onStatus('Видео готово');
      return { url, requestId, model, duration, resolution };
    }
    if (result.status === 'failed' || result.status === 'expired') {
      throw new Error(result.error?.message || `Генерация завершилась со статусом ${result.status}.`);
    }
  }
  throw new Error('Grok Video не завершил генерацию за 12 минут.');
}

function estimateVeoVideoCost({ model, duration, resolution }) {
  const info = VEO_MODELS[model] || VEO_MODELS['veo-3.1-lite-generate-preview'];
  const rate = info.rates[resolution];
  return Number.isFinite(rate) ? Number(duration) * rate : null;
}
function dataUrlParts(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) throw new Error('Не удалось подготовить картинку для Veo.');
  return { mimeType: match[1], data: match[2] };
}
async function generateVeoVideoFromImage(imageSrc, options, onStatus = () => {}) {
  const { apiKey } = geminiConfig();
  const model = VEO_MODELS[options.model] ? options.model : 'veo-3.1-lite-generate-preview';
  let resolution = options.resolution || '720p';
  if (!VEO_MODELS[model].rates[resolution]) resolution = '720p';
  let duration = [4, 6, 8].includes(Number(options.duration)) ? Number(options.duration) : 8;
  if (resolution === '1080p' || resolution === '4k') duration = 8;
  const prompt = String(options.prompt || '').trim();
  if (!prompt) throw new Error('Для Veo напиши, что должно происходить в видео.');
  onStatus('Подготавливаю исходную картинку для Veo…');
  const parts = dataUrlParts(await imageAsDataUrl(imageSrc));
  const body = {
    instances: [{
      prompt,
      image: { mimeType: parts.mimeType, bytesBase64Encoded: parts.data },
    }],
    parameters: {
      aspectRatio: options.aspectRatio || '9:16',
      durationSeconds: String(duration),
      resolution,
      numberOfVideos: 1,
      personGeneration: 'allow_adult',
    },
  };
  onStatus('Отправляю в Google Veo…');
  const start = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:predictLongRunning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  const started = await parseJson(start);
  const operationName = started?.name;
  if (!operationName) throw new Error('Google Veo не вернул имя операции.');
  const begun = Date.now();
  while (Date.now() - begun < 15 * 60 * 1000) {
    await new Promise(r => setTimeout(r, 10000));
    const elapsed = Math.round((Date.now() - begun) / 1000);
    onStatus(`Veo создаёт видео со звуком… ${elapsed}с`);
    const poll = await fetch(`${GEMINI_BASE}/${operationName}`, {
      headers: { 'x-goog-api-key': apiKey }, cache: 'no-store',
    });
    const result = await parseJson(poll);
    if (!result.done) continue;
    if (result.error) throw new Error(result.error?.message || 'Google Veo завершил генерацию с ошибкой.');
    const sample = result?.response?.generateVideoResponse?.generatedSamples?.[0];
    const videoUri = sample?.video?.uri;
    if (!videoUri) throw new Error('Видео готово, но Google не вернул URI файла.');
    onStatus('Видео готово, загружаю файл…');
    const fileResponse = await fetch(videoUri, { headers: { 'x-goog-api-key': apiKey }, cache: 'no-store' });
    if (!fileResponse.ok) throw new Error(`Не удалось загрузить готовое Veo-видео (HTTP ${fileResponse.status}).`);
    const blob = await fileResponse.blob();
    const url = URL.createObjectURL(blob);
    iigLog('INFO', `Veo video ready: model=${model}, duration=${duration}, resolution=${resolution}`);
    onStatus('Veo-видео готово');
    return { url, requestId: operationName, model, duration, resolution, provider: 'veo', transientUrl: true };
  }
  throw new Error('Google Veo не завершил генерацию за 15 минут.');
}

function ensureDialogStyle() {
  if (document.getElementById('iig-xai-video-style')) return;
  const style = document.createElement('style');
  style.id = 'iig-xai-video-style';
  style.textContent = `
  .iig-xv-backdrop{position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;padding:12px;border:0;background:rgba(0,0,0,.72);box-sizing:border-box;overflow:auto;color:inherit}.iig-xv-backdrop[open]{display:flex;align-items:flex-start;justify-content:center}.iig-xv-backdrop::backdrop{background:rgba(0,0,0,.72)}
  .iig-xv-card{width:min(620px,calc(100vw - 24px));max-height:none;overflow:visible;margin:8px auto 28px;background:var(--SmartThemeBlurTintColor,#181818);color:var(--SmartThemeBodyColor,#eee);border:1px solid var(--SmartThemeBorderColor,#666);border-radius:18px;padding:18px;box-shadow:0 18px 60px #0009}
  .iig-xv-card h3{margin:0 0 6px}.iig-xv-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.iig-xv-card label{display:grid;gap:5px;margin:10px 0}.iig-xv-prompt-wrap{padding:10px 12px;border:1px solid color-mix(in srgb,var(--SmartThemeBorderColor,#777) 70%,transparent);border-radius:13px;background:rgba(0,0,0,.16)}.iig-xv-prompt-title{font-weight:700}.iig-xv-prompt-help{font-size:.82em;opacity:.72}.iig-xv-card textarea{min-height:90px;resize:vertical;background:rgba(0,0,0,.28)!important;color:var(--SmartThemeBodyColor,#eee)!important}.iig-xv-card select,.iig-xv-card textarea{width:100%}.iig-xv-cost{padding:10px 12px;border:1px solid #ffffff24;border-radius:12px;margin:10px 0}.iig-xv-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}.iig-xv-actions button{width:auto!important;min-width:0!important;padding:8px 12px!important;border:1px solid rgba(255,255,255,.25)!important;border-radius:10px!important;background:rgba(18,18,22,.92)!important;color:#fff!important}.iig-xv-actions .iig-xv-go{background:rgba(48,82,130,.95)!important}.iig-xv-status{min-height:1.4em;opacity:.85}.iig-xv-card .iig-xv-audio{display:flex;align-items:center;gap:8px}.iig-xv-card .iig-xv-audio input{width:auto}@media(max-width:520px){.iig-xv-grid{grid-template-columns:1fr}.iig-xv-card{padding:13px}.iig-xv-card textarea{min-height:84px}.iig-xv-actions{padding-top:4px}}
  `;
  document.head.appendChild(style);
}
export function askXaiVideoOptions(initialPrompt = '') {
  ensureDialogStyle();
  return new Promise((resolve) => {
    const wrap = document.createElement('dialog');
    wrap.className = 'iig-xv-backdrop';
    wrap.setAttribute('aria-label', 'Video generator');
    wrap.innerHTML = `<div class="iig-xv-card" role="dialog" aria-modal="true">
      <h3>🎬 Оживить изображение</h3>
      <div style="opacity:.75">Исходная картинка останется на месте. Выбери Grok или Google Veo.</div>
      <label>Видеодвижок<select class="iig-xv-provider"><option value="grok">xAI · Grok Imagine Video</option><option value="veo">Google · Veo 3.1</option></select></label>
      <label class="iig-xv-prompt-wrap"><span class="iig-xv-prompt-title">✍️ Что должно произойти и что должно быть слышно</span><span class="iig-xv-prompt-help">Движение персонажей, камера, атмосфера, реплики и звуки — всё можно написать здесь.</span><textarea class="iig-xv-prompt" placeholder="Например: девушка медленно поднимает взгляд, волосы движутся от ветра, камера плавно приближается. Слышно тихий дождь…"></textarea></label>
      <div class="iig-xv-grid">
        <label>Модель<select class="iig-xv-model"></select></label>
        <label>Длительность<select class="iig-xv-duration"></select></label>
        <label>Качество<select class="iig-xv-resolution"></select></label>
        <label class="iig-xv-audio"><input class="iig-xv-audio-input" type="checkbox" checked> 🔊 Генерировать звук</label>
      </div>
      <div class="iig-xv-cost"></div><div class="iig-xv-status"></div>
      <div class="iig-xv-actions"><button type="button" class="iig-xv-cancel">Отмена</button><button type="button" class="iig-xv-go">🎬 Создать видео</button></div>
    </div>`;
    document.body.appendChild(wrap);
    wrap.showModal();
    const q = sel => wrap.querySelector(sel);
    const provider=q('.iig-xv-provider'), promptBox=q('.iig-xv-prompt'), model=q('.iig-xv-model'), duration=q('.iig-xv-duration'), resolution=q('.iig-xv-resolution'), audio=q('.iig-xv-audio-input'), cost=q('.iig-xv-cost');
    let remembered={}; try { remembered=JSON.parse(localStorage.getItem('iig_video_options')||'{}'); } catch {}
    promptBox.value=String(initialPrompt || localStorage.getItem('iig_video_prompt') || '');
    if (remembered.provider === 'veo' || remembered.provider === 'grok') provider.value=remembered.provider;
    const fill=(el, items, selected)=>{ el.innerHTML=items.map(([v,l])=>`<option value="${v}">${l}</option>`).join(''); if([...el.options].some(o=>o.value===String(selected))) el.value=String(selected); };
    const rebuild=()=>{
      if(provider.value==='veo'){
        fill(model,Object.entries(VEO_MODELS).map(([v,x])=>[v,x.label]), remembered.provider==='veo'?remembered.model:'veo-3.1-lite-generate-preview');
        fill(duration,[[4,'4 сек'],[6,'6 сек'],[8,'8 сек']],remembered.provider==='veo'?remembered.duration:8);
        fill(resolution,[['720p','720p · экономно'],['1080p','1080p · 8 сек'],['4k','4K · 8 сек']],remembered.provider==='veo'?remembered.resolution:'720p');
        audio.checked=true; audio.disabled=true; audio.closest('label').title='Veo 3.1 генерирует аудио вместе с видео';
      } else {
        fill(model,Object.entries(VIDEO_MODELS).map(([v,x])=>[v,x.label]),remembered.provider==='grok'?remembered.model:'grok-imagine-video');
        fill(duration,[[3,'3 сек'],[5,'5 сек'],[8,'8 сек'],[10,'10 сек'],[15,'15 сек']],remembered.provider==='grok'?remembered.duration:5);
        fill(resolution,[['480p','480p · дёшево'],['720p','720p · HD'],['1080p','1080p · Full HD']],remembered.provider==='grok'?remembered.resolution:'720p');
        audio.disabled=false; audio.checked=remembered.provider==='grok' && typeof remembered.generateAudio==='boolean'?remembered.generateAudio:true;
      }
      update();
    };
    const update=()=>{
      if(provider.value==='veo'){
        const info=VEO_MODELS[model.value];
        [...resolution.options].forEach(o=>o.disabled=!info?.rates?.[o.value]);
        if(!info?.rates?.[resolution.value]) resolution.value='720p';
        if(resolution.value==='1080p'||resolution.value==='4k') duration.value='8';
        [...duration.options].forEach(o=>o.disabled=(resolution.value!=='720p'&&o.value!=='8'));
        const v=estimateVeoVideoCost({model:model.value,duration:Number(duration.value),resolution:resolution.value});
        cost.textContent=v==null?'Стоимость: зависит от модели':`Примерная стоимость Veo: $${v.toFixed(2)} · звук включён`;
      } else {
        const classic=model.value==='grok-imagine-video'; const o1080=resolution.querySelector('option[value="1080p"]'); if(o1080)o1080.disabled=classic; if(classic&&resolution.value==='1080p')resolution.value='720p';
        [...duration.options].forEach(o=>o.disabled=false);
        const v=estimateXaiVideoCost({model:model.value,duration:Number(duration.value),resolution:resolution.value});
        cost.textContent=v==null?'Стоимость: зависит от модели':`Примерная стоимость Grok: $${v.toFixed(2)}`;
      }
    };
    provider.addEventListener('change',()=>{remembered={provider:provider.value};rebuild();}); model.addEventListener('change',update); duration.addEventListener('change',update); resolution.addEventListener('change',update); rebuild();
    const finish=value=>{try{wrap.close();}catch{} wrap.remove(); resolve(value);};
    q('.iig-xv-cancel').onclick=()=>finish(null); wrap.addEventListener('click',e=>{if(e.target===wrap)finish(null)}); wrap.addEventListener('cancel',e=>{e.preventDefault();finish(null)});
    q('.iig-xv-go').onclick=()=>{
      const value={provider:provider.value,prompt:promptBox.value.trim(),model:model.value,duration:Number(duration.value),resolution:resolution.value,generateAudio:audio.checked,aspectRatio:'9:16'};
      localStorage.setItem('iig_video_prompt',value.prompt); localStorage.setItem('iig_video_options',JSON.stringify(value)); finish(value);
    };
  });
}
export async function animateImageInteractive(imageSrc, onStatus = () => {}, initialPrompt = '') {
  const options = await askXaiVideoOptions(initialPrompt);
  if (!options) return null;
  return options.provider === 'veo' ? generateVeoVideoFromImage(imageSrc, options, onStatus) : generateXaiVideoFromImage(imageSrc, options, onStatus);
}


/**
 * Stable cross-extension bridge for Scene Blocks Lite.
 * Scene Blocks should prefer this global bridge instead of assuming a folder name.
 */
if (typeof globalThis !== 'undefined') {
  globalThis.SillyImagesPlusVideo = {
    animateImageInteractive,
    generateXaiVideoFromImage,
    estimateXaiVideoCost,
    generateVeoVideoFromImage,
    estimateVeoVideoCost,
  };
}
