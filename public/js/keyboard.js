// Keyboard shortcuts.
import { createClip, selected, deleteClip, moveClip, nudge, assignLabel } from './clips.js';
import { $, video, state, toast } from './core.js';
import { exportClip } from './export.js';
import { stepFrames, jump, togglePlay, setSpeed, setIn, setOut } from './player.js';
import { enterTracking, exitTracking, undoAnchor } from './tracking.js';

// ---------- keyboard ---------------------------------------------------------------
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase();

  if (state.tracking) {
    if (k === 'escape') { exitTracking(); e.preventDefault(); return; }
    if (k === 'arrowright') { const skip = parseInt($('skipFrames').value, 10); stepFrames(skip); e.preventDefault(); return; }
    if (k === 'arrowleft') { const skip = parseInt($('skipFrames').value, 10); stepFrames(-skip); e.preventDefault(); return; }
    if (k === 'u' || k === 'backspace') { undoAnchor(); e.preventDefault(); return; }
    if (k === ' ') { e.preventDefault(); return; } // no accidental playback while tracking
    return;
  }

  switch (k) {
    case ' ': case 'k': togglePlay(); e.preventDefault(); break;
    case 'arrowright': e.shiftKey ? jump(1) : stepFrames(1); e.preventDefault(); break;
    case 'arrowleft': e.shiftKey ? jump(-1) : stepFrames(-1); e.preventDefault(); break;
    case 'arrowup': if (e.altKey) { const c = selected(); if (c) moveClip(c.id, -1); e.preventDefault(); } break;
    case 'arrowdown': if (e.altKey) { const c = selected(); if (c) moveClip(c.id, 1); e.preventDefault(); } break;
    case 'j': jump(-10); break;
    case 'l': {
      state.speedIdx = (state.speedIdx + 1) % state.speedSteps.length;
      const sp = state.speedSteps[state.speedIdx];
      setSpeed(sp);
      if (video.paused) video.play();
      toast('Speed ' + sp + '×', false, 1200);
      break;
    }
    case 'i': setIn(); break;
    case 'o': setOut(); break;
    case 'c': createClip(); break;
    case 't': { const c = selected(); c ? enterTracking(c.id) : toast('Select a clip first', true); break; }
    case 'e': { const c = selected(); c ? exportClip(c) : toast('Select a clip first', true); break; }
    case ',': nudge(e.shiftKey ? 'out' : 'in', -1); break;
    case '.': nudge(e.shiftKey ? 'out' : 'in', 1); break;
    case 'delete': { const c = selected(); if (c) deleteClip(c.id); break; }
    default:
      if (/^[1-9]$/.test(k)) assignLabel(parseInt(k, 10) - 1);
  }
});
