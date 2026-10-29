# Cover movement and wish collection sound

- The finished cover and four menu hitboxes remain unchanged.
- `title-motion.js` animates six existing painted bells and nine flower clusters, with independent phases and feathered, fixed patch boundaries. Title bells swing up to about 7–9 degrees; nearby branches and flowers sway in a lighter breeze. Title lettering and pendant text remain fixed.
- WebGL performs local texture remapping when available; Canvas 2D falls back to native textured triangle meshes with no per-frame pixel processing in JavaScript. Static artwork remains underneath. Hidden tabs, open system dialogs and non-title screens pause decorative rendering; system reduced-motion disables the effect.
- `audio/wish-collect.wav` is deterministic, locally synthesized 44.1 kHz stereo PCM, 2.8 seconds long. Four rising air sweeps converge with the existing 2.8-second collection animation, with a soft crystalline settling.
- The existing successful-choice positive `collectionDelta` is the sole story trigger. Reading, loading, opening the tree, and repainting cannot trigger collection sound. Navigation stops it; effect mute, volume and background pause use the same audio controller as other effects. Settings also has an explicit preview.
- Generator: `node scripts/create-collection-audio.mjs`. Original supplied MP3s are unchanged.
