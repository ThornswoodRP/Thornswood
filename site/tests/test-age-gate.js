// test-age-gate.js
//
// Hard eighteen-and-over interstitial on /downloads and /join only. Statement
// and record, never verification. Discord and Bootstrap are not touched here.
//
// Two places draw the gate since #4330: the site sends it as the Downloads
// page's body when the browser has no age statement (site/lib/downloads.js),
// and the page's script draws it on /join. This holds both to the same
// words, the same cookie and the same policy number.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
// The gate is in the home page's script, which moved out of home.html into
// home.js in #1479 (no inline script under the content security policy).
const HOME = path.join(ROOT, 'site', 'public', 'home.js');
const DOWNLOADS = path.join(ROOT, 'site', 'lib', 'downloads.js');
const RULES = path.join(ROOT, 'site', 'data', 'site', 'rules.md');
const TERMS = path.join(ROOT, 'site', 'data', 'site', 'terms.md');
const CR = String.fromCharCode(13);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const home = fs.readFileSync(HOME, 'utf8').split(CR).join('');
const site = fs.readFileSync(DOWNLOADS, 'utf8').split(CR).join('');
const rules = fs.readFileSync(RULES, 'utf8').split(CR).join('');
const terms = fs.readFileSync(TERMS, 'utf8').split(CR).join('');

// The gate's markup as each one writes it: the string literals of its body,
// joined, so the two can be compared word for word.
function literals(text) {
  return (text.match(/'(?:[^'\\]|\\.)*'/g) || []).map((s) => s.slice(1, -1)).join('');
}
const homeGate = literals((/function showAgeGate\(\) \{\n  show\(\n([\s\S]*?)\n  \);/.exec(home) || [])[1] || '');
const siteGate = literals((/function ageGateBody\(\) \{\n  return ([\s\S]*?);\n\}/.exec(site) || [])[1] || '');

yes('age gate helpers exist',
    /var AGE_KEY = 'tw-age-18'/.test(home) &&
    /function ageOk\(\)/.test(home) &&
    /function ageRemember\(\)/.test(home) &&
    /function showAgeGate\(\)/.test(home) &&
    /function bindAgeGate\(\)/.test(home));
yes('the page gates /join, and the site gates /downloads (#4330)',
    /var AGE_PATHS = \{ '\/join': 1 \}/.test(home) &&
    /ageStated\(req\) \? downloadsBody\(downloadsFacts\(\)\)\s*: ageGateBody\(\)/.test(
      fs.readFileSync(path.join(ROOT, 'site', 'lib', 'serve.js'), 'utf8')));
yes('router calls the gate before page bodies',
    /if \(AGE_PATHS\[here\] && !ageOk\(\)\)/.test(home) &&
    /showAgeGate\(\)/.test(home));
yes('the site reads the same cookie with the same policy number as the page',
    /const AGE_COOKIE = 'tw-age-18';/.test(site) &&
    (/const AGE_POLICY = (\d+);/.exec(site) || [])[1] === (/var AGE_POLICY = (\d+);/.exec(home) || [])[1] &&
    /'\(\?:\^\|;\\\\s\*\)' \+ AGE_COOKIE \+ '=' \+ AGE_POLICY \+ '\(\?:;\|\$\)'/.test(site) &&
    /'\(\?:\^\|;\\\\s\*\)tw-age-18=' \+ AGE_POLICY \+ '\(\?:;\|\$\)'/.test(home));
yes('the gate the site sends says word for word what the page\'s gate says',
    homeGate.length > 200 && homeGate === siteGate);
yes('the gate the site sends gets its button from the page',
    /if \(document\.getElementById\('ageGate'\)\)[\s\S]{0,400}bindAgeGate\(\)/.test(home) &&
    /id="ageYes"/.test(siteGate));
yes('remember uses localStorage and a cookie, both with a day and a policy (#2192)',
    /localStorage\.setItem\(AGE_KEY, JSON\.stringify\(\{ v: AGE_POLICY, until: until \}\)\)/.test(home) &&
    /'tw-age-18=' \+ AGE_POLICY \+ '; path=\/; expires='/.test(home));
for (const [where, gate] of [['the page', homeGate], ['the site', siteGate]]) {
  yes(where + ': copy is a statement and a record, not verification',
      /Confirming here is you stating that you are eighteen or older/.test(gate) &&
      /kept as a record of what you said, not as verification of your age/.test(gate) &&
      !/verif(?:y|ies|ied|ication) your age/i.test(gate));
  yes(where + ': gate names adult content honestly',
      /sexual content between adult characters/.test(gate));
  yes(where + ': no em dash in the gate copy', !/[\u2014\u2013]/.test(gate));
}
yes('gate is not wired for the whole site',
    !/AGE_PATHS\[here\].*\/(?:world|rules|gallery|help)/.test(home) &&
    !/AGE_PATHS = \{[^}]*'\/'/.test(home));

yes('rules.md has the record-not-verification line',
    /kept as a record of a statement somebody made, not as verification of age/.test(rules));
yes('rules.md still names adult content',
    /sexual content between adult characters/.test(rules));
yes('terms.md Who can be here names adult content',
    /Thornswood contains sexual content between adult characters/.test(terms));
yes('terms.md has the record-not-verification line',
    /kept as a record of a statement somebody made, not as verification of age/.test(terms));
yes('nothing claims age is verified',
    !/verif(?:y|ies|ied) age/i.test(rules + terms + homeGate + siteGate));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
