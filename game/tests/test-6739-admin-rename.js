// #6739: admin-only rename changes the saved appearance, not a display alias.
'use strict';
const standIn = require('../../tests/stand-in-server.js');
const fs = require('fs'), path = require('path');
const t = standIn.checks(), yes = t.yes;
for (const server of ['main','dev']) {
console.log('\n'+server+' admin-only renames:');
const fields = actor => ({ profile: w.prop(actor, 'profileId'), appearance: w.prop(actor, 'appearance'),
  inventory: w.prop(actor, 'inventory'), character: w.prop(actor, 'thornswoodCharacter') });
const w = standIn.world({ name: '6739-rename', settings: {
  thornswoodServer: server, thornswoodAdmins: [104], thornswoodDevs: [103], thornswoodPlaytesters: [102]
} });
const ids = [101,102,103,104,105,106].map((profileId,i) => w.person(0xff006730+i, {
  profileId, name: ['Guest','Tester','Helper','Admin','Alia West','Alia East'][i],
  cell: '3c:Skyrim.esm', pos: [20000 + i*10,-3000,0],
  inventory: {entries:[{baseId:15,count:50}]}
}));
const [GUEST,TESTER,HELPER,ADMIN,WEST,EAST] = ids;
yes('whole gamemode loads',w.boot());
if (!w.loaded()) { t.done(w); continue; }
ids.forEach(w.arrive);
w.run(30000);
w.mp().set(ADMIN,'appearance',Object.assign({},w.prop(ADMIN,'appearance'),{
  weight:42.5,skinColor:0x123456,hairColor:0x654321,headpartIds:[1,2],headTextureSetId:3,
  options:[0.1,0.2],presets:[1,2],tints:[{texturePath:'tint.dds',argb:0xff123456,type:1}]
}));
const name = actor => (w.prop(actor,'appearance') || {}).name;
const said = actor => w.heard(actor).at(-1) || '';
const audit = () => w.did.filter(d => d[2] === 'set' && d[3] === 'appearance');
const records = () => {
  try { return fs.readFileSync(path.join(w.dir,'for-bot','moderation.log'),'utf8').trim().split('\n').map(JSON.parse).filter(r => r.did === 'rename'); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
};
function rename(by,text) {
  w.say(by,text);
}

for (const actor of [GUEST,TESTER,HELPER]) {
  const original = name(actor), target = name(GUEST), writes = audit().length;
  rename(actor,'/rename self Forbidden Name');
  yes('non-admin '+w.prop(actor,'profileId')+' cannot rename self',name(actor) === original && /not yours/.test(said(actor)));
  rename(actor,'/rename Guest Forbidden Name');
  yes('non-admin '+w.prop(actor,'profileId')+' cannot rename another character',name(GUEST) === target && audit().length === writes);
}

const before = fields(ADMIN);
rename(ADMIN,'/rename self  Björn  O’Rían-Snow.  ');
yes('admin can rename self with spaces, Unicode and allowed punctuation',name(ADMIN) === 'Björn O’Rían-Snow.');
const after = fields(ADMIN);
delete before.appearance.name; delete after.appearance.name;
yes('self rename preserves all other appearance, inventory, profile and character fields',JSON.stringify(before) === JSON.stringify(after));
yes('the persisted roster is refreshed to the same profile and new name',
  !!w.readPrivate('characters.json') && w.readPrivate('characters.json').who['104'].name === 'Björn O’Rían-Snow.');
w.run(2000);
const near = w.prop(GUEST,'thornswoodNear');
yes('another observer receives the renamed character in the real nearby view',
  !!near && JSON.stringify(near).includes('Björn O’Rían-Snow.'));
const selfAudit = w.logged(/staff: Admin \(profile 104\) rename Admin \(profile 104\)/);
yes('self rename audits the requestor and target under their names before the write',selfAudit.length === 1);
const row = records()[0];
yes('one successful rename records old/new names and unchanged character/profile',!!row && row.byName === 'Admin' &&
  row.whoName === 'Admin' && row.oldName === 'Admin' && row.newName === 'Björn O’Rían-Snow.' &&
  row.by === 104 && row.who === 104 && row.character === ADMIN.toString(16));

const oldGuest = fields(GUEST);
rename(ADMIN,'/rename Guest E\u0301lan Ash');
yes('admin can rename another character and normalizes NFC explicitly',name(GUEST) === 'Élan Ash');
const newGuest = fields(GUEST);
delete oldGuest.appearance.name; delete newGuest.appearance.name;
yes('another character rename changes no identity or other saved fields',JSON.stringify(oldGuest) === JSON.stringify(newGuest));
yes('both admin and target receive the successful rename',/renamed/i.test(said(ADMIN)) && /Élan Ash/.test(said(GUEST)));

for (const invalid of ['', 'A'.repeat(61), '<Admin>', 'Name\u202eabc', 'Name\u200babc', 'Name\nOther', 'Name\tOther', 'Name\u0000Other', '...', 'Name😀']) {
  const previous = name(ADMIN), writes = audit().length;
  rename(ADMIN,'/rename self '+invalid);
  yes('invalid name is refused: '+JSON.stringify(invalid),name(ADMIN) === previous && audit().length === writes && !/^Renamed/.test(said(ADMIN)));
}
rename(ADMIN,'/rename self '+ 'A'.repeat(60));
yes('exactly sixty visible characters are accepted',name(ADMIN) === 'A'.repeat(60));
rename(ADMIN,'/rename Alia New Name');
yes('ambiguous target is refused rather than choosing one',name(WEST) === 'Alia West' && name(EAST) === 'Alia East' && /More than one/.test(said(ADMIN)));
rename(ADMIN,'/rename Missing New Name');
yes('unknown target is refused clearly',/Nobody/.test(said(ADMIN)));
w.leave(EAST);
rename(ADMIN,'/rename 106 Not Online');
yes('an offline profile cannot be renamed through an unrelated live actor',name(EAST) === 'Alia East' && /not in the world/.test(said(ADMIN)));
w.arrive(EAST);
rename(ADMIN,'/rename '+w.prop(WEST,'profileId')+' Élan Ash');
yes('duplicate existing names remain allowed and profiles still distinguish characters',name(WEST) === name(GUEST) && w.prop(WEST,'profileId') !== w.prop(GUEST,'profileId'));

const feature = w.box().__thornswoodRename;
if (feature) {
  const previous = name(ADMIN), writes = audit().length;
  feature.command({text:'/rename self Forged',proven:false},'/rename',['/rename','self','Forged'],104,ADMIN);
  yes('an admin role without connection proof cannot rename',name(ADMIN) === previous && /proved/.test(said(ADMIN)));
  feature.command({text:'/rename self Forged',proven:true},'/rename',['/rename','self','Forged'],104,GUEST);
  yes('an admin cannot supply another actor as their own identity',name(ADMIN) === previous && name(GUEST) === 'Élan Ash');
  const pass = w.box().__thornswoodPassSeen.passes[104];
  delete w.box().__thornswoodPassSeen.passes[104];
  feature.command({text:'/rename self Forged',proven:true},'/rename',['/rename','self','Forged'],104,ADMIN);
  yes('a proven admin without a current launcher pass cannot rename',name(ADMIN) === previous && /launcher.s pass/.test(said(ADMIN)) && audit().length === writes);
  w.box().__thornswoodPassSeen.passes[104] = pass;
  const originalSet = w.mp().set;
  w.mp().set = function(actor,property,value) { if (property === 'appearance') throw new Error('write refused'); return originalSet(actor,property,value); };
  const logs = records().length;
  rename(ADMIN,'/rename self Not Saved');
  yes('a failed appearance write cannot report or audit success',name(ADMIN) === previous && /could not.*rename/i.test(said(ADMIN)) && records().length === logs);
  w.mp().set = originalSet;
} else yes('rename module is registered for direct authorization checks',false);

const wanted = 'Élan Ash', wantedProfile = w.prop(GUEST,'profileId');
w.say(ADMIN,'/rename self Routed Name');
yes('the actual chat router dispatches the registered rename command',name(ADMIN) === 'Routed Name');
w.leave(GUEST); w.arrive(GUEST); w.run(2000);
yes('reconnecting keeps the saved name on the same character and profile',name(GUEST) === wanted && w.prop(GUEST,'profileId') === wantedProfile);
w.restart(); ids.forEach(w.arrive); w.run(5000);
yes('a server restart keeps the renamed appearance and roster',name(GUEST) === wanted && w.readPrivate('characters.json').who[String(wantedProfile)].name === wanted);
t.done(w);
}
