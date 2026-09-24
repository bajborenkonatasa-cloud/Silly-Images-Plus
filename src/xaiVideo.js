import { getSettings, iigLog } from './settings.js';

const VIDEO_MODELS = {
  'grok-imagine-video': { label: 'Grok Video · экономный', rates: { '480p': 0.05, '720p': 0.07 }, imageInput: 0.002 },
  'grok-imagine-video-1.5': { label: 'Grok Video 1.5 · лучшее качество', rates: { '480p': 0.08, '720p': 0.14, '1080p': 0.25 }, imageInput: 0.01 },
};

function xaiConfig(settings = getSettings()) {
  if (settings.apiType === 'xai' && settings.apiKey) return settings;
  const saved = (settings.connectionProfiles || []).find(p => p?.apiType === 'xai' && p?.apiKey);
  if (saved) return saved;
  throw new Error('Не найден сохранённый профиль xAI с API-ключом.');
}
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

function ensureDialogStyle() {
  if (document.getElementById('iig-xai-video-style')) return;
  const style = document.createElement('style');
  style.id = 'iig-xai-video-style';
  style.textContent = `
  .iig-xv-backdrop{position:fixed;inset:0;z-index:100000;background:#000a;display:grid;justify-items:center;align-items:start;padding:16px;overflow-y:auto;overscroll-behavior:contain}
  .iig-xv-card{width:min(620px,96vw);max-height:none;overflow:visible;margin:8px 0 24px;background:var(--SmartThemeBlurTintColor,#181818);color:var(--SmartThemeBodyColor,#eee);border:1px solid var(--SmartThemeBorderColor,#666);border-radius:18px;padding:18px;box-shadow:0 18px 60px #0009}
  .iig-xv-card h3{margin:0 0 6px}.iig-xv-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.iig-xv-card label{display:grid;gap:5px;margin:10px 0}.iig-xv-prompt-wrap{padding:10px 12px;border:1px solid color-mix(in srgb,var(--SmartThemeBorderColor,#777) 70%,transparent);border-radius:13px;background:rgba(0,0,0,.16)}.iig-xv-prompt-title{font-weight:700}.iig-xv-prompt-help{font-size:.82em;opacity:.72}.iig-xv-card textarea{min-height:92px;resize:vertical;background:rgba(0,0,0,.28)!important;color:var(--SmartThemeBodyColor,#eee)!important}.iig-xv-card select,.iig-xv-card textarea{width:100%}.iig-xv-cost{padding:10px 12px;border:1px solid #ffffff24;border-radius:12px;margin:10px 0}.iig-xv-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}.iig-xv-actions button{width:auto!important;min-width:0!important;padding:8px 12px!important;border:1px solid rgba(255,255,255,.25)!important;border-radius:10px!important;background:rgba(18,18,22,.92)!important;color:#fff!important}.iig-xv-actions .iig-xv-go{background:rgba(48,82,130,.95)!important}.iig-xv-status{min-height:1.4em;opacity:.85}.iig-xv-card .iig-xv-audio{display:flex;align-items:center;gap:8px}.iig-xv-card .iig-xv-audio input{width:auto}@media(max-width:520px){.iig-xv-grid{grid-template-columns:1fr}.iig-xv-card{padding:14px}.iig-xv-card textarea{min-height:88px}}
  `;
  document.head.appendChild(style);
}
export function askXaiVideoOptions(initialPrompt = '') {
  ensureDialogStyle();
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'iig-xv-backdrop';
    wrap.innerHTML = `<div class="iig-xv-card" role="dialog" aria-modal="true">
      <div style="display:flex;align-items:center;gap:10px"><h3 style="flex:1">🎬 Оживить изображение через Grok</h3><button type="button" class="iig-xv-x" aria-label="Закрыть" style="width:34px!important;height:34px!important;min-width:34px!important;padding:0!important;border-radius:10px!important">✕</button></div>
      <div style="opacity:.75">Исходная картинка останется на месте.</div>
      <label class="iig-xv-prompt-wrap"><span class="iig-xv-prompt-title">✍️ Твой промпт движения</span><span class="iig-xv-prompt-help">Пиши здесь именно то, что должно произойти в видео. Текст можно полностью заменить.</span><textarea class="iig-xv-prompt" placeholder="Например: девушка медленно поднимает взгляд, парень наклоняется ближе, волосы слегка движутся, камера плавно приближается…"></textarea></label>
      <div class="iig-xv-grid">
        <label>Модель<select class="iig-xv-model"><option value="grok-imagine-video">Grok Video · экономный</option><option value="grok-imagine-video-1.5">Grok Video 1.5 · качество</option></select></label>
        <label>Длительность<select class="iig-xv-duration"><option>3</option><option selected>5</option><option>8</option><option>10</option><option>15</option></select></label>
        <label>Качество<select class="iig-xv-resolution"><option value="480p">480p · дёшево</option><option value="720p" selected>720p · HD</option><option value="1080p">1080p · Full HD</option></select></label>
        <label class="iig-xv-audio"><input class="iig-xv-audio-input" type="checkbox" checked> 🔊 Генерировать звук</label>
      </div>
      <div class="iig-xv-cost"></div><div class="iig-xv-status"></div>
      <div class="iig-xv-actions"><button type="button" class="iig-xv-cancel">Отмена</button><button type="button" class="iig-xv-go">🎬 Создать видео</button></div>
    </div>`;
    document.body.appendChild(wrap);
    const promptBox = wrap.querySelector('.iig-xv-prompt');
    const rememberedPrompt = localStorage.getItem('iig_xai_video_prompt') || '';
    promptBox.value = String(initialPrompt || rememberedPrompt || '');
    let remembered = {};
    try { remembered = JSON.parse(localStorage.getItem('iig_xai_video_options') || '{}'); } catch {}
    const model = wrap.querySelector('.iig-xv-model'), duration = wrap.querySelector('.iig-xv-duration'), resolution = wrap.querySelector('.iig-xv-resolution'), cost = wrap.querySelector('.iig-xv-cost');
    if ([...model.options].some(o => o.value === remembered.model)) model.value = remembered.model;
    if ([...duration.options].some(o => o.value === String(remembered.duration))) duration.value = String(remembered.duration);
    if ([...resolution.options].some(o => o.value === remembered.resolution)) resolution.value = remembered.resolution;
    if (typeof remembered.generateAudio === 'boolean') wrap.querySelector('.iig-xv-audio-input').checked = remembered.generateAudio;
    const update = () => {
      const isClassic = model.value === 'grok-imagine-video';
      const opt1080 = resolution.querySelector('option[value="1080p"]');
      opt1080.disabled = isClassic;
      if (isClassic && resolution.value === '1080p') resolution.value = '720p';
      const value = estimateXaiVideoCost({ model:model.value, duration:Number(duration.value), resolution:resolution.value });
      cost.textContent = value == null ? 'Стоимость: зависит от модели' : `Примерная стоимость этого ролика: $${value.toFixed(2)}`;
    };
    [model,duration,resolution].forEach(el => el.addEventListener('change', update)); update();
    const finish = (value) => { wrap.remove(); resolve(value); };
    wrap.querySelector('.iig-xv-cancel').onclick = () => finish(null);
    wrap.querySelector('.iig-xv-x').onclick = () => finish(null);
    wrap.addEventListener('click', e => { if (e.target === wrap) finish(null); });
    wrap.querySelector('.iig-xv-go').onclick = () => {
      const value = {
        prompt: promptBox.value.trim(),
        model:model.value, duration:Number(duration.value), resolution:resolution.value,
        generateAudio: wrap.querySelector('.iig-xv-audio-input').checked,
      };
      localStorage.setItem('iig_xai_video_prompt', value.prompt);
      localStorage.setItem('iig_xai_video_options', JSON.stringify({
        model:value.model, duration:value.duration, resolution:value.resolution, generateAudio:value.generateAudio,
      }));
      finish(value);
    };
  });
}
export async function animateImageInteractive(imageSrc, onStatus = () => {}, initialPrompt = '') {
  const options = await askXaiVideoOptions(initialPrompt);
  if (!options) return null;
  return generateXaiVideoFromImage(imageSrc, options, onStatus);
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
  };
}
