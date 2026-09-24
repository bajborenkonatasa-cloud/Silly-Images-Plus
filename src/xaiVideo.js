import { getSettings, iigLog } from './settings.js';

const PRICES = {
  'grok-imagine-video': { '480p': 0.05, '720p': 0.07 },
  'grok-imagine-video-1.5': { '480p': 0.08, '720p': 0.14, '1080p': 0.25 },
};

function getXaiKey() {
  const s = getSettings();
  return String(s.apiKeys?.xai || (s.apiType === 'xai' ? s.apiKey : '') || '').trim();
}

async function imageToDataUrl(img) {
  if (img.src.startsWith('data:')) return img.src;
  const r = await fetch(img.src);
  if (!r.ok) throw new Error(`Не удалось прочитать исходную картинку: HTTP ${r.status}`);
  const blob = await r.blob();
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error || new Error('FileReader failed'));
    fr.readAsDataURL(blob);
  });
}

function estimate(model, resolution, duration) {
  const p = PRICES[model]?.[resolution];
  return p ? (p * duration + 0.01).toFixed(2) : '?';
}

function makeModal() {
  const wrap = document.createElement('div');
  wrap.className = 'iig-video-modal-backdrop';
  wrap.innerHTML = `
    <div class="iig-video-modal" role="dialog" aria-modal="true">
      <div class="iig-video-title">🎬 Оживить изображение через Grok</div>
      <label>Что должно происходить?</label>
      <textarea class="iig-video-prompt" rows="5" placeholder="Например: обе девушки мягко улыбаются, смотрят друг на друга, волосы слегка двигаются от ветра, камера медленно приближается..."></textarea>
      <div class="iig-video-grid">
        <label>Модель<select class="iig-video-model"><option value="grok-imagine-video">Grok Video · дешевле</option><option value="grok-imagine-video-1.5" selected>Grok Video 1.5 · лучше</option></select></label>
        <label>Длительность<select class="iig-video-duration"><option value="3">3 сек</option><option value="5" selected>5 сек</option><option value="8">8 сек</option><option value="10">10 сек</option><option value="15">15 сек</option></select></label>
        <label>Качество<select class="iig-video-resolution"><option value="480p">480p · эконом</option><option value="720p" selected>720p · HD</option><option value="1080p">1080p · Full HD</option></select></label>
        <label class="iig-video-audio-label"><input class="iig-video-audio" type="checkbox" checked> 🔊 Генерировать звук</label>
      </div>
      <div class="iig-video-cost"></div>
      <div class="iig-video-note">Исходная картинка останется на месте. После просмотра можно одним нажатием вернуться к ней.</div>
      <div class="iig-video-buttons"><button type="button" class="menu_button iig-video-cancel">Отмена</button><button type="button" class="menu_button iig-video-go">🎬 Создать видео</button></div>
    </div>`;
  return wrap;
}

export async function askAndAnimateImage(img) {
  const key = getXaiKey();
  if (!key) {
    toastr.error('Сначала сохрани xAI API-ключ в профиле xAI Imagine.', 'Grok Video');
    return;
  }
  const modal = makeModal();
  document.body.appendChild(modal);
  const model = modal.querySelector('.iig-video-model');
  const duration = modal.querySelector('.iig-video-duration');
  const resolution = modal.querySelector('.iig-video-resolution');
  const audio = modal.querySelector('.iig-video-audio');
  const prompt = modal.querySelector('.iig-video-prompt');
  const cost = modal.querySelector('.iig-video-cost');
  const go = modal.querySelector('.iig-video-go');
  const cancel = modal.querySelector('.iig-video-cancel');
  const close = () => modal.remove();
  const refresh = () => {
    if (model.value === 'grok-imagine-video' && resolution.value === '1080p') resolution.value = '720p';
    const isClassic = model.value === 'grok-imagine-video';
    resolution.querySelector('option[value="1080p"]').disabled = isClassic;
    cost.textContent = `Ориентировочно: ≈ $${estimate(model.value, resolution.value, Number(duration.value))} за этот ролик (+ возможные мелкие входные расходы).`;
  };
  model.addEventListener('change', refresh); duration.addEventListener('change', refresh); resolution.addEventListener('change', refresh); refresh();
  cancel.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  go.addEventListener('click', async () => {
    const text = prompt.value.trim();
    if (!text) { toastr.warning('Напиши, как именно оживить картинку.', 'Grok Video'); return; }
    go.disabled = true; cancel.disabled = true; go.textContent = '⏳ Запускаю…';
    try {
      const dataUrl = await imageToDataUrl(img);
      const videoUrl = await generateXaiVideo({ key, imageDataUrl: dataUrl, prompt: text, model: model.value, duration: Number(duration.value), resolution: resolution.value, generateAudio: audio.checked, onStatus: s => { go.textContent = s; } });
      close();
      showVideoOverImage(img, videoUrl);
      toastr.success('Видео готово 🎬', 'Grok Video');
    } catch (e) {
      iigLog('ERROR', 'xAI video failed:', e);
      toastr.error(String(e?.message || e), 'Grok Video');
      go.disabled = false; cancel.disabled = false; go.textContent = '🎬 Создать видео';
    }
  });
  setTimeout(() => prompt.focus(), 50);
}

async function generateXaiVideo({ key, imageDataUrl, prompt, model, duration, resolution, generateAudio, onStatus }) {
  const body = { model, prompt, image: { url: imageDataUrl }, duration, resolution, generate_audio: !!generateAudio };
  const start = await fetch('https://api.x.ai/v1/videos/generations', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const startText = await start.text();
  let startData = {}; try { startData = JSON.parse(startText); } catch {}
  if (!start.ok) throw new Error(`xAI ${start.status}: ${startData?.error?.message || startData?.message || startText.slice(0, 500)}`);
  const id = startData.request_id;
  if (!id) throw new Error('xAI не вернул request_id.');
  iigLog('INFO', `xAI video started: model=${model} duration=${duration}s resolution=${resolution} request=${id}`);
  const deadline = Date.now() + 12 * 60 * 1000;
  let tick = 0;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    tick += 5; onStatus?.(`⏳ Grok работает… ${tick}с`);
    const r = await fetch(`https://api.x.ai/v1/videos/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}` } });
    const txt = await r.text(); let data = {}; try { data = JSON.parse(txt); } catch {}
    if (!r.ok) throw new Error(`xAI polling ${r.status}: ${data?.error?.message || data?.message || txt.slice(0, 500)}`);
    if (data.status === 'done') {
      const url = data?.video?.url || data?.url;
      if (!url) throw new Error('xAI сообщил done, но URL видео отсутствует.');
      return url;
    }
    if (data.status === 'failed' || data.status === 'expired') throw new Error(`Генерация ${data.status}: ${data?.error?.message || data?.message || 'без подробностей'}`);
  }
  throw new Error('Видео не успело сгенерироваться за 12 минут.');
}

function showVideoOverImage(img, url) {
  const host = img.closest('.iig-img-host') || img.parentElement;
  if (!host) return;
  host.querySelector(':scope > .iig-generated-video')?.remove();
  host.querySelector(':scope > .iig-video-view-actions')?.remove();
  const video = document.createElement('video');
  video.className = 'iig-generated-video'; video.src = url; video.controls = true; video.autoplay = true; video.loop = true; video.playsInline = true;
  img.style.display = 'none'; host.appendChild(video);
  const bar = document.createElement('div'); bar.className = 'iig-video-view-actions';
  bar.innerHTML = `<button type="button" class="menu_button iig-video-back">🖼️ Вернуться к картинке</button><a class="menu_button iig-video-open" href="${url}" target="_blank" rel="noopener">🎬 Открыть видео</a>`;
  host.appendChild(bar);
  bar.querySelector('.iig-video-back').addEventListener('click', e => { e.preventDefault(); video.pause(); video.remove(); bar.remove(); img.style.display = ''; });
}
