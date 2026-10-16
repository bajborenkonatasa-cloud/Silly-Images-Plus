# Visual DNA v3 — source priority

This update changes only `src/references.js` and does not modify the character library, reference library, style presets or saved chat passports.

- Exact matching chat-local Visual DNA passports now suppress generic card/library appearance extraction for the corresponding main character or persona. This avoids injecting extraneous biography alongside manually verified tags.
- The latest RP remains authoritative for actual clothing, changed visual traits, pose and environment.
- Unmatched characters still use the existing visual-source fallback. NPC passports remain chat-scoped and are included only as textual guidance for the image director.
- The macro does not directly alter the final NovelAI payload, choose characters automatically or create extra API requests. A saved Visual Context manual override still takes precedence and should be cleared if it contains outdated information.
- Keep `{{iig-visual-context}}` in the image-director `extraContext` only once.

## Existing prompt warning
The supplied image_lite prompt requests ONE image in its main rules and TWO images in the final extraContext line. These are contradictory. To use a single image, remove the final `Generate 2 single-image prompt...` sentence from extraContext. This update intentionally does not modify the user's prompt JSON.
