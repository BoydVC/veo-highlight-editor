// GameReels frontend entry point. Each module wires up its own controls as it
// loads; this pulls them all in, then starts the app.
import { drawOverlay } from './player.js';
import { drawTimeline } from './timeline.js';
import { renderLabelBar } from './clips.js';
import { refreshVideos } from './project.js';
import './tracking.js';
import './export.js';
import './builder.js';
import './keyboard.js';
import './settings.js';

// ---------- boot -------------------------------------------------------------------
window.addEventListener('resize', () => { drawOverlay(); drawTimeline(); });
renderLabelBar();
refreshVideos();
