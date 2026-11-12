'use strict';
/*
  Words above a head, an emote's name on that same line, and whether a
  speaking mark should show.

  The chat box and this line are not the same reach. A plain line can still
  go to everybody in the box while the switch that would make the box local
  is off. The line above the head uses the distances on the chat page either
  way: about 57 metres for a plain line, a /me, a /do and an /ooc, a quarter
  of that for a whisper, three times that for a shout. Same cell first.

  One line, 80 characters, 6 seconds. The timer lives on the machine that
  draws it. This file only decides the words and who they are for.

  The speaking mark is not words. Whisper is gone at 7 metres, ordinary
  speech at 30, a yell at 85. You do not see your own. A voice mute hides
  it. Hiding a name does not, and neither does turning their text off.
*/

const SPEECH = 4000;
const WHISPER = 1000;
const SHOUT = 12000;
const FLOAT_CHARS = 80;
const OOC_CHARS = 300;
const FLOAT_MS = 6000;

const VERBS = {
  '/me': 'me',
  '/do': 'do',
  '/whisper': 'whisper',
  '/w': 'whisper',
  '/shout': 'shout',
  '/s': 'shout',
  '/yell': 'shout',
  '/y': 'shout',
  '/ooc': 'ooc',
  '/o': 'ooc'
};

const USAGE = {
  me: 'Say /me and then what your character does, like /me draws a sword.',
  do: 'Say /do and then what there is to see, like /do The door is barred.',
  whisper: 'Say /w and then what you whisper.',
  shout: 'Say /s and then what you shout.',
  ooc: 'Say /ooc and then whatever you meant to say.'
};

const MARK_METRES = { whisper: 7, local: 30, yell: 85 };

/* Voice turned into words (#2475). A seventieth of a metre is a unit, as in
   voice-server.js, so a caption reaches as far as the voice it came from:
   7, 30 or 85 metres by the speaker's mode, the same distances the speaking
   mark uses. */
const UNITS_PER_METRE = 70;
const CAPTION_CHARS = 200;

function cut(text, n) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 3)).trimEnd() + '...';
}

/* The line above the head. An /ooc is in brackets. A /me and an emote are
   the action, which is the words themselves. A whisper and a shout use the
   same words as the box, without the name, because the name is already
   above the head. */
function headOf(kind, words) {
  let s = String(words || '').replace(/\s+/g, ' ').trim();
  if (kind === 'ooc') s = '((' + ' ' + s + ' ))';
  return cut(s, FLOAT_CHARS);
}

function floatLine(raw) {
  const trimmed = String(raw == null ? '' : raw).trim();
  if (!trimmed) return null;
  if (trimmed.charAt(0) !== '/') {
    const words = trimmed.length > 400 ? trimmed.slice(0, 400) : trimmed;
    return {
      kind: 'say',
      local: false,
      words: words,
      head: headOf('say', words),
      reach: SPEECH
    };
  }
  const m = /^(\/[a-z]+)(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!m) return null;
  const kind = VERBS[m[1].toLowerCase()];
  if (!kind) return null;
  let words = String(m[2] || '').replace(/\s+/g, ' ').trim();
  if (!words) return { kind: kind, empty: true, usage: USAGE[kind] };
  if (kind === 'ooc' && words.length > OOC_CHARS) words = words.slice(0, OOC_CHARS);
  const reach = kind === 'whisper' ? WHISPER : kind === 'shout' ? SHOUT : SPEECH;
  return {
    kind: kind,
    local: true,
    words: words,
    head: headOf(kind, words),
    reach: reach
  };
}

/* AN EMOTE IS ONE OF THE WHEEL'S NAMES, AND NOTHING ELSE (#4466).
   emoteHead took any text and cut it to 80, so a socket could put whatever it
   liked over its head as an "emote", past every rule typed words keep to.
   The wheel (game\plugins\thornswood-emotes.js, EMOTES) sends only the name
   on its list, as written there, so these are the only names that come from
   it. A name added to the wheel is added here in the same change:
   voice\tests\test-4466-emote-limit.js holds the two lists to each other. */
const EMOTE_NAMES = [
  'Ache', 'Agitated', 'Applaud', 'Arms crossed', 'At ease', 'Attention',
  'Bar drink', 'Blessing', 'Bow', 'Cheer', 'Chop wood', 'Clean blade',
  'Come here', 'Crouch warm', 'Dance', 'Drink', 'Drink potion', 'Drum', 'Eat',
  'Examine', 'Flute', 'Get attention', 'Give', 'Grave bow', 'Hard clap', 'Hoe',
  'Horn', 'Jig', 'Kneel', 'Laugh', 'Lean', 'Ledger', 'Long clap', 'Look far',
  'Lute', 'Nervous', 'Oath', 'Ovation', 'Pick up', 'Point', 'Point farther',
  'Point yonder', 'Pray', 'Read', 'Read book', 'Reel', 'Salute', 'Sing', 'Sit',
  'Slow clap', 'Study', 'Surrender', 'Sweep', 'Take', 'Warm arms', 'Warm close',
  'Warm hands', 'Wave', 'Wipe brow', 'Write'
];
const EMOTE_SET = new Set(EMOTE_NAMES);

function emoteHead(name) {
  const s = typeof name === 'string' ? name : '';
  return EMOTE_SET.has(s) ? s : '';
}

/* What a caption says above a head: one line, cut to the same 80 as a
   typed line. Nothing that can break a line, turn the text round or hide in
   it survives, because the words come from the speaker's own machine. */
function captionHead(text) {
  const s = String(text == null ? '' : text)
    .slice(0, CAPTION_CHARS)
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/g, ' ');
  return cut(s, FLOAT_CHARS);
}

/* How far a caption reaches, in units, for the speaker's voice mode. */
function captionReach(mode) {
  return markMetres(mode) * UNITS_PER_METRE;
}

function sameCellWithin(a, b, reach) {
  if (!a || !b) return false;
  if (String(a.cell) !== String(b.cell)) return false;
  if (!Array.isArray(a.pos) || !Array.isArray(b.pos)) return false;
  const dx = (Number(a.pos[0]) || 0) - (Number(b.pos[0]) || 0);
  const dy = (Number(a.pos[1]) || 0) - (Number(b.pos[1]) || 0);
  const dz = (Number(a.pos[2]) || 0) - (Number(b.pos[2]) || 0);
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}

function markMetres(mode) {
  if (mode === 'whisper') return MARK_METRES.whisper;
  if (mode === 'yell') return MARK_METRES.yell;
  return MARK_METRES.local;
}

/* self, silence and a voice mute hide it. A hidden name and a text mute
   are not arguments here, so they cannot. */
function markVisible(opts) {
  opts = opts || {};
  if (opts.self) return false;
  if (!opts.talking) return false;
  if (opts.silenced) return false;
  if (opts.voiceMuted) return false;
  if (opts.sameCell === false) return false;
  return Number(opts.metres) <= markMetres(opts.mode);
}

module.exports = {
  SPEECH: SPEECH,
  WHISPER: WHISPER,
  SHOUT: SHOUT,
  FLOAT_CHARS: FLOAT_CHARS,
  FLOAT_MS: FLOAT_MS,
  floatLine: floatLine,
  headOf: headOf,
  emoteHead: emoteHead,
  EMOTE_NAMES: EMOTE_NAMES,
  sameCellWithin: sameCellWithin,
  markMetres: markMetres,
  markVisible: markVisible,
  CAPTION_CHARS: CAPTION_CHARS,
  captionHead: captionHead,
  captionReach: captionReach
};
