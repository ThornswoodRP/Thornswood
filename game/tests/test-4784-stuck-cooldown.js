// #4784: cancelled combat /stuck waits consume the character's cooldown.
// Run the actual stuck block with a controlled clock and an in-memory staff log.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'gamemode', 'stuck.ts'), 'utf8');
const ACTOR = 0xff000001, OTHER = 0xff000002, PROFILE = 101;
const key = ACTOR.toString(16);

function world() {
  const w = { now: 1000000, hp: 1, dead: false, pos: [0, 0, 0], said: [], records: [], moves: [] };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [w.now])); }
    static now() { return w.now; }
  }
  const box = {
    Date: Clock, log() {}, guard: (name, fn) => fn, setInterval: () => 1, clearInterval() {},
    __thornswoodToProfile: (pid, text) => w.said.push({ pid, text }),
    require(name) {
      if (name === 'fs') return { mkdirSync() {}, appendFileSync: (file, text) => w.records.push(JSON.parse(text)) };
      if (name === 'path') return path;
      throw new Error('Unexpected module: ' + name);
    },
    mp: {
      get(id, name) {
        if (name === 'onlinePlayers') return [ACTOR, OTHER];
        if (name === 'profileId') return id === ACTOR ? PROFILE : 202;
        if (name === 'appearance') return { name: 'Test character' };
        if (name === 'worldOrCellDesc') return '3c:Skyrim.esm';
        if (name === 'pos') return id === ACTOR ? w.pos.slice() : [1000, 1000, 0];
        if (name === 'angle') return [0, 0, 0];
        if (name === 'percentages') return { health: id === ACTOR ? w.hp : 1 };
        if (name === 'isDead') return id === ACTOR && w.dead;
        return null;
      },
      set(id, name, value) { w.moves.push({ id, name, value }); },
      getServerSettings: () => ({ thornswoodServer: 'dev', forBotDir: 'for-bot' })
    }
  };
  vm.runInNewContext(source, box, { filename: 'stuck.ts' });
  w.stuck = box.__thornswoodStuck;
  w.command = () => w.stuck.command(PROFILE, ACTOR, w.now);
  w.fight = () => w.stuck.sample(ACTOR, w.now);
  w.fight();
  w.hp = 0.9;
  w.now += 1000;
  w.fight();
  return w;
}

for (const reason of ['hit', 'moved', 'died']) {
  const w = world();
  w.command();
  assert.ok(w.stuck.state.waiting[PROFILE], reason + ': combat starts a wait');
  w.command();
  assert.match(w.said.at(-1).text, /already counting down/, reason + ': repeats during the wait reuse it');
  w.now += 1000;
  if (reason === 'hit') w.hp = 0.8;
  if (reason === 'moved') w.pos[0] = 200;
  if (reason === 'died') w.dead = true;
  w.stuck.tick();
  assert.equal(w.records.length, 1, reason + ': one cancellation reaches staff');
  assert.equal(w.records[0].result, 'cancelled');
  assert.equal(w.moves.length, 0, reason + ': cancellation does not move anybody');
  const cancellationReply = w.said.at(-1).text;
  w.dead = false;
  const cancelledAt = w.now;
  for (let i = 0; i < 10; i++) {
    w.now += 1000;
    w.command();
    w.pos[0] += 200;
    w.stuck.tick();
  }
  assert.equal(w.records.length, 1, reason + ': repeated commands and steps cannot flood staff');
  assert.match(cancellationReply, /again in 5 minutes/, reason + ': cancellation explains its cooldown');
  assert.equal(w.moves.length, 0, reason + ': repeats cannot bypass the wait');
  assert.equal(w.stuck.state.waiting[PROFILE], undefined, reason + ': repeats cannot queue another wait');
  assert.match(w.said.at(-1).text, /once every 5 minutes/, reason + ': repeat is refused with its remaining cooldown');
  w.now = cancelledAt + w.stuck.AGAIN_MS - 1;
  w.command();
  assert.equal(w.moves.length, 0, reason + ': refused immediately before expiry');
  w.now++;
  w.command();
  assert.equal(w.moves.length, 1, reason + ': noncombat use works at exact cooldown expiry');
  assert.equal(w.records.length, 2, reason + ': next allowed use is recorded normally');
  console.log('PASS  ' + reason + ' cancellation: bounded staff record and exact cooldown boundary');
}

{
  const w = world();
  const previous = { at: w.now - w.stuck.AGAIN_MS, from: { desc: 'old', pos: [1, 2, 3] }, to: { desc: 'old', pos: [4, 5, 6] } };
  w.stuck.state.used[key] = previous;
  w.command();
  w.pos[0] = 200;
  w.now++;
  w.stuck.tick();
  assert.equal(w.stuck.state.used[key].from, previous.from, 'cancellation preserves the last escape origin');
  assert.equal(w.stuck.state.used[key].to, previous.to, 'cancellation preserves the last escape destination');
  w.stuck.command(202, OTHER, w.now);
  assert.equal(w.moves[0].id, OTHER, 'another character has an independent cooldown');
  console.log('PASS  cancellation preserves escape history and another character can still use /stuck');
}

{
  const w = world();
  w.command();
  w.now += w.stuck.WAIT_MS - 1;
  w.stuck.tick();
  assert.equal(w.moves.length, 0, 'successful combat use still waits the full 15 seconds');
  w.now++;
  w.stuck.tick();
  assert.equal(w.moves.length, 1, 'successful combat use moves once at 15 seconds');
  w.now += w.stuck.AGAIN_MS - 1;
  w.command();
  assert.equal(w.moves.length, 1, 'successful combat use still counts cooldown from the move');
  w.now++;
  w.command();
  assert.equal(w.moves.length, 2, 'successful combat cooldown still ends after five minutes');
  console.log('PASS  successful combat wait and its existing cooldown are unchanged');
}
