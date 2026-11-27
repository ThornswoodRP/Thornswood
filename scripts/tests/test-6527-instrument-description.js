/* #6527: the instrument recipes made Content builds stop before publication.
   Exercise the real record constructor and header description without game
   masters or a running service. No plugin or game file is written. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const tool = path.join(__dirname, '..', 'mods', 'Add-ContentRecords.py');
const probe = `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('acr', sys.argv[1])
acr = importlib.util.module_from_spec(spec); spec.loader.exec_module(acr)
records = acr.thornswood_records(acr.clam01(), [])
keys = [r.tag.decode() + ' ' + r.editor_id() for r in records]
instruments = [k for k in keys if k.startswith('COBJ ThornswoodRecipeInstrument')]
full = keys + ['COBJ RecipeWeaponIronBow', 'COBJ BYOHRecipeNails', 'COBJ RecipeIngotDwarvenScrap01']
def describe(ks):
    text, unnamed = acr.description_of(ks)
    return {'text': text.decode('ascii'), 'unnamed': unnamed, 'bytes': len(text) + 1}
print(json.dumps({'instruments': instruments, 'full': describe(full),
    'single': [describe(['KYWD ThornswoodCraftingWoodworking', k]) for k in instruments],
    'without': describe([k for k in full if k not in instruments]),
    'unknown': describe(keys + ['COBJ ThornswoodRecipeInstrumentUnknown']),
    'limit': acr.DESCRIPTION_MOST}))
`;
let result;
for (const exe of ['python', 'py', 'python3']) {
  result = spawnSync(exe, ['-I', '-c', probe, tool], { encoding: 'utf8' });
  if (!result.error) break;
}
assert.equal(result.status, 0, result.stderr || String(result.error));
const out = JSON.parse(result.stdout);
let pass = 0, fail = 0;
function check(label, condition) {
  if (condition) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label); }
}
check('the production constructor makes exactly the four instrument recipes (the horn, #7167)',
  out.instruments.sort().join(',') === ['Drum', 'Flute', 'Horn', 'Lute'].map(n => 'COBJ ThornswoodRecipeInstrument' + n).join(','));
for (let i = 0; i < out.single.length; i++) {
  check('instrument recipe ' + i + ' is explicitly described',
    out.single[i].unnamed.length === 0 && out.single[i].text.includes('instruments'));
}
check('all constructed record families and the existing master overrides are described', out.full.unnamed.length === 0);
check('the full description names instruments only once', (out.full.text.match(/instruments/g) || []).length === 1);
check('the complete header remains within the existing 512-byte limit', out.limit === 512 && out.full.bytes <= out.limit);
check('removing all instrument recipes removes their description', !out.without.text.includes('instruments'));
check('an unknown instrument recipe is still refused',
  out.unknown.unnamed.length === 1 && out.unknown.unnamed[0] === 'COBJ ThornswoodRecipeInstrumentUnknown');
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;

