# Visual DNA — first implementation

Only `src/references.js`, `src/ui.js`, and `src/settings.js` changed. The Character Library, References, image providers and generation pipeline are untouched.

Open a saved chat, then Silly Images Plus → Diagnostics → ✿ Characters and NPC tags for this chat. Each line: `Name | fixed appearance NovelAI tags | outfit NovelAI tags`. Tags save on input, under the current character/chat ID. No separate LLM request is made.

Insert `{{iig-visual-context}}` in the prompt used by the language model to write image prompts. The macro adds Visual DNA after the existing card/persona context, and tells the image director to use only depicted characters and preserve manual traits.

Limitations: manual entries, not automatic NPC extraction; scene participation is resolved by the language model; the extension does not itself enforce the model's final prompt. Saved chat ID is required to avoid cross-chat leakage. The preview editor's full-text override is legacy and can contain a frozen copy of DNA; reset the override when changing entries if preview appears stale. Existing overrides are preserved.
