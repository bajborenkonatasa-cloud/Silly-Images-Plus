# PixAI Studio beta · 19.10.2026

PixAI (official) → Tsubaki.2 → 9:16 → 1k → Standard. Import the separately supplied Scene Blocks director JSON. Keep NovelAI presets untouched.

- Style presets are added to prompt text (not an undocumented API style object).
- LoRA: up to 5 enabled entries; enter a PixAI version URL or its last numeric ID, weight ~0.7 and optional trigger tags. Use only compatible LoRAs for the selected model.
- Tsubaki.2 is DiT: mode controls quality; manual sampling is intentionally omitted.
- Haruka v2 / Hoshino v2 are SDXL: optional sampler and steps; leave Default to use server defaults.
- Advanced API Style JSON is an optional raw object; public docs do not specify its full schema. Leave empty for normal use.
- One image per request; prompt helper disabled. No actual paid API call was made; browser CORS and model-specific compatibility still need an authenticated test.
- Do not send API keys in chat or use unknown third-party proxies.

Official reference: https://platform.pixai.art/en/docs/api-v2/image/createImage
