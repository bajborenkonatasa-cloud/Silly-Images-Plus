/**
 * Inline corner buttons on generated chat images:
 *   - successful image: Download + Regenerate
 *   - error placeholder: Retry
 *
 * Each generated <img> is wrapped in <span class="iig-img-host"> with the
 * actions div as a sibling. Wrapping is runtime-only — message storage HTML
 * is untouched. MutationObserver re-attaches after ST re-renders messages.
 */

import { t } from './i18n.js';
import { iigLog, getSettings } from './settings.js';
import { regenerateSingleTag } from './pipeline.js';
import { animateImageInteractive } from './xaiVideo.js';
import { encodeLocalMediaPath } from './utils.js';

const IMG_SELECTOR = 'img[data-iig-instruction]';

export function applyImageActionsStyle(settings = getSettings()) {
    const enabled = settings.imageActionsEnabled !== false;
    const rawOpacity = Number(settings.imageActionsOpacity);
    const opacity = Number.isFinite(rawOpacity)
        ? Math.max(0, Math.min(100, rawOpacity)) / 100
        : 0.8;
    document.documentElement.style.setProperty('--iig-actions-opacity', String(opacity));
    document.body.classList.toggle('iig-actions-hidden', !enabled);
}

export function initImageActions() {
    const chat = document.getElementById('chat');
    if (!chat) return;

    applyImageActionsStyle();
    scanAndAttach(chat);

    const dirtyRoots = new Set();
    let scanFrame = null;
    const scheduleScan = (root) => {
        dirtyRoots.add(root);
        if (scanFrame !== null) return;
        scanFrame = requestAnimationFrame(() => {
            scanFrame = null;
            const roots = [...dirtyRoots];
            dirtyRoots.clear();
            for (const dirtyRoot of roots) scanAndAttach(dirtyRoot);
        });
    };

    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.type === 'childList') {
                for (const n of m.addedNodes) {
                    if (!(n instanceof Element)) continue;
                    if (n.matches?.(IMG_SELECTOR) || n.querySelector?.(IMG_SELECTOR)) {
                        scheduleScan(n);
                    }
                }
            }
            if (m.type === 'attributes' && m.target instanceof HTMLImageElement && m.target.matches(IMG_SELECTOR)) {
                scheduleScan(m.target);
            }
        }
    });
    observer.observe(chat, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'class'] });
}

function scanAndAttach(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    if (root instanceof HTMLImageElement && root.matches?.(IMG_SELECTOR)) {
        attachActions(root);
        return;
    }
    const imgs = root.querySelectorAll?.(IMG_SELECTOR);
    if (!imgs) return;
    for (const img of imgs) {
        attachActions(img);
    }
}

function attachActions(img) {
    if (!img.src || img.src.endsWith('[IMG:GEN]')) return;

    const isError = img.classList.contains('iig-error-image');
    let host = img.parentElement;

    if (host?.classList?.contains('iig-img-host')) {
        const existing = host.querySelector(':scope > .iig-img-actions');
        if (existing && existing.dataset.iigError === (isError ? '1' : '0')) { restoreSavedVideos(img); return; }
        existing?.remove();
        host.appendChild(buildActions(img, isError));
        restoreSavedVideos(img);
        return;
    }

    host = document.createElement('span');
    host.className = 'iig-img-host';
    img.replaceWith(host);
    host.appendChild(img);
    host.appendChild(buildActions(img, isError));
    restoreSavedVideos(img);
}

function buildActions(img, isError) {
    const actions = document.createElement('div');
    actions.className = 'iig-img-actions';
    actions.dataset.iigError = isError ? '1' : '0';
    actions.innerHTML = isError
        ? `<button class="iig-img-action iig-img-retry" type="button" title="${t`Retry`}" aria-label="${t`Retry`}"><i class="fa-solid fa-rotate-right"></i></button>`
        : `<button class="iig-img-action iig-img-download" type="button" title="${t`Download`}" aria-label="${t`Download`}"><i class="fa-solid fa-download"></i></button>`
          + `<button class="iig-img-action iig-img-regen" type="button" title="${t`Regenerate this image`}" aria-label="${t`Regenerate this image`}"><i class="fa-solid fa-rotate-right"></i></button>`
          + `<button class="iig-img-action iig-img-animate" type="button" title="Оживить через Grok" aria-label="Оживить через Grok">🎬</button>`;

    const stopAll = (e) => { e.stopPropagation(); e.preventDefault(); };
    actions.addEventListener('pointerdown', (e) => e.stopPropagation());
    actions.addEventListener('click', (e) => e.stopPropagation());

    actions.querySelector('.iig-img-download')?.addEventListener('click', async (e) => {
        stopAll(e);
        await downloadImage(img);
    });
    actions.querySelector('.iig-img-regen')?.addEventListener('click', async (e) => {
        stopAll(e);
        await regenerateOne(img);
    });
    actions.querySelector('.iig-img-retry')?.addEventListener('click', async (e) => {
        stopAll(e);
        await regenerateOne(img);
    });
    actions.querySelector('.iig-img-animate')?.addEventListener('click', async (e) => {
        stopAll(e);
        const button = e.currentTarget;
        try {
            button.disabled = true;
            const result = await animateImageInteractive(img.src, (status) => { button.title = status; });
            if (!result) return;
            // Keep the generated video visible even if permanent storage fails.
            showVideoPreview(img, result.url);
            try {
                const savedUrl = await persistGeneratedVideo(result.url, img);
                await attachVideoToMessage(img, savedUrl);
                if (!savedUrl.startsWith('iig-idb:')) showVideoPreview(img, savedUrl);
                toastr.success('Видео сохранено. Оно восстановится при повторном входе.', 'Director Studio');
            } catch (saveError) {
                iigLog('ERROR', 'Video persistence failed:', saveError);
                toastr.warning('Видео готово, но сохранить его не удалось. Скачай MP4 сейчас: ' + saveError.message, 'Director Studio', { timeOut: 12000 });
            }
        } catch (error) {
            iigLog('ERROR', 'xAI video failed:', error);
            toastr.error(error?.message || 'Не удалось создать видео', 'Grok Video');
        } finally {
            button.disabled = false;
            button.title = 'Оживить через Grok';
        }
    });

    return actions;
}

async function downloadImage(img) {
    const src = img.src;
    let url = src;
    let cleanup = null;
    if (!src.startsWith('data:')) {
        try {
            const resp = await fetch(src);
            const blob = await resp.blob();
            url = URL.createObjectURL(blob);
            cleanup = () => URL.revokeObjectURL(url);
        } catch (err) {
            iigLog('ERROR', 'Image download failed:', err);
            toastr.error(t`Failed to download image`, t`Image Generation`);
            return;
        }
    }
    const ext = guessExtension(src);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iig_${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (cleanup) setTimeout(cleanup, 100);
}

function guessExtension(src) {
    if (src.startsWith('data:')) {
        const m = src.match(/^data:image\/([a-z0-9+]+)/i);
        if (m) return m[1].replace('jpeg', 'jpg');
    }
    const m = src.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    if (m) return m[1].toLowerCase();
    return 'png';
}

async function regenerateOne(img) {
    const messageEl = img.closest('.mes');
    if (!messageEl) {
        toastr.error(t`Could not locate message`, t`Image Generation`);
        return;
    }
    const messageId = parseInt(messageEl.getAttribute('mesid') || '', 10);
    if (Number.isNaN(messageId)) return;

    // tagIndex must match regenerateSingleTag's selector (img + video) so we
    // don't regenerate the wrong tag when a Naistera video precedes the image.
    const allMedia = Array.from(messageEl.querySelectorAll('img[data-iig-instruction], video[data-iig-instruction]'));
    const tagIndex = allMedia.indexOf(img);
    if (tagIndex < 0) return;

    await regenerateSingleTag(messageId, tagIndex);
}


// IndexedDB is a durable local fallback when the server's upload route is unavailable.
// On Android/Termux it survives page reloads in the SAME browser profile/origin.
const DIRECTOR_DB = 'iig-director-v4';
function openDirectorDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DIRECTOR_DB, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function videoDb(action, key, value) {
    const db = await openDirectorDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('videos', action === 'get' ? 'readonly' : 'readwrite');
            const req = action === 'get' ? tx.objectStore('videos').get(key) : tx.objectStore('videos').put(value, key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            tx.onerror = () => reject(tx.error);
        });
    } finally { db.close(); }
}
function directorMediaKey(img) {
    const context = SillyTavern.getContext();
    const msg = img.closest('.mes');
    const messageId = Number(msg?.getAttribute('mesid'));
    const chatId = context.getCurrentChatId?.() || context.chatId || context.chatMetadata?.main_chat || 'default';
    const images = [...(msg?.querySelectorAll('img[data-iig-instruction]') || [])];
    const imageIndex = images.indexOf(img);
    if (!Number.isInteger(messageId) || messageId < 0 || imageIndex < 0) throw new Error('Не удалось определить картинку и сообщение.');
    return `${chatId}::${messageId}::${imageIndex}`;
}
async function persistGeneratedVideo(url, img) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Не удалось прочитать MP4 (HTTP ${response.status})`);
    const blob = await response.blob();
    if (!blob.size) throw new Error('Пустой видеофайл.');
    // Save locally FIRST, before attempting server upload. No silent loss on server error.
    const key = directorMediaKey(img);
    await videoDb('put', key, blob);
    try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const chunks = [];
        for (let i = 0; i < bytes.length; i += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
        const context = SillyTavern.getContext();
        const filename = `iig_director_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`;
        const upload = await fetch('/api/files/upload', {
            method: 'POST', headers: context.getRequestHeaders(),
            body: JSON.stringify({ name: filename, data: btoa(chunks.join('')) }),
        });
        if (!upload.ok) throw new Error(`HTTP ${upload.status}`);
        const result = await upload.json();
        if (!result?.path) throw new Error('Путь не возвращён сервером');
        return encodeLocalMediaPath(result.path);
    } catch (error) {
        iigLog('WARN', 'Server MP4 upload failed, using local IndexedDB backup:', error);
        return `iig-idb:${key}`;
    }
}
async function attachVideoToMessage(img, url) {
    const el = img.closest('.mes');
    const id = Number(el?.getAttribute('mesid'));
    const context = SillyTavern.getContext();
    if (!Number.isInteger(id) || !context.chat?.[id]) throw new Error('Сообщение для сохранения не найдено.');
    const msg = context.chat[id];
    msg.extra ??= {};
    msg.extra.iigDirectorVideos ??= [];
    if (!msg.extra.iigDirectorVideos.includes(url)) msg.extra.iigDirectorVideos.push(url);
    await context.saveChat();
}
const restoringVideos = new WeakSet();
async function restoreSavedVideos(img) {
    const host = img.closest('.iig-img-host');
    if (!host || host.querySelector(':scope > .iig-xai-video-preview') || restoringVideos.has(img)) return;
    restoringVideos.add(img);
    try {
        const id = Number(img.closest('.mes')?.getAttribute('mesid'));
        const videos = SillyTavern.getContext()?.chat?.[id]?.extra?.iigDirectorVideos;
        const saved = Array.isArray(videos) ? videos[videos.length - 1] : null;
        if (saved && !saved.startsWith('iig-idb:')) { showVideoPreview(img, saved); return; }
        const key = saved?.startsWith('iig-idb:') ? saved.slice('iig-idb:'.length) : directorMediaKey(img);
        const blob = await videoDb('get', key);
        if (blob instanceof Blob && img.isConnected && !host.querySelector(':scope > .iig-xai-video-preview')) {
            showVideoPreview(img, URL.createObjectURL(blob));
        }
    } catch (error) { iigLog('WARN', 'Video restore skipped:', error); }
    finally { restoringVideos.delete(img); }
}

function showVideoPreview(img, url) {
    const host = img.closest('.iig-img-host') || img.parentElement;
    if (!host) return;
    host.querySelector(':scope > .iig-xai-video-preview')?.remove();
    const box = document.createElement('div');
    box.className = 'iig-xai-video-preview';
    box.style.cssText = 'margin-top:8px;display:grid;gap:6px';
    const video = document.createElement('video');
    video.src = url; video.controls = true; video.playsInline = true; video.preload = 'metadata';
    video.style.cssText = 'width:100%;max-height:75vh;border-radius:10px';
    const download = document.createElement('a');
    download.href = url; download.download = 'silly-director-video.mp4'; download.textContent = '⬇️ Скачать MP4';
    download.style.cssText = 'display:inline-block;padding:6px';
    const back = document.createElement('button');
    back.type = 'button'; back.textContent = '🖼️ Скрыть видео';
    back.onclick = (e) => { e.preventDefault(); e.stopPropagation(); box.remove(); };
    box.append(video, download, back);
    host.appendChild(box);
    video.play().catch(() => {});
}
