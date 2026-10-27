// Social captions for GameReels.
// Hold previews EXAMPLE sample copy. Apply stores that line on the clip.
// Neither step writes a video, contacts a network, or posts anywhere.
// Export is a separate explicit action and only writes files on this PC.
// Sample copy is synthetic: built-in play labels only, never a typed name.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GameReelsCaptions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SHORT_MAX = 100;

  // Probes the server must refuse. The share sheet never calls these.
  const REFUSED_GATES = ['invent_upload', 'auto_post', 'share_external'];

  const PRESETS = [
    {
      id: 'short',
      label: 'Short',
      hint: 'One line, 100 characters or fewer. EXAMPLE sample copy for a social caption.',
    },
    {
      id: 'medium',
      label: 'Medium',
      hint: 'A few sentences of EXAMPLE sample copy. Still not a real post.',
    },
    {
      id: 'hashtags',
      label: 'Hashtag pack',
      hint: 'EXAMPLE hashtags for lacrosse or soccer. Sample pack only.',
    },
  ];

  const BY_ID = Object.fromEntries(PRESETS.map(p => [p.id, p]));

  const ACTION_LABELS = ['Goal', 'Assist', 'Shot', 'Draw Win', 'Ground Ball', 'Dodge', 'Dribble', 'Steal', 'Defense'];
  const LACROSSE_ONLY = new Set(['Draw Win', 'Ground Ball', 'Dodge']);
  const SOCCER_ONLY = new Set(['Dribble']);

  function sportOf(id) {
    return id === 'soccer'
      ? { id: 'soccer', name: 'Soccer', tag: 'Soccer' }
      : { id: 'lacrosse', name: 'Lacrosse', tag: 'Lacrosse' };
  }

  // Known play labels only. Anything else (including a typed name) becomes "highlight".
  function actionOf(label, sportId) {
    if (!ACTION_LABELS.includes(label)) return 'highlight';
    if (sportId === 'soccer' && LACROSSE_ONLY.has(label)) return 'highlight';
    if (sportId !== 'soccer' && SOCCER_ONLY.has(label)) return 'highlight';
    return label;
  }

  function actionFor(label, sport) {
    return actionOf(label, sportOf(sport).id);
  }

  function hashtagAction(action) {
    if (action === 'highlight') return 'Highlight';
    return action.replace(/\s+/g, '');
  }

  function renderCaption(presetId, ctx) {
    const preset = BY_ID[presetId];
    if (!preset) throw new Error('unknown caption preset: ' + presetId);
    const sport = sportOf(ctx && ctx.sport);
    const action = actionOf(ctx && ctx.label, sport.id);
    let text;
    if (preset.id === 'short') {
      text = `EXAMPLE · ${sport.name} ${action}. Synthetic clip — sample copy only.`;
    } else if (preset.id === 'medium') {
      text = `EXAMPLE · Synthetic ${sport.name.toLowerCase()} highlight for a social caption. Sample copy of a ${action} clip from Veo film. No player names. GameReels keeps the file on this PC and does not post it.`;
    } else {
      text = `EXAMPLE #SyntheticClip #${sport.tag} #${hashtagAction(action)} #HighlightReel #GameReels #SampleOnly`;
    }
    if (!text.includes('EXAMPLE')) throw new Error('EXAMPLE label missing');
    if (preset.id === 'short' && [...text].length > SHORT_MAX) {
      throw new Error('short caption exceeds ' + SHORT_MAX);
    }
    return text;
  }

  // appliedId is the preset id already stored on a clip, or null.
  // Hold changes the preview only. Apply copies that preview into appliedText.
  // A later sport or label change does not rewrite the applied line.
  // exports stays false: this session never writes a file or posts.
  function createCaptionSession(appliedId) {
    let sport = 'lacrosse';
    let label = null;
    let held = BY_ID[appliedId] ? appliedId : null;
    let applied = held;
    let appliedText = held ? renderCaption(held, { sport, label }) : null;

    function preview() {
      return held ? renderCaption(held, { sport, label }) : null;
    }

    function snapshot() {
      const heldText = preview();
      const pending = !!(heldText && heldText !== appliedText);
      return {
        sport,
        label,
        held,
        applied,
        heldText,
        appliedText,
        pending,
        exports: false,
        outbound: false,
      };
    }

    return {
      setSport(next) {
        sport = next === 'soccer' ? 'soccer' : 'lacrosse';
        return snapshot();
      },
      setLabel(next) {
        label = ACTION_LABELS.includes(next) ? next : null;
        return snapshot();
      },
      hold(id) {
        if (!BY_ID[id]) throw new Error('unknown caption preset: ' + id);
        held = id;
        return snapshot();
      },
      apply() {
        if (!held) throw new Error('hold a caption before Apply');
        applied = held;
        appliedText = preview();
        return snapshot();
      },
      snapshot,
    };
  }

  // Local placeholder. uploaded and posted stay false so a caller cannot
  // report an Instagram or TikTok upload that did not happen.
  function shareIntentPlaceholder(caption) {
    const text = String(caption || '');
    if (!text.includes('EXAMPLE')) throw new Error('share intent needs an EXAMPLE caption');
    return {
      kind: 'placeholder',
      uploaded: false,
      posted: false,
      openedApp: null,
      instagram: false,
      tiktok: false,
      message: 'Share intent placeholder. Nothing was uploaded.',
      lines: [
        'Instagram: not opened',
        'TikTok: not opened',
        'Upload: refused',
      ],
      caption: text,
    };
  }

  return {
    SHORT_MAX,
    REFUSED_GATES,
    PRESETS,
    ACTION_LABELS,
    renderCaption,
    actionFor,
    createCaptionSession,
    shareIntentPlaceholder,
  };
});
