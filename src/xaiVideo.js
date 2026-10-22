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
      durationSeconds: Number(duration),
      resolution,
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

// Gemini Omni uses Interactions API, not Veo predictLongRunning.
async function generateOmniVideoFromImage(imageSrc, options, onStatus = () => {}) {
  const { apiKey } = geminiConfig();
  const prompt = String(options.prompt || '').trim();
  if (!prompt) throw new Error('Опиши движение для Gemini Omni.');
  onStatus('Подготавливаю изображение для Gemini Omni…');
  const sources = [imageSrc, ...(options.referenceImages || [])];
  if (sources.length > 5) throw new Error('Для этого режима выбери не более 5 референсов.');
  const images = await Promise.all(sources.map(async src => {
    const parts = dataUrlParts(await imageAsDataUrl(src));
    return { type: 'image', data: parts.data, mime_type: parts.mimeType };
  }));
  const requestedDuration = Number(options.duration);
  const videoFormat = {
    type: 'video', aspect_ratio: options.aspectRatio || '9:16',
    resolution: options.resolution || '360p',
    ...(Number.isInteger(requestedDuration) && requestedDuration >= 3 && requestedDuration <= 10
      ? { duration: `${requestedDuration}s` } : {}),
  };
  const body = {
    model: 'gemini-omni-1.1-flash',
    input: [...images, { type: 'text', text: prompt }],
    response_format: videoFormat,
    generation_config: { video_config: { task: 'reference_to_video' } },
    background: true,
  };
  onStatus('Отправляю запрос Gemini Omni…');
  const response = await fetch(`${GEMINI_BASE}/interactions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  let result = await parseJson(response);
  const requestId = result.id;
  const started = Date.now();
  while (result.status !== 'completed' && Date.now() - started < 15 * 60 * 1000) {
    if (['failed', 'cancelled', 'expired'].includes(result.status)) throw new Error(result.error?.message || `Omni: ${result.status}`);
    if (!requestId) throw new Error('Gemini Omni не вернул идентификатор генерации.');
    await new Promise(r => setTimeout(r, 10000));
    onStatus(`Gemini Omni создаёт видео… ${Math.round((Date.now() - started) / 1000)}с`);
    result = await parseJson(await fetch(`${GEMINI_BASE}/interactions/${encodeURIComponent(requestId)}`, {
      headers: { 'x-goog-api-key': apiKey }, cache: 'no-store',
    }));
  }
  if (result.status !== 'completed') throw new Error('Gemini Omni не завершил генерацию за 15 минут.');
  const contents = (result.steps || []).filter(step => step.type === 'model_output').flatMap(step => step.content || []);
  const video = result.output_video || contents.find(part => part.type === 'video');
  if (!video) throw new Error('Gemini Omni завершил запрос, но не вернул видео.');
  let blob;
  if (video.data) {
    const bytes = atob(video.data);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    blob = new Blob([arr], { type: video.mime_type || 'video/mp4' });
  } else if (video.uri) {
    const file = await fetch(video.uri, { headers: { 'x-goog-api-key': apiKey } });
    if (!file.ok) throw new Error(`Ошибка загрузки видео Omni: HTTP ${file.status}`);
    blob = await file.blob();
  } else throw new Error('Omni не вернул данные видео или ссылку.');
  const url = URL.createObjectURL(blob);
  onStatus('Gemini Omni: видео готово');
  iigLog('INFO', 'Gemini Omni video ready');
  return { url, requestId, model: 'gemini-omni-1.1-flash', provider: 'omni', transientUrl: true };
}

// Portrait library is browser-local and independent of volatile dialog state.
function portraitDb() {
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('iig-director-portraits-v1',1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('portraits'))req.result.createObjectStore('portraits')};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
async function portraitStore(action,key,value){
  const db=await portraitDb();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('portraits',action==='get'?'readonly':'readwrite');
    const store=tx.objectStore('portraits');
    const req=action==='get'?store.get(key):action==='delete'?store.delete(key):store.put(value,key);
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.onerror=()=>reject(tx.error);
  })}finally{db.close()}
}
function portraitFileData(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Ошибка чтения портрета'));r.readAsDataURL(file)})}
function normalizePortraitName(name){return String(name||'').trim().toLocaleLowerCase().slice(0,100)}

// Local, zero-cost director: never sends chat data until the user confirms generation.
function getDirectorScene(turnCount = 2, castNames = []) {
  const context = globalThis.SillyTavern?.getContext?.();
  const chat = context?.chat;
  if (!Array.isArray(chat) || !chat.length) throw new Error('Не удалось прочитать текущий чат SillyTavern.');
  const selected = chat.filter(m => !m.is_system && typeof m.mes === 'string' && m.mes.trim()).slice(-turnCount);
  if (!selected.length) throw new Error('В чате нет подходящих сообщений.');
  const names = castNames.map(n => String(n || '').trim()).filter(Boolean).slice(0,4);
  const cast = names.length ? `CAST (up to four distinct people; do not merge faces or swap identities):\n${names.map((n,i)=>`${i+1}. ${n}`).join('\n')}\n\n` : '';
  const excerpt = selected.map(m => {
    const speaker = String(m.name || (m.is_user ? context?.name1 || 'User' : context?.name2 || 'Character')).slice(0,70);
    const cleaned = m.mes.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,1600);
    return `${speaker}: ${cleaned}`;
  }).join('\n');
  return `DIRECTOR BRIEF — 8-second cinematic video.\n${cast}Use the attached scene image for framing, environment, wardrobe and visual identity. Preserve each visible person's face and hairstyle. The named cast may include the user, main character and NPCs; never assume only two characters. Do not add extra people. Keep motion subtle and physically plausible. Extract the most important visible actions from the excerpt. For speech, choose at most one brief verbatim line in its original language, attributed to its correct speaker; do not invent dialogue or translate names. Natural timing, room ambience, gentle camera movement. No subtitles or text overlays.\n\nROLEPLAY EXCERPT:\n${excerpt}`;
}

function ensureDialogStyle() {
  if (document.getElementById('iig-xai-video-style')) return;
  const style = document.createElement('style');
  style.id = 'iig-xai-video-style';
  style.textContent = `
  .iig-xv-director{border:1px solid #ffffff33;border-radius:12px;padding:10px;margin:12px 0}.iig-xv-director button{padding:7px 10px;margin:5px 5px 5px 0;border-radius:8px}.iig-xv-director small{display:block;opacity:.8}.iig-xv-backdrop{position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;padding:12px;border:0;background:rgba(0,0,0,.72);box-sizing:border-box;overflow:auto;color:inherit}.iig-xv-backdrop[open]{display:flex;align-items:flex-start;justify-content:center}.iig-xv-backdrop::backdrop{background:rgba(0,0,0,.72)}
  .iig-xv-card{width:min(620px,calc(100vw - 24px));max-height:none;overflow:visible;margin:8px auto 28px;background:var(--SmartThemeBlurTintColor,#181818);color:var(--SmartThemeBodyColor,#eee);border:1px solid var(--SmartThemeBorderColor,#666);border-radius:18px;padding:18px;box-shadow:0 18px 60px #0009}
  .iig-xv-card h3{margin:0 0 6px}.iig-xv-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.iig-xv-card label{display:grid;gap:5px;margin:10px 0}.iig-xv-prompt-wrap{padding:10px 12px;border:1px solid color-mix(in srgb,var(--SmartThemeBorderColor,#777) 70%,transparent);border-radius:13px;background:rgba(0,0,0,.16)}.iig-xv-prompt-title{font-weight:700}.iig-xv-prompt-help{font-size:.82em;opacity:.72}.iig-xv-cast-name{background:rgba(0,0,0,.35)!important;color:var(--SmartThemeBodyColor,#eee)!important;border:1px solid #ffffff55!important;border-radius:6px;padding:8px}.iig-xv-cast-name::placeholder{color:#aaa!important;opacity:1}.iig-xv-card textarea{min-height:90px;resize:vertical;background:rgba(0,0,0,.28)!important;color:var(--SmartThemeBodyColor,#eee)!important}.iig-xv-card select,.iig-xv-card textarea{width:100%}.iig-xv-cost{padding:10px 12px;border:1px solid #ffffff24;border-radius:12px;margin:10px 0}.iig-xv-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}.iig-xv-actions button{width:auto!important;min-width:0!important;padding:8px 12px!important;border:1px solid rgba(255,255,255,.25)!important;border-radius:10px!important;background:rgba(18,18,22,.92)!important;color:#fff!important}.iig-xv-actions .iig-xv-go{background:rgba(48,82,130,.95)!important}.iig-xv-status{min-height:1.4em;opacity:.85}.iig-xv-card .iig-xv-audio{display:flex;align-items:center;gap:8px}.iig-xv-card .iig-xv-audio input{width:auto}.iig-xv-portrait-slots{display:grid;grid-template-columns:1fr 1fr;gap:8px}.iig-xv-portrait-slots input{max-width:100%;font-size:.8em}.iig-xv-portrait-slots small{font-size:.75em}@media(max-width:520px){.iig-xv-portrait-slots{grid-template-columns:1fr}.iig-xv-grid{grid-template-columns:1fr}.iig-xv-card{padding:13px}.iig-xv-card textarea{min-height:84px}.iig-xv-actions{padding-top:4px}}
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
      <div style="opacity:.75">Исходная картинка останется на месте. Выбери Grok, Google Veo или Gemini Omni.</div>
      <label>Видеодвижок<select class="iig-xv-provider"><option value="grok">xAI · Grok Imagine Video</option><option value="veo">Google · Veo 3.1 (устаревшая Preview)</option><option value="omni">Google · Gemini Omni 1.1 Flash</option></select></label>
      <section class="iig-xv-director"><strong>🎬 ИИ-режиссёр · сценарий из ролевой</strong><small>Берёт последние сообщения только из открытого чата. Покажет сценарий для проверки; ничего не отправляет в Google до нажатия «Создать видео».</small><label>Контекст<select class="iig-xv-turns"><option value="2">Последние 2 сообщения</option><option value="4">Последние 4 сообщения</option><option value="6">Последние 6 сообщений</option></select></label><button type="button" class="iig-xv-from-chat">Взять сцену из ролевой</button><button type="button" class="iig-xv-restore">Вернуть описание картинки</button></section>
      <label class="iig-xv-prompt-wrap"><span class="iig-xv-prompt-title">✍️ Что должно произойти и что должно быть слышно</span><span class="iig-xv-prompt-help">Движение персонажей, камера, атмосфера, реплики и звуки — всё можно написать здесь.</span><textarea class="iig-xv-prompt" placeholder="Например: девушка медленно поднимает взгляд, волосы движутся от ветра, камера плавно приближается. Слышно тихий дождь…"></textarea></label>
      <section class="iig-xv-director iig-xv-cast"><strong>👥 Персонажи и NPC · до 4 человек</strong><small>Имена необязательны. Без портретов видео тоже создаётся. Если добавляешь портреты, укажи соответствующие имена по порядку.</small><div class="iig-xv-grid"><label>Персонаж 1<input class="iig-xv-cast-name" placeholder="Например, Ханаби"></label><label>Персонаж 2<input class="iig-xv-cast-name" placeholder="Например, Бо"></label><label>NPC 3<input class="iig-xv-cast-name" placeholder="Имя NPC"></label><label>NPC 4<input class="iig-xv-cast-name" placeholder="Имя NPC"></label></div></section>
      <section class="iig-xv-references" style="display:none"><strong>🖼️ Портреты — по одному на персонажа</strong><small>Введи имя и выбери портрет в соответствующей строке. Портрет запоминается в этом браузере и автоматически подставляется при следующей генерации.</small><div class="iig-xv-portrait-slots"></div><button type="button" class="iig-xv-clear-portraits">Очистить сохранённые портреты этих персонажей</button><small class="iig-xv-portrait-status"></small></section>
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
    const provider=q('.iig-xv-provider'), promptBox=q('.iig-xv-prompt'), model=q('.iig-xv-model'), duration=q('.iig-xv-duration'), resolution=q('.iig-xv-resolution'), audio=q('.iig-xv-audio-input'), cost=q('.iig-xv-cost'), refLabel=q('.iig-xv-references');
    let remembered={}; try { remembered=JSON.parse(localStorage.getItem('iig_video_options')||'{}'); } catch {}
    const savedCast = (()=>{try{return JSON.parse(localStorage.getItem('iig_video_cast')||'[]')}catch{return []}})();
    const castInputs=[...wrap.querySelectorAll('.iig-xv-cast-name')]; castInputs.forEach((el,i)=>el.value=String(savedCast[i]||''));
    const getCast=()=>castInputs.map(el=>el.value.trim());
    const slotArea=q('.iig-xv-portrait-slots');
    const portraitInputs=[];
    for(let i=0;i<4;i++){
      const label=document.createElement('label');label.textContent=`Портрет ${i+1}`;
      const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';
      const note=document.createElement('small');note.textContent='Не выбран';
      input.addEventListener('change',()=>{note.textContent=input.files?.[0]?.name||'Сохранённый портрет (если есть)'});
      label.append(input,note);slotArea.appendChild(label);portraitInputs.push({input,note});
    }
    const refreshPortraitNotes=async()=>{
      for(let i=0;i<4;i++){
        const name=normalizePortraitName(castInputs[i].value);
        if(!name || portraitInputs[i].input.files?.length)continue;
        try{const saved=await portraitStore('get',name);portraitInputs[i].note.textContent=saved?'✓ Портрет сохранён — будет использован':'Портрет не выбран (необязательно)'}catch{portraitInputs[i].note.textContent='Локальное хранилище недоступно'}
      }
    };
    castInputs.forEach(el=>el.addEventListener('change',refreshPortraitNotes));
    q('.iig-xv-clear-portraits').onclick=async()=>{
      for(const name of getCast().map(normalizePortraitName).filter(Boolean))await portraitStore('delete',name);
      q('.iig-xv-portrait-status').textContent='Сохранённые портреты указанных персонажей удалены.';
      refreshPortraitNotes();
    };
    refreshPortraitNotes();
    const originalPrompt = String(initialPrompt || localStorage.getItem('iig_video_prompt') || '');
    promptBox.value = originalPrompt;
    q('.iig-xv-from-chat').onclick = () => { try { promptBox.value = getDirectorScene(Number(q('.iig-xv-turns').value),getCast()); q('.iig-xv-status').textContent = 'Сценарий подготовлен. Проверь реплики и действия перед платной генерацией.'; } catch (e) { q('.iig-xv-status').textContent = e.message; } };
    q('.iig-xv-restore').onclick = () => { promptBox.value = originalPrompt; q('.iig-xv-status').textContent = 'Описание картинки восстановлено.'; };
    if (['veo', 'grok', 'omni'].includes(remembered.provider)) provider.value=remembered.provider;
    const fill=(el, items, selected)=>{ el.innerHTML=items.map(([v,l])=>`<option value="${v}">${l}</option>`).join(''); if([...el.options].some(o=>o.value===String(selected))) el.value=String(selected); };
    const rebuild=()=>{
      if(provider.value==='omni'){
        fill(model,[['gemini-omni-1.1-flash','Gemini Omni 1.1 Flash']],'gemini-omni-1.1-flash');
        fill(duration,[[8,'8 секунд'],[0,'Автоматически · 3–10 сек'],[5,'5 секунд'],[10,'10 секунд']],remembered.provider==='omni'?remembered.duration:8);
        fill(resolution,[['360p','360p'],['720p','720p · HD'],['1080p','1080p · Full HD'],['4k','4K']],remembered.provider==='omni'?remembered.resolution:'360p');
        audio.checked=true; audio.disabled=true;
        refLabel.style.display='grid';
      } else if(provider.value==='veo'){
        refLabel.style.display='none';
        fill(model,Object.entries(VEO_MODELS).map(([v,x])=>[v,x.label]), remembered.provider==='veo'?remembered.model:'veo-3.1-lite-generate-preview');
        fill(duration,[[4,'4 сек'],[6,'6 сек'],[8,'8 сек']],remembered.provider==='veo'?remembered.duration:8);
        fill(resolution,[['720p','720p · экономно'],['1080p','1080p · 8 сек'],['4k','4K · 8 сек']],remembered.provider==='veo'?remembered.resolution:'360p');
        audio.checked=true; audio.disabled=true; audio.closest('label').title='Veo 3.1 генерирует аудио вместе с видео';
      } else {
        refLabel.style.display='none';
        fill(model,Object.entries(VIDEO_MODELS).map(([v,x])=>[v,x.label]),remembered.provider==='grok'?remembered.model:'grok-imagine-video');
        fill(duration,[[3,'3 сек'],[5,'5 сек'],[8,'8 сек'],[10,'10 сек'],[15,'15 сек']],remembered.provider==='grok'?remembered.duration:5);
        fill(resolution,[['480p','480p · дёшево'],['720p','720p · HD'],['1080p','1080p · Full HD']],remembered.provider==='grok'?remembered.resolution:'720p');
        audio.disabled=false; audio.checked=remembered.provider==='grok' && typeof remembered.generateAudio==='boolean'?remembered.generateAudio:true;
      }
      update();
    };
    const update=()=>{
      if(provider.value==='omni'){
        cost.textContent='Gemini Omni: стоимость зависит от разрешения и длительности. Проверяй тариф Google перед запуском.';
      } else if(provider.value==='veo'){
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
    q('.iig-xv-go').onclick=async()=>{
      try {
      const castNames=getCast();
      const referenceImages=[];
      if(provider.value==='omni'){
        for(let i=0;i<4;i++){
          const name=normalizePortraitName(castNames[i]);
          const file=portraitInputs[i].input.files?.[0];
          if(file && (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>12*1024*1024)){
            q('.iig-xv-status').textContent=`Портрет ${i+1}: только JPEG/PNG/WebP до 12 МБ.`;return;
          }
          let data=null;
          if(file){data=await portraitFileData(file);if(name)await portraitStore('put',name,data)}
          else if(name)data=await portraitStore('get',name);
          if(data)referenceImages.push({name:castNames[i]||`Character ${i+1}`,data});
        }
      }
      const identityGuide=referenceImages.map((ref,i)=>`Reference portrait ${i+1} depicts ${ref.name}. Preserve the same face, hairstyle and distinctive traits; do not swap identities.`).join('\n');
      const finalPrompt=promptBox.value.trim() + (provider.value==='omni' && referenceImages.length && identityGuide ? '\n\nCHARACTER REFERENCE MAP:\n'+identityGuide : '');
      const value={provider:provider.value,prompt:finalPrompt,model:model.value,duration:Number(duration.value),resolution:resolution.value,generateAudio:audio.checked,aspectRatio:'9:16',referenceImages:referenceImages.map(r=>r.data)};
      localStorage.setItem('iig_video_cast',JSON.stringify(castNames)); localStorage.setItem('iig_video_prompt',promptBox.value.trim()); localStorage.setItem('iig_video_options',JSON.stringify({...value, prompt:'', referenceImages: []})); finish(value);
      } catch(error) {
        console.error('[Director Studio] Ошибка подготовки видео:',error);
        q('.iig-xv-status').textContent='Не удалось подготовить видео: '+(error?.message||String(error));
      }
    };
  });
}
export async function animateImageInteractive(imageSrc, onStatus = () => {}, initialPrompt = '') {
  const options = await askXaiVideoOptions(initialPrompt);
  if (!options) return null;
  return options.provider === 'omni' ? generateOmniVideoFromImage(imageSrc, options, onStatus) : options.provider === 'veo' ? generateVeoVideoFromImage(imageSrc, options, onStatus) : generateXaiVideoFromImage(imageSrc, options, onStatus);
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
    generateOmniVideoFromImage,
    estimateVeoVideoCost,
  };
}
