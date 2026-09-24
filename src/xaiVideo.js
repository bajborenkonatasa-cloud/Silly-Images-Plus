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
  .iig-xv-backdrop{position:fixed;inset:0;z-index:100000;background:#000a;display:grid;place-items:center;padding:16px}
  .iig-xv-card{width:min(620px,96vw);max-height:90vh;overflow:auto;background:var(--SmartThemeBlurTintColor,#181818);color:var(--SmartThemeBodyColor,#eee);border:1px solid var(--SmartThemeBorderColor,#666);border-radius:18px;padding:18px;box-shadow:0 18px 60px #0009}
  .iig-xv-card h3{margin:0 0 6px}.iig-xv-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.iig-xv-card label{display:grid;gap:5px;margin:10px 0}.iig-xv-card textarea{min-height:120px;resize:vertical}.iig-xv-card select,.iig-xv-card textarea{width:100%}.iig-xv-cost{padding:10px 12px;border:1px solid #ffffff24;border-radius:12px;margin:10px 0}.iig-xv-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:14px}.iig-xv-status{min-height:1.4em;opacity:.85}.iig-xv-card .iig-xv-audio{display:flex;align-items:center;gap:8px}.iig-xv-card .iig-xv-audio input{width:auto}@media(max-width:520px){.iig-xv-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}
export function askXaiVideoOptions() {
  ensureDialogStyle();
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'iig-xv-backdrop';
    wrap.innerHTML = `<div class="iig-xv-card" role="dialog" aria-modal="true">
      <h3>🎬 Оживить изображение через Grok</h3>
      <div style="opacity:.75">Исходная картинка останется на месте.</div>
      <label>Что должно происходить<textarea class="iig-xv-prompt" placeholder="Например: волосы слегка колышутся, персонажи моргают и смотрят друг на друга, медленный наезд камеры…"></textarea></label>
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
    const model = wrap.querySelector('.iig-xv-model'), duration = wrap.querySelector('.iig-xv-duration'), resolution = wrap.querySelector('.iig-xv-resolution'), cost = wrap.querySelector('.iig-xv-cost');
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
    wrap.addEventListener('click', e => { if (e.target === wrap) finish(null); });
    wrap.querySelector('.iig-xv-go').onclick = () => finish({
      prompt: wrap.querySelector('.iig-xv-prompt').value,
      model:model.value, duration:Number(duration.value), resolution:resolution.value,
      generateAudio: wrap.querySelector('.iig-xv-audio-input').checked,
    });
  });
}
export async function animateImageInteractive(imageSrc, onStatus = () => {}) {
  const options = await askXaiVideoOptions();
  if (!options) return null;
  return generateXaiVideoFromImage(imageSrc, options, onStatus);
}
