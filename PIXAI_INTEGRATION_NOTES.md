# PixAI official API · experimental integration

Files changed: `src/providers.js`, `src/settings.js`, `src/ui.js`, `manifest.json`.

Select API type **PixAI (official)**. Paste PixAI API key into the normal API key field. The key is isolated per provider in the extension settings. PixAI requests always go to `https://api.pixai.art` (fixed endpoint, not a custom URL).

Models: Tsubaki.2, Haruka v2, Hoshino v2. Aspect ratio, size, negative tags, Tsubaki quality mode available. One image per task. Prompt helper disabled to preserve hand-authored Visual DNA tags. Native image-reference upload and PixAI LoRA are not yet implemented. Polls every 2 seconds up to 3 minutes.

Not tested with a real PixAI key. If the Android WebView blocks cross-origin API requests, a trusted server-side proxy may be required. Never send your key to a third-party proxy.

Existing NovelAI and other providers left intact. Install/update all four changed files; keep the rest unchanged.
