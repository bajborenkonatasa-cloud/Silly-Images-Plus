/** Lightweight gallery thumbnail scheduling; no network fetch until near viewport. */
let observer = null;
const ROOT_MARGIN = '320px 0px';
export function loadLibraryImage(image) {
    const src = String(image?.getAttribute('data-iig-library-src') || '').trim();
    if (!src || !image?.isConnected) return;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = src;
    image.removeAttribute('data-iig-library-src');
}
export function observeLibraryImages() {
    const images = Array.from(document.querySelectorAll('.iig-character-library img[data-iig-library-src]'));
    if (typeof IntersectionObserver !== 'function') {
        images.forEach(loadLibraryImage);
        return;
    }
    if (!observer) {
        observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                loadLibraryImage(entry.target);
                observer?.unobserve(entry.target);
            }
        }, { rootMargin: ROOT_MARGIN });
    }
    observer.disconnect();
    for (const image of images) observer.observe(image);
}
export function disconnectLibraryImages() {
    observer?.disconnect();
}
