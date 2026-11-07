# Attribution and license notes

This is a modified Silly Images Plus extension based on the user-supplied Plus archive.

Upstream project: https://github.com/0xl0cal/sillyimages
Upstream V3 archive supplied by the user, licensed AGPL-3.0.
The repository license text is included as `LICENSE`. This package includes source code.

The new `src/libraryImages.js` is a refactoring of the existing Plus lazy thumbnail loader, not a copy of the upstream V3 image worker. No V3 worker was transplanted because its cache/pipeline dependencies are not compatible with this Plus build without a deeper integration.

Check original contributor notices and provenance before public redistribution. This notice is not legal advice.
