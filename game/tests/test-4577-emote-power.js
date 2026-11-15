// test-4577-emote-power.js
//
// #4577. An emote as a lesser power, so it can sit on a favourites key.
//
// WHAT IS MEASURED. On main the wheel is the only way to play an emote: the
// favourites menu holds spells and powers, and 1 to 8 with the wheel shut are
// Skyrim's own favourites hotkeys (docs/systems/emotes.md), so nothing a
// person can put there plays one. The fix is a lesser power, Wave, in the
// content plugin, that does nothing of its own, and the emotes plugin playing
// Wave when this person casts it, through the same play path as the wheel.
//
// The real plugin runs in vm, as test-1852-wheel-keys.js runs it. A cast is
// Skyrim Platform's spellCast event ({ caster, spell }, Definitions.txt in the
// fork). The power is Thornswood-Content.esp's own SPEL, WAVE_POWER in
// scripts/mods/Add-ContentRecords.py, looked up by its local id the way the
// plugin looks up the instruments.
//
// Not checked in game: whether the power's own cast motion shows before the
// wave, and how two presses feel. Those are for a person on Dev.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pluginPass = require('../../tests/fixtures/plugin-pass');
const REPO = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(REPO, p), 'utf8').split(String.fromCharCode(13)).join(''); }
const plugin = read(process.env.PLUGIN || path.join('game', 'plugins', 'thornswood-emotes.js'));
const content = read(path.join('scripts', 'mods', 'Add-ContentRecords.py'));
const serverAddress = JSON.parse(read(path.join('scripts', 'vps', 'vps.json'))).address;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// The power's local id, as the content builder names it.
const m = /^WAVE_POWER = 0x([0-9A-Fa-f]+)\s*$/m.exec(content);
const WAVE_LOCAL = m ? (parseInt(m[1], 16) & 0xFFFFFF) : -1;
const LOADED_AT = 0x05000000;     // where the game put Thornswood-Content.esp this run
const OTHER_SPELL = 0x0012FCD;    // Flames, Skyrim.esm

function rig() {
  const handlers = {};
  const w = { played: [], told: [], now: 1000 };
  const io = {
    readFileSync(file) {
      if (/skymp5-client-settings\.txt$/.test(file)) { return JSON.stringify({ 'server-ip': serverAddress }); }
      if (/thornswood-session\.txt$/.test(file)) { return String(Date.now()); }
      throw new Error('absent');
    },
    appendFileSync() { }, writeFileSync() { }
  };
  function form(id) { return { getFormID: () => id }; }
  const me = { getFormID: () => 0x14, isWeaponDrawn: () => false, sheatheWeapon() { },
               getParentCell: () => null, getItemCount: () => 1 };
  const them = { getFormID: () => 0xff000123 };
  let hook = null;
  const sp = {
    on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    printConsole() { },
    Game: {
      getPlayer: () => me,
      getFormFromFile(id, file) {
        if (file === 'Thornswood-Content.esp' && WAVE_LOCAL >= 0 && id === WAVE_LOCAL) { return form(LOADED_AT | WAVE_LOCAL); }
        return null;
      }
    },
    Utility: { isInMenuMode: () => false },
    browser: { isFocused: () => false },
    TESModPlatform: { setWeaponDrawnMode() { } },
    hooks: { sendAnimationEvent: { add(h) { hook = h; } } },
    Debug: {
      notification(t) { w.told.push(t); },
      sendAnimationEvent(pc, ev) {
        // The client's own hook, around the native call, the way the game runs it.
        const store = new Map();
        const ctx = { selfId: 0x14, animEventName: ev, storage: { set: (k, v) => store.set(k, v), get: (k) => store.get(k) } };
        if (hook) { hook.enter(ctx); }
        if (ctx.animEventName) { w.played.push(ctx.animEventName); }
        ctx.animationSucceeded = !!ctx.animEventName;
        if (hook) { hook.leave(ctx); }
      }
    }
  };
  const T = { ready: true, isTyping: () => false, setTyping() { }, claimFocus() { }, js() { return true; } };
  const box = { skyrimPlatform: sp, Thornswood: T, require: () => io, Date: Date, JSON: JSON, Math: Math, Number: Number };
  vm.createContext(box);
  pluginPass.load(box, plugin, { filename: 'thornswood-emotes.js' });
  w.emit = function (name, ev) { (handlers[name] || []).forEach(function (fn) { fn(ev); }); };
  w.hears = function (name) { return (handlers[name] || []).length > 0; };
  w.frames = function (n) { for (let i = 0; i < n; i++) { w.emit('update'); } };
  w.cast = function (caster, spellId) { w.emit('spellCast', { caster: caster, spell: form(spellId) }); };
  w.me = me; w.them = them;
  return w;
}
function count(list, what) { return list.filter(function (x) { return x === what; }).length; }

// ========================================================== the record
yes('R1 the content builder names the Wave power (WAVE_POWER) in this plugin\'s own range', WAVE_LOCAL > 0);

// ============================================================ the cast
{
  const w = rig();
  yes('C1 the emotes plugin hears casts (spellCast)', w.hears('spellCast'));
  w.cast(w.me, LOADED_AT | WAVE_LOCAL);
  w.frames(6);
  yes('C2 casting the Wave power plays Wave once, through the wheel\'s path', count(w.played, 'IdleWave') === 1);
  yes('C2 and stands the stance down first, as the wheel does', w.played.indexOf('IdleForceDefaultState') !== -1 &&
      w.played.indexOf('IdleForceDefaultState') < w.played.indexOf('IdleWave'));
}
{
  const w = rig();
  w.cast(w.me, OTHER_SPELL);
  w.frames(6);
  yes('C3 any other spell plays nothing', w.played.length === 0);
}
{
  const w = rig();
  w.cast(w.them, LOADED_AT | WAVE_LOCAL);
  w.frames(6);
  yes('C4 somebody else casting it plays nothing here: their own machine plays theirs', w.played.length === 0);
}
{
  const w = rig();
  w.emit('spellCast', { caster: null, spell: null });
  w.emit('spellCast', {});
  w.frames(3);
  yes('C5 a cast with no caster or no spell plays nothing and throws nothing', w.played.length === 0);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
