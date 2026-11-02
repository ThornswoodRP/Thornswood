// test-age-gate.js
//
// Hard eighteen-and-over interstitial on /downloads and /join only. Statement
// and record, never verification. Discord and Bootstrap are not touched here.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
// The gate is in the home page's script, which moved out of home.html into
// home.js in #1479 (no inline script under the content security policy).
const HOME = path.join(ROOT, 'site', 'public', 'home.js');
const RULES = path.join(ROOT, 'site', 'data', 'site', 'rules.md');
const TERMS = path.join(ROOT, 'site', 'data', 'site', 'terms.md');
const CR = String.fromCharCode(13);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const home = fs.readFileSync(HOME, 'utf8').split(CR).join('');
const rules = fs.readFileSync(RULES, 'utf8').split(CR).join('');
const terms = fs.readFileSync(TERMS, 'utf8').split(CR).join('');

yes('age gate helpers exist',
    /var AGE_KEY = 'tw-age-18'/.test(home) &&
    /function ageOk\(\)/.test(home) &&
    /function ageRemember\(\)/.test(home) &&
    /function showAgeGate\(\)/.test(home));
yes('gate paths are only /downloads and /join',
    /var AGE_PATHS = \{ '\/downloads': 1, '\/join': 1 \}/.test(home));
yes('router calls the gate before page bodies',
    /if \(AGE_PATHS\[here\] && !ageOk\(\)\)/.test(home) &&
    /showAgeGate\(\)/.test(home));
yes('remember uses localStorage and a cookie, both with a day and a policy (#2192)',
    /localStorage\.setItem\(AGE_KEY, JSON\.stringify\(\{ v: AGE_POLICY, until: until \}\)\)/.test(home) &&
    /'tw-age-18=' \+ AGE_POLICY \+ '; path=\/; expires='/.test(home));
yes('copy is a statement and a record, not verification',
    /Confirming here is you stating that you are eighteen or older/.test(home) &&
    /kept as a record of what you said, not as verification of your age/.test(home) &&
    !/verif(?:y|ies|ied|ication) your age/i.test(home));
yes('gate names adult content honestly',
    /sexual content between adult characters/.test(home));
yes('gate is not wired for the whole site',
    !/AGE_PATHS\[here\].*\/(?:world|rules|gallery|help)/.test(home) &&
    !/AGE_PATHS = \{[^}]*'\/'/.test(home));
yes('no em dash in the gate copy',
    !/[\u2014\u2013]/.test((home.match(/age-gate[\s\S]{0,1200}/) || [''])[0]));

yes('rules.md has the record-not-verification line',
    /kept as a record of a statement somebody made, not as verification of age/.test(rules));
yes('rules.md still names adult content',
    /sexual content between adult characters/.test(rules));
yes('terms.md Who can be here names adult content',
    /Thornswood contains sexual content between adult characters/.test(terms));
yes('terms.md has the record-not-verification line',
    /kept as a record of a statement somebody made, not as verification of age/.test(terms));
yes('nothing claims age is verified',
    !/verif(?:y|ies|ied) age/i.test(rules + terms + (home.match(/age-gate[\s\S]{0,1200}/) || [''])[0]));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
