// test-4511-quickloot-file.js
//
// QuickLoot's menu keeps what somebody set, through the one file QuickLoot
// itself reads back. Issue #4511.
//
// WHY. QuickLoot IE keeps every option of its menu in its script and reads
// them back at each session's start from Data\SKSE\Plugins\QuickLootIE\
// DefaultConfig.json, but writes that file only from its Export settings
// button, so with no save every session loaded the defaults. The front plugin
// now writes the file the way that button does when the journal closes:
// QuickLootIEMCM's five ExportSettings_ steps with its own ConfigPath, each
// after the one before has returned, then JsonUtil.Save. Never before
// QuickLoot's own import has run (IsInitialLoad still true), which would put
// its defaults over what was kept. The launcher keeps the file with the
// account's settings.
//
// This lifts the block out of thornswood-front.js and drives it with a
// stand-in Skyrim Platform whose script calls finish when the test says so.
// It also checks the launcher, the site and Ship-Rules name the same file.
//
// Read only.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const FRONT = process.env.FRONT || path.join(ROOT, 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
let failed = 0;
function yes(what, ok) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + what);
  if (!ok) { failed++; }
}

const front = fs.readFileSync(FRONT, 'utf8').split(CR).join('');
const FS = "  // ---------------------------------------------- QuickLoot's own file (#4511)";
const FE = "  // ---------------------------------------------- end QuickLoot's own file";
const a = front.indexOf(FS);
const b = a < 0 ? -1 : front.indexOf(FE, a);
yes('thornswood-front.js has its QuickLoot block', a >= 0 && b > a);
if (a < 0 || b <= a) { throw new Error('the block is not in ' + FRONT); }
const block = front.slice(a, b);

const PATH = '../QuickLootIE/DefaultConfig.json';
const STEPS = ['ExportSettings_General', 'ExportSettings_Display', 'ExportSettings_Sorting',
               'ExportSettings_Controls', 'ExportSettings_Compatibility'];

function world() {
  const w = {
    handlers: {}, props: { IsInitialLoad: true, ConfigPath: PATH }, calls: [], saves: [], pending: [], logs: [],
    questLocal: null, questFile: null, saveSays: true
  };
  w.sp = {
    on: function (name, fn) { (w.handlers[name] = w.handlers[name] || []).push(fn); },
    Game: {
      getFormFromFile: function (local, file) {
        w.questLocal = local; w.questFile = file;
        return { getFormID: function () { return 0xfe000801; } };
      }
    },
    getScriptProperty: function (form, script, prop) {
      if (form !== 0xfe000801 || script !== 'QuickLootIEMCM') { return undefined; }
      return w.props[prop];
    },
    runScriptFunction: function (form, script, fn, args) {
      w.calls.push({ form: form, script: script, fn: fn, args: args });
      return new Promise(function (resolve) { w.pending.push(resolve); });
    },
    callNative: function (cls, fn, self, file, minify) {
      w.saves.push({ cls: cls, fn: fn, self: self, file: file, minify: minify });
      return w.saveSays;
    }
  };
  const make = new Function('sp', 'guard', 'log', 'JOURNAL_MENU', block + '\nreturn { qlieWrite: qlieWrite };');
  w.F = make(w.sp, function (n, f) { return f; }, function () { w.logs.push(Array.prototype.join.call(arguments, ' ')); }, 'Journal Menu');
  w.close = function (name) { (w.handlers.menuClose || []).forEach(function (h) { h({ name: name || 'Journal Menu' }); }); };
  // Finish the oldest call still running, the way the VM says it returned.
  w.finish = async function (ran) {
    const r = w.pending.shift();
    if (r) { r(ran === undefined ? true : ran); }
    for (let i = 0; i < 5; i++) { await Promise.resolve(); }
  };
  w.finishAll = async function () { while (w.pending.length) { await w.finish(true); } };
  return w;
}

(async function main() {
  { // Before QuickLoot's own import has run, nothing is written.
    const w = world();
    w.close();
    yes('a journal closed while IsInitialLoad is still true writes nothing', w.calls.length === 0 && w.saves.length === 0);
    w.props.IsInitialLoad = undefined;
    w.close();
    yes('  nor while it cannot be read', w.calls.length === 0 && w.saves.length === 0);
  }
  { // Once it has, the five steps run one after another, then the save.
    const w = world();
    w.props.IsInitialLoad = false;
    w.close('InventoryMenu');
    yes('another menu closing writes nothing', w.calls.length === 0);
    w.close();
    yes('the menu is found on its quest, MCMQuickLootIE in QuickLootIE.esp', w.questLocal === 1 && w.questFile === 'QuickLootIE.esp');
    yes('the journal closing starts the first step only', w.calls.length === 1 && w.calls[0].fn === STEPS[0]);
    yes('  on QuickLootIEMCM, with the menu\'s own ConfigPath', w.calls[0].script === 'QuickLootIEMCM' &&
        JSON.stringify(w.calls[0].args) === JSON.stringify([PATH]));
    await w.finish(true);
    yes('the next step starts only when the first has returned', w.calls.length === 2 && w.calls[1].fn === STEPS[1]);
    yes('  and nothing is saved before every step has run', w.saves.length === 0);
    await w.finishAll();
    yes('all five steps run, in the order the Export button runs them',
        JSON.stringify(w.calls.map(function (c) { return c.fn; })) === JSON.stringify(STEPS));
    yes('then JsonUtil.Save writes the file, not minified', w.saves.length === 1 && w.saves[0].cls === 'JsonUtil' &&
        w.saves[0].fn === 'Save' && w.saves[0].file === PATH && w.saves[0].minify === false);
    yes('  and ExportSettings itself, which ends in a message box, is never run',
        !w.calls.some(function (c) { return c.fn === 'ExportSettings'; }));
    w.close();
    yes('the next close writes again', w.calls.length === 6 && w.calls[5].fn === STEPS[0]);
  }
  { // A step that does not run saves nothing, and the next close tries again.
    const w = world();
    w.props.IsInitialLoad = false;
    w.close();
    await w.finish(true);
    await w.finish(false);
    yes('a step the VM could not start ends the run with nothing saved', w.saves.length === 0 && w.pending.length === 0 &&
        w.logs.some(function (l) { return /ExportSettings_Display did not run/.test(l); }));
    w.close();
    yes('  and the next close starts over from the first step', w.calls.length === 3 && w.calls[2].fn === STEPS[0]);
  }
  { // A close while a write is running writes once more after it, not twice at once.
    const w = world();
    w.props.IsInitialLoad = false;
    w.close();
    w.close();
    w.close();
    yes('closes during a write start nothing beside it', w.calls.length === 1);
    await w.finishAll();
    yes('  and one more write follows it', w.saves.length === 2 && w.calls.length === 10);
  }
  { // A throw ends the run instead of leaving it stuck.
    const w = world();
    w.props.IsInitialLoad = false;
    w.sp.runScriptFunction = function () { throw new Error('runScriptFunction is not a function'); };
    w.close();
    w.sp.runScriptFunction = function (form, script, fn, args) {
      w.calls.push({ fn: fn });
      return new Promise(function (resolve) { w.pending.push(resolve); });
    };
    w.close();
    yes('a step that throws is logged and the next close can still write', w.calls.length === 1 &&
        w.logs.some(function (l) { return /stopped: runScriptFunction is not a function/.test(l); }));
    w.saveSays = false;
    await w.finishAll();
    yes('a save JsonUtil refuses is logged', w.logs.some(function (l) { return /JsonUtil\.Save did not write/.test(l); }));
  }
  { // No ConfigPath, no write.
    const w = world();
    w.props.IsInitialLoad = false;
    w.props.ConfigPath = '';
    w.close();
    yes('a menu without its ConfigPath writes nothing', w.calls.length === 0 && w.saves.length === 0);
  }

  // The same file everywhere it is named.
  const read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };
  const cs = read('launcher/app/YourSettings.cs');
  yes('the launcher keeps it with the account\'s settings as game/quickloot.json',
      /all\["game\/quickloot\.json"\] = Path\.Combine\(Paths\.Game, "Data\\\\SKSE\\\\Plugins\\\\QuickLootIE\\\\DefaultConfig\.json"\);/.test(cs));
  const ys = require(path.join(ROOT, 'site', 'lib', 'your-settings.js'));
  yes('  and the site keeps that name', ys.nameOk('game/quickloot.json'));
  const rules = read('scripts/release/Ship-Rules.ps1');
  yes('Ship-Rules counts the folder as the machine\'s, so nobody\'s file ships',
      /if \(\$rel\.StartsWith\('Data\\SKSE\\Plugins\\QuickLootIE\\', 'OrdinalIgnoreCase'\)\) \{ return \$true \}/.test(rules));
  yes('the engine calls it needs are declared by the fork', (function () {
    const d = path.join(ROOT, 'engine', 'skymp', 'skyrim-platform', 'src', 'platform_se', 'codegen', 'convert-files', 'skyrimPlatform.ts');
    if (!fs.existsSync(d)) { return true; }
    const t = fs.readFileSync(d, 'utf8');
    return /function runScriptFunction\(/.test(t) && /function getScriptProperty\(/.test(t);
  })());

  console.log(failed ? failed + ' failed' : 'all passed');
  process.exitCode = failed ? 1 : 0;
})();
