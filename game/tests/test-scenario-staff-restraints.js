'use strict';
/* Scenario: systems/voice.md
   Real queued staff commands, native login hook, cold server process and
   first voice update share the same durable restraint authority. */
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks(), yes = t.yes;
const w = standIn.world({ name: '4488-restraint-restart', settings: { thornswoodDevs: [1001] } });
const staff = w.person(0xff004481, { profileId: 1001, name: 'Staff', cell: '3c:Skyrim.esm', pos: [1000, 0, 0] });
const target = w.person(0xff004482, { profileId: 2002, name: 'Bjorn', cell: '3c:Skyrim.esm', pos: [1400, 0, 0] });
yes('whole gamemode loads with durable staff authority', w.boot());
if (!w.loaded()) { t.done(w); } else {
  w.arrive(staff); w.arrive(target); w.run(30000);
  function ask(actor, line) { const before = w.heard(actor).length; w.say(actor, line); return w.heardSince(actor, before).join('\n'); }
  yes('ordinary player cannot acquire staff restraints', /not yours/.test(ask(target, '/freeze 1001')) && !w.box().__thornswoodStaff.state.frozen[1001]);
  yes('queued staff freeze persists its actual native location', /Froze/.test(ask(staff, '/freeze 2002')) && !!w.readPrivate('staff-restraints.json').frozen[2002]);
  yes('queued timed silence persists before confirmation', /Silenced/.test(ask(staff, '/silence 2002 30m')) && !!w.readPrivate('staff-restraints.json').silenced[2002]);
  const book = w.readPrivate('staff-restraints.json'), until = book.silenced[2002].until;
  yes('hot reload retains the saved controls', w.reload() && !!w.box().__thornswoodStaff.state.frozen[2002] && w.box().__thornswoodStaff.state.silenced[2002].until === until);
  const before = w.toVoice.length;
  yes('genuinely cold server restart loads the control file', w.restart().loaded && !!w.box().__thornswoodStaff.state.frozen[2002]);
  const first = w.toVoice.slice(before).find(x => x.path === '/silenced');
  yes('first cold-start voice publication contains the saved silence', first && first.body.profiles[2002] === until);
  yes('cold restart does not extend the original silence', w.box().__thornswoodStaff.state.silenced[2002].until === until);
  yes('a normally restrained character can rejoin under the original login policy', w.arrive(staff) && w.arrive(target));
  w.run(30000);
  yes('the original anti-self-release rule remains', /That is you/.test(ask(staff, '/unfreeze 1001')));
  w.leave(target);
  yes('offline profile-number unsilence still reaches the real queued route', /can speak again/.test(ask(staff, '/unsilence 2002')) && !w.readPrivate('staff-restraints.json').silenced[2002]);
  yes('offline profile-number unfreeze still reaches the real queued route', /can move again/.test(ask(staff, '/unfreeze 2002')) && !w.readPrivate('staff-restraints.json').frozen[2002]);
  yes('another cold restart cannot resurrect released controls', w.restart().loaded && !w.box().__thornswoodStaff.state.frozen[2002] && !w.box().__thornswoodStaff.state.silenced[2002]);
  t.done(w);
}
