// test-papyrus-event-list.js
//
//     node game\tests\test-papyrus-event-list.js
//
// records\papyrus-events.json is the fork's Papyrus event list, both halves
// (issue #503): what the client blocker lets through on each person's
// machine, and what the server's own Papyrus machine is sent and can load.
// scripts\dev\PapyrusEventList.js reads it out of the fork and
// scripts\dev\Audit-PapyrusEvents.py judges the load order against it.
//
// THE PIN MOVES OFTEN (tests\test-engine-at-fork-head.js keeps it at the fork's
// head), so this must not stand in the way of engine work that leaves the
// list alone, and must make a change to the list impossible to miss. So the
// record says which fork commit it was read at, and the check is the list,
// not the commit: a pin that moved over fork work that does not touch the
// blocker, the server's sends, its script storage or InitScripts passes; one
// that changes any of them fails, naming what changed and the one command
// that writes the record again.
//
// Four parts.
//   1. The record, against the rest of this repository: its shape; the
//      scripts it says the server loads from data\scripts are the ones
//      records\server-build.json ships there; no deploy script writes an
//      "archives" setting unless the record names one; no Thornswood plugin
//      switches the blocker; and the audit reads the record rather than
//      carrying its own copy of the list.
//   2. The reader, on a small fork made here in a temp git repository: it
//      reads every part of the list; a change outside the list, or to a
//      comment, leaves it the same; each kind of change to the list is a
//      named difference; a shape it does not know stops it.
//   3. The real fork at the pin, read from git's objects at that commit (the
//      engine\skymp submodule, or SKYMP). Without the fork this says SKIP,
//      which is the build on every pull request; THORNSWOOD_FORK_REQUIRED=1,
//      which the nightly sets after fetching the fork at its pin, turns that
//      into a failure, because a check that did not happen is not a pass.
//
// Read only, apart from its own temp folder, which it removes.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const L = require(path.join(REPO, 'scripts', 'dev', 'PapyrusEventList.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function skip(what) { console.log('SKIP  ' + what); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function lower(list) { return (list || []).map(function (s) { return String(s).toLowerCase(); }).sort(); }

// ------------------------------------------------------------ 1. the record --

let rec = null;
try { rec = L.readRecord(); } catch (e) { rec = null; }
yes('records/papyrus-events.json is there and is JSON', !!rec);
if (!rec) { rec = {}; }
const C = rec.client || {}, S = rec.server || {}, LO = S.loads || {};
yes('it names the full fork commit it was read at', /^[0-9a-f]{40}$/.test(String(rec.readAt)));
yes('the client half: the blocker is on, the names it lets through, its exemptions',
    C.blockerOn === true && Array.isArray(C.letsThrough) && C.letsThrough.length > 0 &&
    Array.isArray(C.exemptPrefixes) && Array.isArray(C.exemptNames) &&
    C.exemptPrefixCase === 'kept' && C.exemptNameCase === 'ignored');
yes('the server half: the names it sends, what it attaches to, and what it can load',
    Array.isArray(S.sends) && S.sends.length > 0 && S.attachesTo === 'references' &&
    Array.isArray(LO.builtIn) && LO.builtIn.length > 0 && Array.isArray(LO.dataScripts) && Array.isArray(LO.archives));
yes('every code fingerprint is a sha256',
    [C.blockerFingerprint, C.serviceFingerprint, S.storageFingerprint, S.attachFingerprint]
      .every(function (h) { return /^[0-9a-f]{64}$/.test(String(h)); }));

// What the server build ships in data\scripts is what the record says it loads.
let sb = null;
try { sb = JSON.parse(fs.readFileSync(path.join(REPO, 'records', 'server-build.json'), 'utf8')); } catch (e) { sb = null; }
const shipped = sb && sb.files ? Object.keys(sb.files)
  .filter(function (k) { return /^data\/scripts\/[^/]+\.pex$/i.test(k); })
  .map(function (k) { return k.split('/').pop().replace(/\.pex$/i, ''); }) : null;
yes('the scripts the record says the server loads from data/scripts are the ones records/server-build.json ships there (' +
    (shipped || []).join(', ') + ')', shipped !== null && same(lower(shipped), lower(LO.dataScripts)));

const writers = L.archivesWriters(REPO);
yes('no deploy or installer script writes an "archives" setting, and the record names none' +
    (writers.length ? ' (written at ' + writers.join(', ') + ')' : ''),
    (writers.length === 0) === ((LO.archives || []).length === 0));

const pluginDir = path.join(REPO, 'game', 'plugins');
const switching = fs.existsSync(pluginDir) ? fs.readdirSync(pluginDir).filter(function (f) {
  return /\.js$/.test(f) && /blockPapyrusEvents\s*\(/.test(fs.readFileSync(path.join(pluginDir, f), 'utf8'));
}) : [];
yes('no Thornswood plugin turns the blocker on or off, so the fork alone decides the client half' +
    (switching.length ? ' (' + switching.join(', ') + ')' : ''), switching.length === 0);

const audit = fs.readFileSync(path.join(REPO, 'scripts', 'dev', 'Audit-PapyrusEvents.py'), 'utf8');
yes('Audit-PapyrusEvents.py reads the record', /papyrus-events\.json/.test(audit));
yes('and carries no list of its own: no SKI_, no defaultDisableHavokOnLoad, no server event name in its code',
    !/['"]SKI_['"]/.test(audit) && !/['"]defaultdisablehavokonload['"]/i.test(audit) &&
    !/['"](SkympOnActivateClose|OnTriggerEnter|OnObjectEquipped)['"]/.test(audit));

// ------------------------------------------------- 2. the reader, on a fork --

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-event-list-'));
const FORK = path.join(ROOT, 'fork');
fs.mkdirSync(FORK);
function g(args) {
  return execFileSync('git', ['-C', FORK, '-c', 'user.name=test', '-c', 'user.email=test@thornswood.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false'].concat(args),
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function put(rel, text) {
  const p = path.join(FORK, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
function commit(msg) { g(['add', '-A']); g(['commit', '-q', '-m', msg]); return g(['rev-parse', 'HEAD']); }
g(['init', '-q']);

const BLOCKER = [
  '#include "FridaHooks.h"',
  '// (VMHandle handle, const BSFixedString& eventName, IFunctionArguments* args)',
  'void OnSendEventEnter(GumInvocationContext* ic)',
  '{',
  '  if (Override::IsOverriden()) {',
  '    return;',
  '  }',
  '  auto eventName = (char**)gum_invocation_context_get_nth_argument(ic, 2);',
  '  auto blockEvents = TESModPlatform::GetPapyrusEventsBlocked();',
  '  if (blockEvents && strcmp(*eventName, "OnUpdate") != 0 && vm) {',
  '    for (size_t i = 0; i < scripts.size(); i++) {',
  '      auto name = info->GetName();',
  '      const char* skyui_name = "SKI_"; // start skyui object name',
  '      if (strlen(name) >= 4 && name[0] == skyui_name[0] &&',
  '          name[1] == skyui_name[1] && name[2] == skyui_name[2] &&',
  '          name[3] == skyui_name[3]) {',
  '        blockEvents = false;',
  '      } else if (!stricmp(name, "defaultDisableHavokOnLoad")) {',
  '        blockEvents = false;',
  '      }',
  '    }',
  '  }',
  '  if (blockEvents) {',
  '    static const auto fsEmpty = new FixedString("");',
  '    gum_invocation_context_replace_nth_argument(ic, 2, fsEmpty);',
  '  }',
  '}',
  '',
  'void OnSendEventLeave(GumInvocationContext* ic)',
  '{',
  '  EventsApi::SendPapyrusEventLeave("elsewhere");',
  '}',
  ''].join('\n');
put(L.FILES.blocker, BLOCKER);
put(L.FILES.service, 'export class BlockPapyrusEventsService {\n  onceTick() { this.sp.blockPapyrusEvents(true); }\n}\n');
put(L.FILES.clientIndex, 'const services = [\n  new BlockPapyrusEventsService(sp, controller),\n];\n');
const STORAGE = [
  'void ScriptStorageFactory::AddDirectory(std::vector<X>& storages, json& s)',
  '{',
  '  storages.push_back(std::make_shared<DirectoryScriptStorage>((std::filesystem::path(dataDir) / "scripts").string()));',
  '}',
  'void ScriptStorageFactory::AddBsa(std::vector<X>& storages, json& s)',
  '{',
  '  if (s.contains("archives")) { storages.push_back(std::make_shared<BsaArchiveScriptStorage>(p)); }',
  '}',
  'void ScriptStorageFactory::AddAssets(std::vector<X>& storages, json&)',
  '{',
  '  storages.push_back(std::make_shared<AssetsScriptStorage>());',
  '}',
  'auto all = std::make_shared<CombinedScriptStorage>(storages);',
  ''].join('\n');
put(L.FILES.storage, STORAGE);
put(L.FILES.serverCmake, '# the server\nfile(GLOB_RECURSE standard_scripts\n  ${CMAKE_CURRENT_SOURCE_DIR}/standard_scripts/*\n)\n' +
  'cmrc_add_resource_library(server_standard_scripts ${standard_scripts}\n  NAMESPACE server_standard_scripts\n)\n');
const REFR = [
  'void MpObjectReference::Activate()',
  '{',
  '  SendPapyrusEvent("OnActivate", &arg, 1);',
  '  // SendPapyrusEvent("OnCommentedOut");',
  '}',
  'void MpObjectReference::InitScripts()',
  '{',
  '  for (auto record : { base.rec, refr.rec }) {',
  '    wst->logger->warn("Script \'{}\' not found in the script storage", name);',
  '  }',
  '  if (GetParent()->disableVanillaScriptsInExterior && GetFormId() < 0x05000000) {',
  '    auto kPrefix = "Sweet";',
  '  }',
  '  const bool isRemoveNeeded = !Utils::stricmp(val.data(), "CritterSpawn");',
  '  GetParent()->GetPapyrusVm().AddObject(ToGameObject(), scriptInfo);',
  '}',
  ''].join('\n');
put(L.FILES.refr, REFR);
put(L.FILES.worldState, 'struct WorldState {\n  bool disableVanillaScriptsInExterior = true;\n};\n');
put('skymp5-server/cpp/server_guest_lib/ActionListener.cpp',
  'void A()\n{\n  target->SendPapyrusEvent("OnHit", args.data(), args.size());\n  emitter->SendPapyrusEvent(\n    isEnter ? "OnTriggerEnter" : "OnTriggerLeave", &me, 1);\n}\n');
put('skymp5-server/cpp/server_guest_lib/gamemode_events/PapyrusEventEvent.cpp',
  'void F()\n{\n  worldState->SendPapyrusEvent(form, papyrusEventName, arguments, n);\n}\n');
put('skymp5-server/standard_scripts/form.pex', 'pex');
put('skymp5-server/standard_scripts/objectreference.pex', 'pex');
put('skymp5-scripts/pex/ActiveMagicEffect.pex', 'pex');
put('README.md', 'the fork\n');
const base = commit('base');

let list = null, threw = null;
try { list = L.readList(FORK, base); } catch (e) { threw = e.message; }
yes('the reader reads a fork in the real shape' + (threw ? ' (' + threw + ')' : ''), !!list);
if (list) {
  yes('client: OnUpdate through, SKI_ kept case, defaultDisableHavokOnLoad any case, on, and never blanked during a Skyrim Platform call',
      same(list.client.letsThrough, ['OnUpdate']) && same(list.client.exemptPrefixes, ['SKI_']) &&
      same(list.client.exemptNames, ['defaultDisableHavokOnLoad']) && list.client.blockerOn === true &&
      list.client.neverBlanksDuringASkyrimPlatformCall === true);
  yes('server: every name spelled out in a call, both halves of a choice, none from a comment',
      same(list.server.sends, ['OnActivate', 'OnHit', 'OnTriggerEnter', 'OnTriggerLeave']));
  yes('server: the built in scripts are the standard_scripts files, data/scripts the fork\'s pex folder',
      same(list.server.loads.builtIn, ['form', 'objectreference']) && same(list.server.loads.dataScripts, ['ActiveMagicEffect']));
  yes('server: the scripts it drops by name, and the exterior rule with the flag on',
      same(list.server.dropsByName, ['CritterSpawn']) &&
      same(list.server.exterior, { on: true, formIdBelow: '0x05000000', keepsPrefix: 'Sweet' }));
}
const asRecord = list ? L.build(list, base, []) : null;

// Each change: what to do to the fork, and the field the difference must name
// (null for a change that is not to the list).
function tryChange(what, change, field) {
  g(['checkout', '-q', '--detach', base]);
  change();
  const c = commit(what);
  let got = null, err = null;
  try { got = L.readList(FORK, c); } catch (e) { err = e.message; }
  if (field === 'stops') {
    yes(what + ': the reader stops and says why' + (err ? ' (' + err + ')' : ''), !!err);
    return;
  }
  const diff = got && asRecord ? L.differences(asRecord, got) : null;
  if (field === null) {
    yes(what + ': the same list', !!diff && diff.length === 0);
  } else {
    yes(what + ': a difference naming ' + field + (diff ? ' (' + diff.join(' | ') + ')' : ' (' + err + ')'),
        !!diff && diff.length > 0 && diff.some(function (d) { return d.indexOf(field) === 0; }));
  }
}

tryChange('fork work elsewhere', function () { put('README.md', 'the fork, changed\n'); put('skymp5-server/cpp/server_guest_lib/Other.cpp', 'int x;\n'); }, null);
tryChange('a comment and spacing in the blocker', function () {
  put(L.FILES.blocker, BLOCKER.replace('  auto blockEvents', '  // why\n\n    auto   blockEvents'));
}, null);
tryChange('the blocker lets OnActivate through as well', function () {
  put(L.FILES.blocker, BLOCKER.replace('strcmp(*eventName, "OnUpdate") != 0 &&',
    'strcmp(*eventName, "OnUpdate") != 0 && strcmp(*eventName, "OnActivate") != 0 &&'));
}, 'client.letsThrough');
tryChange('the blocker gains a script it frees', function () {
  put(L.FILES.blocker, BLOCKER.replace('} else if (!stricmp(name, "defaultDisableHavokOnLoad")) {',
    '} else if (!stricmp(name, "defaultDisableHavokOnLoad") || !stricmp(name, "TS_Lever")) {'));
}, 'client.exemptNames');
tryChange('the blocker\'s logic changes with no new name', function () {
  put(L.FILES.blocker, BLOCKER.replace('  if (blockEvents) {', '  if (blockEvents && selfId != 0) {'));
}, 'client.blockerFingerprint');
tryChange('something in the client turns the blocker off', function () {
  put('skymp5-client/src/services/services/other.ts', 'this.sp.blockPapyrusEvents(false);\n');
}, 'client.blockerOn');
tryChange('the server sends OnDeath', function () {
  put('skymp5-server/cpp/server_guest_lib/MpActor.cpp', 'void D()\n{\n  SendPapyrusEvent("OnDeath");\n}\n');
}, 'server.sends');
tryChange('the server build ships a second script in data/scripts', function () {
  put('skymp5-scripts/pex/DefaultLeverScript.pex', 'pex');
}, 'server.loads.dataScripts');
tryChange('InitScripts drops another script', function () {
  put(L.FILES.refr, REFR.replace('!Utils::stricmp(val.data(), "CritterSpawn");',
    '!Utils::stricmp(val.data(), "CritterSpawn") || !Utils::stricmp(val.data(), "Other");'));
}, 'server.dropsByName');
tryChange('the exterior rule is turned off', function () {
  put(L.FILES.worldState, 'struct WorldState {\n  bool disableVanillaScriptsInExterior = false;\n};\n');
}, 'server.exterior');
tryChange('a string in the blocker this cannot place', function () {
  put(L.FILES.blocker, BLOCKER.replace('auto name = info->GetName();', 'auto name = info->GetName(); log("{}", "x");'));
}, 'stops');
tryChange('a SendPapyrusEvent whose name is a variable', function () {
  put('skymp5-server/cpp/server_guest_lib/MpActor.cpp', 'void D()\n{\n  SendPapyrusEvent(someName);\n}\n');
}, 'stops');
tryChange('a script storage this does not know', function () {
  put(L.FILES.storage, STORAGE + 'auto x = std::make_shared<HttpScriptStorage>();\n');
}, 'stops');
tryChange('scripts attached somewhere other than InitScripts', function () {
  put('skymp5-server/cpp/server_guest_lib/Quests.cpp', 'void Q()\n{\n  GetParent()->GetPapyrusVm().AddObject(q, info);\n}\n');
}, 'stops');

yes('a fork folder without the commit is told apart from one with it',
    L.hasCommit(FORK, base) && !L.hasCommit(FORK, '0123456789012345678901234567890123456789') &&
    !L.hasCommit(path.join(ROOT, 'nowhere'), base));

fs.rmSync(ROOT, { recursive: true, force: true });

// ------------------------------------------------- 3. the fork at the pin --

let pin = null;
try { pin = L.pinOf(REPO); } catch (e) { pin = null; }
yes('this checkout names the engine pin', /^[0-9a-f]{40}$/.test(String(pin)));
const fork = L.forkDir(REPO);
const required = process.env.THORNSWOOD_FORK_REQUIRED === '1';
if (pin && L.hasCommit(fork, pin)) {
  let real = null, err = null;
  try { real = L.readList(fork, pin); } catch (e) { err = e.message; }
  yes('the fork at the pin ' + pin.slice(0, 8) + ' reads as a list' + (err ? ' (' + err + ')' : ''), !!real);
  const diff = real ? L.differences(rec, real) : ['not read'];
  yes('records/papyrus-events.json is the fork\'s list at the pin' +
      (rec.readAt && rec.readAt !== pin ? ', read at ' + String(rec.readAt).slice(0, 8) + ' and still the same' : '') +
      (diff.length ? '. It is not:\n        ' + diff.join('\n        ') +
        '\n      Write it again with: node scripts\\dev\\PapyrusEventList.js --write, then rerun the audit for issue #503' : ''),
      diff.length === 0);
} else if (required) {
  yes('the fork is at ' + fork + ' with the pin ' + String(pin).slice(0, 8) + ' (THORNSWOOD_FORK_REQUIRED is set, so not having it is a failure)', false);
} else {
  skip('the fork is not on this machine at the pin, so the record is not read against it here; the nightly fetches it and does');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
