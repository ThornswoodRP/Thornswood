'use strict';
// Queued place reports -> the whole gamemode's actual registered owner script.
// The registration recorder observes makeProperty without replacing its behavior.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const standIn = require('../../tests/stand-in-server');
const t = standIn.checks(), yes = t.yes;
// The stand-in reads gamemode-tables beside this file, just as the server does.
const gm = path.join(__dirname, '../.test-6790-' + crypto.randomBytes(8).toString('hex') + '.js');
const source = fs.readFileSync(process.env.GM || path.join(__dirname, '../gamemode.js'), 'utf8');
fs.writeFileSync(gm, "'use strict';\n" + 'globalThis.__test6790Properties = {};\n' +
  'var __test6790MakeProperty = mp.makeProperty;\n' +
  'mp.makeProperty = function(name, options) {\n' +
  '  globalThis.__test6790Properties[name] = options;\n' +
  '  return __test6790MakeProperty.apply(this, arguments);\n' +
  '};\n' +
  'var __test6790Set = mp.set;\n' +
  'mp.set = function(actor, name, value) {\n' +
  '  if (name === "thornswoodSky" && globalThis.__testSkyWrite) { globalThis.__testSkyWrite(actor, value); }\n' +
  '  return __test6790Set.apply(this, arguments);\n' +
  '};\n' + source);
let w, finished = false;
try {
  w = standIn.world({ name: '6790-sky-applied', gm, settings: { thornswoodServer: 'main' } });
  const a = w.person(0xff006790, { profileId: 1000, name: 'Brenna', cell: '3c:Skyrim.esm', pos: [0, 0, 0] });
  const b = w.person(0xff006791, { profileId: 1001, name: 'Corvin', cell: '3c:Skyrim.esm', pos: [20, 0, 0] });
  yes('the whole gamemode loads', w.boot());
  if (w.loaded()) {
    w.arrive(a); w.arrive(b); w.run(30000);
    const box = w.box(), S = box.__thornswoodSeason;
    box.__thornswoodSeasonUnit = () => 0;
    S.resetRolls();
    function report(actor, kind = 'outdoors') { w.say(actor, '/place ' + kind + ' - 0 ' + (kind === 'indoors' ? 1 : 0) + ' 0 -'); w.run(2100); }
    report(a); report(b);
    const def = box.__test6790Properties.thornswoodSky;
    const value = actor => w.prop(actor, 'thornswoodSky');
    yes('the actual registration is owner-only and contains its client script', !!def && def.isVisibleByOwner && !def.isVisibleByNeighbors && !!def.updateOwner);
    yes('actual queued reports publish the same nonzero shared sky to both people', value(a).id > 0 && value(a).id === value(b).id);
    const sky = value(a).id, run = new Function('ctx', def.updateOwner);
    function owner() {
      const o = { form: true, weather: true, forceThrows: false, releaseThrows: false, calls: [], state: {} };
      const weather = { forceActive(override) { o.calls.push(['force', override]); if (o.forceThrows) throw Error('native force refused'); } };
      o.ctx = { value: value(a), state: o.state, sp: {
        Game: { getFormEx(id) { o.calls.push(['form', id]); return o.form ? { id } : null; } },
        Weather: { from() { return o.weather ? weather : null; }, releaseOverride() {
          o.calls.push(['release']); if (o.releaseThrows) throw Error('native release refused');
        } }
      } };
      o.run = (v = value(a)) => { o.ctx.value = v; run(o.ctx); };
      o.forces = () => o.calls.filter(c => c[0] === 'force').length;
      o.releases = () => o.calls.filter(c => c[0] === 'release').length;
      return o;
    }
    const missing = owner(); missing.form = false; missing.run();
    yes('an unavailable native form is not marked applied', missing.state.thornswoodSkyId !== sky && missing.forces() === 0);
    missing.form = true; missing.run();
    yes('the unchanged shared value applies once its native form exists', missing.forces() === 1 && missing.state.thornswoodSkyId === sky);
    const afterApply = missing.calls.length; missing.run(); missing.run();
    yes('successfully applied unchanged frames make no extra native calls', missing.calls.length === afterApply);

    const unresolved = owner(); unresolved.weather = false; unresolved.run();
    yes('a form that does not resolve to Weather is not marked applied', unresolved.state.thornswoodSkyId !== sky && unresolved.forces() === 0);
    unresolved.weather = true; unresolved.run();
    yes('the same shared value applies after Weather resolution becomes available', unresolved.forces() === 1 && unresolved.state.thornswoodSkyId === sky);

    const refused = owner(); refused.forceThrows = true; refused.run();
    yes('a throwing native force does not publish a successful cache entry', refused.state.thornswoodSkyId !== sky);
    refused.forceThrows = false; refused.run();
    yes('a later normal owner update can apply the still-requested sky', refused.forces() === 2 && refused.state.thornswoodSkyId === sky && refused.calls.every(c => c[0] !== 'force' || c[1] === true));

    const release = owner(); release.run(); release.releaseThrows = true; release.run({ id: 0 });
    yes('a refused native release keeps the previously applied cache entry', release.state.thornswoodSkyId === sky);
    release.releaseThrows = false; release.run({ id: 0 });
    yes('the still-requested release commits its cache only after native success', release.releases() === 2 && release.state.thornswoodSkyId === 0);
    const releasedCalls = release.calls.length; release.run({ id: 0 });
    yes('an unchanged successful release makes no further native calls', release.calls.length === releasedCalls);
    const unavailableRelease = owner(); unavailableRelease.run();
    const releaseNative = unavailableRelease.ctx.sp.Weather.releaseOverride;
    delete unavailableRelease.ctx.sp.Weather.releaseOverride; unavailableRelease.run({ id: 0 });
    yes('an unavailable release method is not cached as a completed release', unavailableRelease.state.thornswoodSkyId === sky);
    unavailableRelease.ctx.sp.Weather.releaseOverride = releaseNative; unavailableRelease.run({ id: 0 });
    yes('an available release method completes the unchanged indoor request', unavailableRelease.releases() === 1 && unavailableRelease.state.thornswoodSkyId === 0);

    const first = owner(), second = owner(); first.run(value(a)); second.run(value(b));
    yes('independent arrival contexts each apply the shared roll once', first.forces() === 1 && second.forces() === 1);
    const shared = S.ensureRoll(S.climateOf(a, { place: 'outdoors', high: 0 }), w.now());
    const deadline = shared.until, originalSky = shared.id;
    report(a, 'indoors'); first.run();
    yes('the actual indoor report releases the previous outdoor override', value(a).id === 0 && first.releases() === 1 && first.state.thornswoodSkyId === 0);
    report(a); first.run();
    yes('returning outdoors reapplies the same unexpired shared roll', value(a).id === originalSky && first.forces() === 2 && S.ensureRoll(S.climateOf(a, { place: 'outdoors', high: 0 }), w.now()).until === deadline);
    report(b); second.run();
    yes('another person in that climate keeps the same roll without a new force', value(b).id === originalSky && second.forces() === 1);
    w.leave(a); w.arrive(a); w.run(30000); report(a);
    const arrival = owner(); arrival.run();
    yes('a fresh arrival context applies the persisted unexpired shared value', value(a).id === originalSky && arrival.forces() === 1 && S.ensureRoll(S.climateOf(a, { place: 'outdoors', high: 0 }), w.now()).until === deadline);

    // A native publication can also fail before the owner sees the value.
    const indoor = { place: 'indoors' }, outdoor = { place: 'outdoors' };
    const logStart = w.log.length;
    let rejectActor = a, refuse = true, writes = 0;
    box.__testSkyWrite = (actor, desired) => {
      if (actor !== rejectActor) { return; }
      writes++;
      if (refuse) { throw Error('native sky publication refused ' + desired.id); }
    };
    S.skyAdjust(a, indoor);
    yes('a refused indoor release leaves the previously published sky', writes === 1 && value(a).id === originalSky);
    refuse = false;
    S.skyAdjust(a, indoor);
    S.skyAdjust(a, indoor);
    yes('the next ordinary indoor update publishes the release once', writes === 2 && value(a).id === 0);

    S.skyAdjust(b, indoor);
    rejectActor = b;
    writes = 0;
    refuse = true;
    S.skyAdjust(b, outdoor);
    yes('a refused outdoor publication leaves the indoor value', writes === 1 && value(b).id === 0);
    refuse = false;
    S.skyAdjust(b, outdoor);
    S.skyAdjust(b, outdoor);
    yes('the next ordinary outdoor update publishes the same sky once', writes === 2 && value(b).id === originalSky);
    yes('a refused publication does not reroll or replace the shared sky', S.ensureRoll(S.climateOf(a, outdoor), w.now()).until === deadline);
    const refusedWrites = w.log.slice(logStart).filter(line => line.includes('could not publish shared sky'));
    yes('both refused writes log the actor, sky and engine error, with no extra lines on success',
      refusedWrites.length === 2 &&
      refusedWrites[0].includes('0x' + a.toString(16) + ' for sky 0x0: native sky publication refused 0') &&
      refusedWrites[1].includes('0x' + b.toString(16) + ' for sky 0x' + originalSky.toString(16) + ': native sky publication refused ' + originalSky));
  }
  t.done(w);
  finished = true;
} finally {
  if (w && !finished) w.done();
  fs.unlinkSync(gm);
}
