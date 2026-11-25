'use strict';
// Real owner burning tick -> queued /burn report -> whole gamemode -> real
// updateNeighbor script on two independent observer contexts. No live game.
const fs = require('fs'), path = require('path');
const standIn = require('../../tests/stand-in-server');
const t = standIn.checks(), yes = t.yes;
const w = standIn.world({ name: '6478-remote-burn', settings: { thornswoodServer: 'main' } });
const actor = w.person(0xff006478, { profileId: 1000, name: 'Brenna', pos: [0, 0, 0] });
const other = w.person(0xff006479, { profileId: 1001, name: 'Corvin', pos: [100, 0, 0] });
yes('the whole gamemode loads', w.boot());
if (w.loaded()) {
  yes('the capture uses a fresh real gamemode registration', w.restart().loaded);
  w.arrive(actor); w.arrive(other); w.run(30000);
  const prop = 'thornswoodBurnVisual', def = w.propertyDefinition(prop);
  yes('burning has a neighbor-only visual property without an owner ignition script',
    !!def && def.isVisibleByNeighbors === true && def.isVisibleByOwner === false && def.updateOwner === '' && !!def.updateNeighbor);
  const front = fs.readFileSync(path.join(__dirname, '../plugins/thornswood-front.js'), 'utf8').replace(/\r/g, '');
  const ownerBlock = front.slice(front.indexOf('  const BURN_TICK ='), front.indexOf('\n  /*\n    ------------------------------------------ who you are looking at'));
  const config = /  const FIRE_SHADER = [^;]+;/.exec(front)[0] + /  const BURN_PER_SECOND = [^;]+;/.exec(front)[0];
  const local = { damage: 0, plays: 0, stops: 0 }, ownerGlobal = {}, ownerClock = { now: w.now() };
  let ownerTick;
  const localActor = { damageActorValue(name, value) { if (name === 'Health') local.damage += value; } };
  const ownerSp = { on(event, fn) { if (event === 'update') ownerTick = fn; }, Game: { getPlayer: () => localActor, getFormEx: id => id },
    EffectShader: { from: () => ({ play(target) { if (target === localActor) local.plays++; }, stop(target) { if (target === localActor) local.stops++; } }) } };
  new Function('sp', 'globalThis', 'Date', 'guard', 'note', 'tellServer', config + ownerBlock)(ownerSp, ownerGlobal,
    { now: () => ownerClock.now }, (name, fn) => fn, () => {}, line => w.say(actor, line));
  function ownerFire(ms = 5000) { w.run(1100); ownerClock.now = w.now(); ownerGlobal.thornswoodCatchFire(ms); ownerTick(); w.run(100); }
  const value = () => w.prop(actor, prop);
  function observer(definition = def) {
    const calls = [], target = { loaded: true, is3DLoaded() { return this.loaded; } };
    const clock = { now: 400000 }, ctx = { state: {}, refr: target, value: undefined,
      get: key => key === 'isDead' ? !!w.row(actor).isDead : undefined,
      sp: { Actor: { from: ref => ref }, Game: { getFormEx: id => id, getPlayer() { throw Error('observer must not target itself'); } },
        EffectShader: { from: () => ({ play(a, seconds) { calls.push(['play', a, seconds]); }, stop(a) { calls.push(['stop', a]); } }) },
        printConsole: line => calls.push(['error', line]) } };
    const fn = definition && definition.updateNeighbor ? new Function('ctx', 'Date', definition.updateNeighbor) : () => {};
    return { target, clock, calls, ctx, run(v = value()) { ctx.value = v; fn(ctx, { now: () => clock.now }); },
      plays: () => calls.filter(row => row[0] === 'play').length, stops: () => calls.filter(row => row[0] === 'stop').length };
  }
  ownerFire();
  yes('the actual owner tick still deals its existing fire damage and plays local flames', local.damage === 7 && local.plays === 1);
  yes('the real queued owner report publishes active observer state', value() && value().on === true);
  const a = observer(), b = observer(); a.run(); b.run();
  yes('two independent observers play flames on the remote actor', a.plays() === 1 && b.plays() === 1 &&
    a.calls[0][1] === a.target && b.calls[0][1] === b.target);
  a.run(); b.run();
  yes('unchanged per-frame data does not start duplicate shaders', a.plays() === 1 && b.plays() === 1);
  yes('observer playback has a finite lifetime', a.calls.some(row => row[0] === 'play' && row[2] > 0 && row[2] <= 10));
  const late = observer(); late.target.loaded = false; late.run();
  yes('an unloaded remote body does not start a shader', late.plays() === 0);
  late.target.loaded = true; late.run();
  yes('the same authoritative state appears once the remote body loads', late.plays() === 1);
  w.run(2000);
  yes('the existing close-range spread still sends only its normal owner ignition', w.prop(other, 'thornswoodBurn') && w.prop(other, 'thornswoodBurn').ms === 5000);
  w.run(3100); ownerClock.now = w.now(); ownerTick(); w.run(100);
  a.run(); b.run();
  yes('the real owner stop report stops remote flames on both observers', value() && value().on === false && a.stops() === 1 && b.stops() === 1);
  yes('the local owner still stops its own shader', local.stops === 1);

  ownerFire(); const active = value(), quiet = observer(); quiet.run(active); quiet.clock.now += 10000; quiet.run(active);
  yes('an observer without further reports expires its own finite visual', quiet.plays() === 1 && quiet.stops() === 1);
  quiet.run(active);
  yes('the same expired value cannot restart flames every frame', quiet.plays() === 1);
  w.run(10000);
  yes('the existing server report timeout publishes off for late observers', value() && value().on === false);
  const expired = observer(); expired.run(); yes('a late observer cannot replay an expired server fire', expired.plays() === 0);

  ownerFire();
  const life = observer(); life.run(); w.row(actor)._skympNpcLifeGeneration = 1; w.run(2500); life.run();
  yes('a changed life generation clears the old runtime fire', value() && value().on === false && life.stops() === 1);
  ownerFire();
  const runtime = w.mp().getActorRuntimeIdentity;
  w.mp().getActorRuntimeIdentity = id => id === actor ? String(Number(runtime(id)) + 1) : runtime(id);
  w.run(2500); w.mp().getActorRuntimeIdentity = runtime;
  yes('replacing the actor runtime cannot carry over its old active fire', value() && value().on === false);
  ownerFire(); w.row(actor).profileId = 2000; w.run(2500); w.row(actor).profileId = 1000;
  yes('reusing the actor for another profile cannot retain the old fire', value() && value().on === false);
  ownerFire(); const dead = observer(); dead.run(); w.die(actor, 0, null); dead.run();
  yes('a dead remote actor immediately loses its observer shader', dead.stops() === 1);
  w.run(2500); yes('death cleanup clears saved observer state', value() && value().on === false);
  w.row(actor).isDead = false; ownerFire(); w.leave(actor); w.run(2500);
  yes('disconnect cleanup clears the old observer state', value() && value().on === false);
  w.arrive(actor); w.run(1500); ownerFire(); const beforeRestart = value();
  yes('the restart fixture holds a genuinely active fire', beforeRestart && beforeRestart.on === true);
  w.restart();
  const restartDef = w.propertyDefinition(prop), returned = observer(restartDef); returned.run(beforeRestart);
  yes('a new server script cannot replay a persisted earlier-process fire', returned.plays() === 0);
  w.arrive(actor); w.run(1500); ownerFire(); const beforeReload = value();
  yes('the real hot reload re-registers its scripts successfully', w.reload());
  const reloadDef = w.propertyDefinition(prop), reloaded = observer(reloadDef); reloaded.run(beforeReload);
  yes('hot-reloaded observer scripts reject saved fires from the previous registration', reloaded.plays() === 0);
  ownerFire(); reloaded.run();
  yes('a fresh fire report works immediately after hot reload', reloaded.plays() === 1);
  yes('observer scripts never report an API or shader error', [a, b, late, quiet, expired, life, dead, returned, reloaded].every(o => !o.calls.some(row => row[0] === 'error')));
}
t.done(w);
