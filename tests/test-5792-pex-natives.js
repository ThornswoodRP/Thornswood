// test-5792-pex-natives.js
//
//     node tests/test-5792-pex-natives.js
//
// WHY THIS EXISTS. #5792: #5035 needs the collection's calls to native
// functions held to what the fork registers, sorted into its four groups.
// scripts/mods/Compare-PexNatives.js does that from scripts.json
// (Read-PexCalls.js, #7000) and a SkyMP clone. The collection's scripts are
// their authors' and the fork is large, so this makes a stand-in of each.
//
// What it checks:
//   1. the fork's side: a class's GetName literal, a shared base's names from
//      its constructors, AddMethod and AddStatic over one line or two, the
//      file and line of each registration and implementation, a body marked
//      a stub, one that says it is not implemented, and one that only
//      returns a stub;
//   2. the groups: SKI_ConfigBase up the chain, RaceMenuBase, a call to
//      Game.ShowRaceMenu, ActiveMagicEffect, a call from OnEquipped, and
//      every other script in world mechanics, each with its rule;
//   3. the comparison: implemented, stub and missing by the declaring
//      script; an unsettled call kept unresolved with its reason, with the
//      fork's registration on its type when there is one; a copy the game
//      does not take left out; every caller kept;
//   4. the command: it writes natives.json and natives.md, and refuses a
//      file that is not scripts.json, writing nothing.
//
// Exits 1 when any check fails. Writes only in its own temp folder.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const TOOL = path.join(repo, 'scripts', 'mods', 'Compare-PexNatives.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

if (!fs.existsSync(TOOL)) {
  yes('scripts/mods/Compare-PexNatives.js is there', false);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}
const C = require(TOOL);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-5792-'));
try {
  // ---- a stand-in fork
  const fork = path.join(tmp, 'skymp');
  const dir = path.join(fork, 'skymp5-server', 'cpp', 'server_guest_lib', 'script_classes');
  fs.mkdirSync(dir, { recursive: true });
  const put = function (f, t) { fs.writeFileSync(path.join(dir, f), t); };
  put('PapyrusGame.h', [
    '#pragma once',
    'class PapyrusGame final : public IPapyrusClass<PapyrusGame>',
    '{',
    'public:',
    '  const char* GetName() override { return "Game"; }',
    '};', ''].join('\n'));
  put('PapyrusGame.cpp', [
    '#include "PapyrusGame.h"',
    'VarValue PapyrusGame::GetPlayer(VarValue self,',
    '                                const std::vector<VarValue>& arguments)',
    '{',
    '  return VarValue(1);',
    '}',
    '',
    'void PapyrusGame::Register(',
    '  VirtualMachine& vm, std::shared_ptr<IPapyrusCompatibilityPolicy> policy)',
    '{',
    '  AddStatic(vm, "GetPlayer", &PapyrusGame::GetPlayer);',
    '}', ''].join('\n'));
  put('PapyrusQuest.h', 'class PapyrusQuest final : public IPapyrusClass<PapyrusQuest>\n{\npublic:\n  const char* GetName() override { return "Quest"; }\n};\n');
  put('PapyrusQuest.cpp', [
    'VarValue PapyrusQuest::GetStage(VarValue self,',
    '                                const std::vector<VarValue>& arguments)',
    '{',
    '  return GetCurrentStageID(self, arguments);',
    '}',
    '',
    'VarValue PapyrusQuest::GetCurrentStageID(',
    '  VarValue self, const std::vector<VarValue>& arguments)',
    '{',
    '  spdlog::warn("GetCurrentStageID - Not implemented, returning 0");',
    '  return VarValue(0);',
    '}',
    '',
    'void PapyrusQuest::Register(',
    '  VirtualMachine& vm, std::shared_ptr<IPapyrusCompatibilityPolicy> policy)',
    '{',
    '  AddMethod(vm, "GetStage", &PapyrusQuest::GetStage);',
    '  AddMethod(vm, "GetCurrentStageID", &PapyrusQuest::GetCurrentStageID);',
    '}', ''].join('\n'));
  put('PapyrusObjectReference.h', 'class PapyrusObjectReference final : public IPapyrusClass<PapyrusObjectReference>\n{\npublic:\n  const char* GetName() override { return "ObjectReference"; }\n};\n');
  put('PapyrusObjectReference.cpp', [
    'VarValue PapyrusObjectReference::Disable(VarValue self,',
    '                                         const std::vector<VarValue>& arguments)',
    '{',
    '  if (auto r = GetFormPtr<MpObjectReference>(self)) { r->Disable(); }',
    '  return VarValue::None();',
    '}',
    '',
    'VarValue PapyrusObjectReference::Is3DLoaded(VarValue,',
    '                                            const std::vector<VarValue>&)',
    '{',
    '  // stub',
    '  return VarValue(true);',
    '}',
    '',
    'void PapyrusObjectReference::Register(',
    '  VirtualMachine& vm, std::shared_ptr<IPapyrusCompatibilityPolicy> policy)',
    '{',
    '  AddMethod(vm, "Disable", &PapyrusObjectReference::Disable);',
    '  AddMethod(vm, "Is3DLoaded",',
    '            &PapyrusObjectReference::Is3DLoaded);',
    '}', ''].join('\n'));
  put('PapyrusLeveledBase.h', 'class PapyrusLeveledBase : public IPapyrusClass<PapyrusLeveledBase>\n{\npublic:\n  PapyrusLeveledBase(const std::string& name);\n  const char* GetName() override { return strName.c_str(); }\n};\n');
  put('PapyrusLeveledBase.cpp', [
    'VarValue PapyrusLeveledBase::GetNthForm(VarValue self,',
    '                                        const std::vector<VarValue>& arguments)',
    '{',
    '  return VarValue::None();',
    '}',
    '',
    'void PapyrusLeveledBase::Register(',
    '  VirtualMachine& vm, std::shared_ptr<IPapyrusCompatibilityPolicy> policy)',
    '{',
    '  AddMethod(vm, "GetNthForm", &PapyrusLeveledBase::GetNthForm);',
    '}', ''].join('\n'));
  put('PapyrusLeveledItem.h', 'class PapyrusLeveledItem final : public PapyrusLeveledBase\n{\npublic:\n  PapyrusLeveledItem()\n    : PapyrusLeveledBase("LeveledItem")\n  {\n  }\n};\n');
  put('PapyrusLeveledActor.h', 'class PapyrusLeveledActor final : public PapyrusLeveledBase\n{\npublic:\n  PapyrusLeveledActor()\n    : PapyrusLeveledBase("LeveledActor")\n  {\n  }\n};\n');

  // ---- 1. the fork's side
  const F = C.readFork(fork);
  const fn = function (cls, f) { const c = F.classes[cls.toLowerCase()]; return c && c.fns[f.toLowerCase()]; };
  const SC = 'skymp5-server/cpp/server_guest_lib/script_classes/';
  yes('a GetName literal names the class (Game.GetPlayer, static)', !!fn('Game', 'GetPlayer') && fn('Game', 'GetPlayer').kind === 'static');
  yes('  with the line of its registration and of its implementation',
    fn('Game', 'GetPlayer').registered === SC + 'PapyrusGame.cpp:11' && fn('Game', 'GetPlayer').implemented === SC + 'PapyrusGame.cpp:2');
  yes('a shared base is registered under each name a constructor gives it',
    !!fn('LeveledItem', 'GetNthForm') && !!fn('LeveledActor', 'GetNthForm') && fn('LeveledItem', 'GetNthForm').implemented === SC + 'PapyrusLeveledBase.cpp:1');
  yes('a registration over two lines is read', !!fn('ObjectReference', 'Is3DLoaded') && fn('ObjectReference', 'Is3DLoaded').registered === SC + 'PapyrusObjectReference.cpp:19');
  yes('a body marked // stub is a stub', /stub/.test(fn('ObjectReference', 'Is3DLoaded').stub || ''));
  yes('a body that says it is not implemented is a stub', /not implemented/.test(fn('Quest', 'GetCurrentStageID').stub || ''));
  yes('a body that only returns a stub is a stub, naming it', /GetCurrentStageID/.test(fn('Quest', 'GetStage').stub || ''));
  yes('a working body is not', !fn('ObjectReference', 'Disable').stub && !fn('Game', 'GetPlayer').stub);
  yes('no body text is kept', JSON.stringify(F).indexOf('spdlog') < 0 && JSON.stringify(F).indexOf('GetFormPtr') < 0);

  // ---- 2 and 3. a scripts.json
  const row = function (o) { return Object.assign({ path: 'Data\\Scripts\\' + o.object + '.pex', inner: '', sha256: 'x', fileId: 100, mod: 'Mod A', taken: true, declaresNative: [], natives: [], unsettled: [] }, o); };
  const doc = {
    schema: 1, collection: { slug: 'abc', revision: 3 }, counts: { scripts: 9 },
    scripts: [
      row({ object: 'SKI_ConfigBase', parent: 'SKI_QuestBase' }),
      row({ object: 'MyMenu', parent: 'SKI_ConfigBase', mod: 'Menu Mod', fileId: 1,
        natives: [['.OnPageReset', 4, 'method', 'Quest', 'GetStage', 'Quest']],
        unsettled: [['.OnPageReset', 9, 'static', 'Debug', 'Notification', 'no script of Debug in the collection']] }),
      row({ object: 'MyRaceHelper', parent: 'Quest', mod: 'Chargen Mod', fileId: 2,
        natives: [['.OnInit', 1, 'static', 'Game', 'ShowRaceMenu', 'Game']] }),
      row({ object: 'MyPresets', parent: 'RaceMenuBase', mod: 'Chargen Mod', fileId: 2,
        unsettled: [['.OnStartup', 0, 'method', 'RaceMenuBase', 'AddSlider', 'no script of RaceMenuBase in the collection']] }),
      row({ object: 'MyFireEffect', parent: 'ActiveMagicEffect', mod: 'Spell Mod', fileId: 3,
        natives: [['.OnEffectStart', 2, 'method', 'ObjectReference', 'Is3DLoaded', 'ObjectReference']] }),
      row({ object: 'MyRing', parent: 'ObjectReference', mod: 'Item Mod', fileId: 4,
        natives: [['.OnEquipped', 3, 'method', 'ObjectReference', 'Disable', 'ObjectReference']] }),
      row({ object: 'MyLever', parent: 'ObjectReference', mod: 'World Mod', fileId: 5,
        natives: [['.OnActivate', 5, 'method', 'ObjectReference', 'Disable', 'ObjectReference'],
          ['.OnActivate', 7, 'method', 'MyLever', 'Disable', 'ObjectReference'],
          ['.OnActivate', 8, 'method', 'Actor', 'SetGhost', 'Actor'],
          ['.OnActivate', 9, 'method', 'LeveledItem', 'GetNthForm', 'LeveledItem']],
        unsettled: [['.OnActivate', 11, 'method', 'Quest', 'SetStage', 'SetStage is declared by no script Quest extends in the collection'],
          ['.OnActivate', 12, 'static', 'JMap', 'object', 'no script of JMap in the collection']] }),
      row({ object: 'MyLever', parent: 'ObjectReference', mod: 'Old Mod', fileId: 6, taken: false,
        natives: [['.OnActivate', 1, 'method', 'Game', 'QuitToMainMenu', 'Game']] }),
      row({ object: 'Broken', error: 'not a compiled script', taken: false })
    ]
  };
  const inv = C.compare(doc, F);
  const G = function (n) { return inv.groups.filter(function (g) { return g.group === n; })[0]; };
  const script = function (n, s) { return G(n).scripts.filter(function (x) { return x.script === s; })[0]; };
  const nat = function (n, s) { return G(n).natives.filter(function (x) { return x.native === s; })[0]; };
  const unr = function (n, s) { return G(n).unresolved.filter(function (x) { return x.call === s; })[0]; };
  yes('the four groups of #5035, in order', inv.groups.map(function (g) { return g.group; }).join('|') === 'mod setup menus|character creation helpers|spell and item scripts|world mechanics');
  yes('SKI_ConfigBase up the chain is a mod setup menu', script('mod setup menus', 'MyMenu') && script('mod setup menus', 'MyMenu').rule === 'extends SKI_ConfigBase');
  yes('a call to Game.ShowRaceMenu is a character creation helper', script('character creation helpers', 'MyRaceHelper') && script('character creation helpers', 'MyRaceHelper').rule === 'calls Game.ShowRaceMenu');
  yes('so is a script extending RaceMenuBase', script('character creation helpers', 'MyPresets') && script('character creation helpers', 'MyPresets').rule === 'extends RaceMenuBase');
  yes('ActiveMagicEffect is a spell script', script('spell and item scripts', 'MyFireEffect') && script('spell and item scripts', 'MyFireEffect').rule === 'extends ActiveMagicEffect');
  yes('a call from OnEquipped is an item script', script('spell and item scripts', 'MyRing') && script('spell and item scripts', 'MyRing').rule === 'calls from OnEquipped');
  yes('every other script is world mechanics', script('world mechanics', 'MyLever') && script('world mechanics', 'MyLever').rule === 'none of the rules above');
  yes('a script with no native call is in no group', !inv.groups.some(function (g) { return g.scripts.some(function (x) { return x.script === 'SKI_ConfigBase'; }); }));
  yes('a copy the game does not take is left out, and counted', !nat('world mechanics', 'Game.QuitToMainMenu') && inv.notTaken === 2 && G('world mechanics').scripts.length === 1);
  const dis = nat('world mechanics', 'ObjectReference.Disable');
  yes('a call is held to the script that declares it (MyLever.Disable is ObjectReference.Disable), every caller kept',
    dis && dis.state === 'implemented' && dis.callers.length === 2 && JSON.stringify(dis.callers[0]) === JSON.stringify(['World Mod', 5, 'MyLever', '.OnActivate', 5]));
  yes('  with the fork\'s file and line', dis.implemented === SC + 'PapyrusObjectReference.cpp:1' && dis.registered === SC + 'PapyrusObjectReference.cpp:18');
  yes('a native the fork does not register is missing, saying so', nat('world mechanics', 'Actor.SetGhost') && nat('world mechanics', 'Actor.SetGhost').state === 'missing' && /registers no SetGhost on Actor/.test(nat('world mechanics', 'Actor.SetGhost').why));
  yes('a shared base\'s name is found (LeveledItem.GetNthForm)', nat('world mechanics', 'LeveledItem.GetNthForm') && nat('world mechanics', 'LeveledItem.GetNthForm').state === 'implemented');
  yes('a registered stub is a stub, not implemented', nat('spell and item scripts', 'ObjectReference.Is3DLoaded').state === 'stub' && nat('mod setup menus', 'Quest.GetStage').state === 'stub');
  const ss = unr('world mechanics', 'Quest.SetStage');
  yes('an unsettled call stays unresolved, with scripts.json\'s reason', ss && ss.state === 'unresolved' && /declared by no script Quest extends/.test(ss.why) && ss.fork === null);
  const dn = unr('mod setup menus', 'Debug.Notification');
  yes('  with no fork registration when the fork has none on the type', dn && dn.fork === null);
  const jm = unr('world mechanics', 'JMap.object');
  yes('  and a mod library call (JMap) the same way', jm && jm.state === 'unresolved' && /no script of JMap/.test(jm.why));
  doc.scripts[1].unsettled.push(['.OnPageReset', 10, 'static', 'Game', 'GetPlayer', 'no script of Game in the collection']);
  const gp = unr('mod setup menus', 'Game.GetPlayer') || C.compare(doc, F).groups[0].unresolved.filter(function (x) { return x.call === 'Game.GetPlayer'; })[0];
  yes('  and the fork\'s registration on the type called, when it has one, still unresolved', gp && gp.state === 'unresolved' && gp.fork && gp.fork.implemented === SC + 'PapyrusGame.cpp:2');
  const all = C.compare(doc, F);
  yes('the counts add up per group', all.groups[3].counts.implementedCalls === 3 && all.groups[3].counts.missingCalls === 1 && all.groups[3].counts.unresolvedCalls === 2 && all.groups[0].counts.stubCalls === 1 && all.groups[0].counts.unresolvedCalls === 2);

  // ---- 4. the command
  const sj = path.join(tmp, 'scripts.json');
  fs.writeFileSync(sj, JSON.stringify(doc));
  const out = path.join(tmp, 'out');
  const r = spawnSync(process.execPath, [TOOL, '--scripts', sj, '--fork', fork, '--out', out], { encoding: 'utf8' });
  yes('the command exits 0 and writes natives.json and natives.md', r.status === 0 && fs.existsSync(path.join(out, 'natives.json')) && fs.existsSync(path.join(out, 'natives.md')));
  const md = fs.existsSync(path.join(out, 'natives.md')) ? fs.readFileSync(path.join(out, 'natives.md'), 'utf8') : '';
  yes('  natives.md has a section per group and the rows with their state', GROUPS_IN(md) && /\| Actor\.SetGhost \| missing/.test(md) && /\| JMap\.object \| unresolved: no script of JMap/.test(md) && /\| Quest\.GetStage \| stub: /.test(md));
  fs.writeFileSync(path.join(tmp, 'other.json'), '{"schema":2}');
  const out2 = path.join(tmp, 'out2');
  const r2 = spawnSync(process.execPath, [TOOL, '--scripts', path.join(tmp, 'other.json'), '--fork', fork, '--out', out2], { encoding: 'utf8' });
  yes('a file that is not scripts.json is refused, writing nothing', r2.status === 1 && /not a scripts\.json/.test(r2.stdout) && !fs.existsSync(out2));
  const r3 = spawnSync(process.execPath, [TOOL, '--scripts', sj, '--fork', tmp, '--out', out2], { encoding: 'utf8' });
  yes('a folder that is not a SkyMP clone is refused, writing nothing', r3.status === 1 && /not a SkyMP clone/.test(r3.stdout) && !fs.existsSync(out2));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function GROUPS_IN(md) {
  return ['mod setup menus', 'character creation helpers', 'spell and item scripts', 'world mechanics'].every(function (g) { return md.indexOf('### ' + g) >= 0; });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
