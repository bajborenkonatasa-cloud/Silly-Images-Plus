const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const library = fs.readFileSync(path.join(root, 'src/libraryImages.js'), 'utf8');
const character = fs.readFileSync(path.join(root, 'src/characterLibraryUi.js'), 'utf8');

test('gallery module has lazy loading and disconnect lifecycle', () => {
  assert.match(library, /IntersectionObserver/);
  assert.match(library, /observer\.disconnect\(\)/);
  assert.match(library, /image\.loading = 'lazy'/);
  assert.match(library, /image\.decoding = 'async'/);
  assert.match(character, /import \{ observeLibraryImages \} from '\.\/libraryImages\.js'/);
});
test('image is loaded only after entering viewport', async () => {
  const observers = [];
  global.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; this.items = []; observers.push(this); }
    observe(item) { this.items.push(item); }
    disconnect() { this.items = []; }
    unobserve(item) { this.items = this.items.filter(i => i !== item); }
  };
  const image = { isConnected: true, attrs: { 'data-iig-library-src': '/test.png' },
    getAttribute(k) { return this.attrs[k] || null; }, removeAttribute(k) { delete this.attrs[k]; } };
  global.document = { querySelectorAll: () => [image] };
  const mod = await import('data:text/javascript;base64,' + Buffer.from(library).toString('base64'));
  mod.observeLibraryImages();
  assert.equal(image.src, undefined);
  observers[0].cb([{ isIntersecting: true, target: image }]);
  assert.equal(image.src, '/test.png');
  assert.equal(image.attrs['data-iig-library-src'], undefined);
  mod.disconnectLibraryImages();
  delete global.document;
  delete global.IntersectionObserver;
});
test('refresh requests are abortable and concurrency-bounded', () => {
  assert.match(character, /generationsRefreshController\?\.abort\(\)/);
  assert.match(character, /signal: controller\.signal/);
  assert.match(character, /Math\.min\(4, contextChatCandidates\.length\)/);
});
test('Plus-specific modules and settings remain present', () => {
  for (const name of ['xaiVideo.js', 'references.js', 'providers.js', 'ui.js'])
    assert.ok(fs.existsSync(path.join(root, 'src', name)), name);
  const ui = fs.readFileSync(path.join(root, 'src/ui.js'), 'utf8');
  assert.match(ui, /pixai/i);
  assert.match(ui, /visual.dna|visualDNA/i);
  const settings = fs.readFileSync(path.join(root, 'src/settings.js'), 'utf8');
  assert.match(settings, /stylePresets|styleGroups|style.groups/i);
});
