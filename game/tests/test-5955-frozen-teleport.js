'use strict';
// A staff freeze prevents self-relocation but another staff member can move it.
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks(), yes = t.yes;
const w = standIn.world({ name: '5955-frozen-teleport', settings: { thornswoodDevs: [201, 202] } });
const FROZEN = w.person(0xff005951, { profileId: 201, name: 'Guide', cell: '3c:Skyrim.esm', pos: [20000, -3000, 0] });
const OTHER = w.person(0xff005952, { profileId: 202, name: 'Keeper', cell: '3c:Skyrim.esm', pos: [30000, -3000, 0] });
yes('the whole gamemode loads', w.boot());
if (!w.loaded()) t.done(w);
[FROZEN, OTHER].forEach(w.arrive);
w.run(30000);
const staff = w.box().__thornswoodStaff;
function at(actor) { const r = w.row(actor); return JSON.stringify([r.worldOrCellDesc, r.pos]); }
function freeze() {
  w.say(OTHER, '/unfreeze Guide');
  w.moveTo(FROZEN, '3c:Skyrim.esm', [20000, -3000, 0]);
  w.say(OTHER, '/freeze Guide checking a report');
}

for (const command of ['/goto Keeper', '/tp Guide whiterun', '/tp whiterun', '/goto whiterun']) {
  freeze();
  const before = at(FROZEN), spot = JSON.stringify(staff.state.frozen[201]);
  const heard = w.heard(FROZEN).length;
  w.say(FROZEN, command);
  yes(command + ' refuses a frozen person\'s own move', /frozen/.test(w.heardSince(FROZEN, heard).join('\n')));
  yes(command + ' preserves the original freeze and position', at(FROZEN) === before && JSON.stringify(staff.state.frozen[201]) === spot);
}

freeze();
{
  const before = w.heard(FROZEN).length;
  staff.command({ proven: false }, '/goto', ['/goto', 'Keeper'], 201, FROZEN, () => true);
  yes('an unproven command is refused before reading the freeze state',
    /proved who you are/.test(w.heardSince(FROZEN, before).join('\n')));
}
w.say(OTHER, '/bring Guide');
yes('another staff member may bring a frozen person', at(FROZEN) === at(OTHER));
yes('bring carries the freeze and its original owner', staff.state.frozen[201].by === 202 &&
  JSON.stringify(staff.state.frozen[201].pos) === JSON.stringify(w.row(OTHER).pos));
w.say(OTHER, '/tp Guide whiterun');
const moved = w.row(FROZEN);
yes('another staff member may teleport the frozen person while keeping the freeze',
  staff.state.frozen[201].desc === moved.worldOrCellDesc &&
  JSON.stringify(staff.state.frozen[201].pos) === JSON.stringify(moved.pos) && staff.state.frozen[201].by === 202);
w.say(OTHER, '/unfreeze Guide');
w.say(FROZEN, '/goto Keeper');
yes('normal self-teleport works again after unfreeze', at(FROZEN) === at(OTHER) && !staff.state.frozen[201]);
t.done(w);
