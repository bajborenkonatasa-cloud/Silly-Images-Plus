# Visual DNA + style grouping (v2)

## Visual DNA

The chat-scoped Visual DNA editor now has separate Name, Appearance and Outfit fields for each person/NPC. Add and remove entries with buttons. Autosave is preserved and the existing `{{iig-visual-context}}` macro is unchanged. No changes to image references or character library.

## Styles / negatives

Styles and negative prompts can be filtered by category: NovelAI, Nano Banana, Other (GPT/Grok), Unsorted, or All. Existing presets are not changed or migrated: they begin in Unsorted. To assign one, select it, then choose its category in the editor. This is **organization only**; the active style is still controlled by the original activation mechanism, and category does not enforce provider compatibility. Group labels are saved in browser localStorage, not synced between devices or included in the extension settings backup. The actual presets continue to live in the original settings.

## Checks

`node --check src/ui.js` passes. The existing 14-test suite with `--experimental-vm-modules` passes 13/14 both on the original user-supplied v1 ZIP and this v2; the pre-existing failure is `NovelAI includes matching descriptions without requesting reference images` (expected `Lenore: silver ring`). No runtime browser test has been performed.
