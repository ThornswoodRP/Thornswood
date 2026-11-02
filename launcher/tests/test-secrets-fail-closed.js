// test-secrets-fail-closed.js
//
// Issue #1361: Secrets.Protect caught a DPAPI failure and handed the plain
// string back, so a machine where Windows would not encrypt wrote the server
// password, the update token or the Discord ticket into its file in the clear,
// and no line anywhere said it had happened. The comment in that catch said a
// working launcher holding a plaintext password was the better trade.
//
// It is not. Protect is closed now: the refusal goes into launcher.log and the
// exception goes on up, so the caller writes nothing at all.
//
// What this proves, read out of the shipped launcher source:
//   - Protect's catch logs and throws, and returns nothing;
//   - the only thing Protect ever returns unencrypted is a string that was
//     already tagged, and the old fail-open wording is gone;
//   - Unprotect is untouched: still an empty string on failure, never a throw,
//     because an unreadable blob is nothing to recover and the launcher asks
//     for the secret again;
//   - both callers, Config.Save and Discord.Save, still catch and log, so the
//     throw stops the write without stopping the launcher.
//
// Read only.
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// The body between a signature's braces, by brace match, so a rename fails
// here loudly rather than quietly checking nothing.
function body(text, signature) {
  const at = text.indexOf(signature);
  if (at < 0) return '';
  const open = text.indexOf('{', at + signature.length);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(open + 1, i); }
  }
  return '';
}
const noComments = (s) => s.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '');

const src = read('launcher/app/Secrets.cs');
yes('launcher\\app\\Secrets.cs is there', src.length > 0);

const protect = body(src, 'public static string Protect(string plain)');
const unprotect = body(src, 'public static string Unprotect(string stored)');
yes('Protect is in it', protect.length > 0);
yes('Unprotect is in it', unprotect.length > 0);

// ------------------------------------------------------- Protect, closed --
const pCatch = body(protect, 'catch');
yes('Protect still catches the DPAPI failure', pCatch.length > 0);
yes('and says so in the log', /Swallow\.Note\(|File\.AppendAllText\(/.test(noComments(pCatch)));
yes('and names Secrets.Protect in the line, so the log says where',
    /Secrets\.Protect/.test(pCatch));
yes('and then throws', /(^|[^.\w])throw\b/.test(noComments(pCatch)));
yes('the catch returns nothing at all: no plaintext out of a failed encrypt',
    !/\breturn\b/.test(noComments(pCatch)));
yes('the log line carries the exception, not the secret',
    !/\bplain\b/.test(noComments(pCatch)));

// Every return Protect has, in order, with the catch taken out of it.
const rest = noComments(protect).replace(pCatch, '');
const returns = (rest.match(/return[^;]*;/g) || []).map((s) => s.replace(/\s+/g, ' '));
yes('Protect returns in exactly three places (' + returns.join(' / ') + ')', returns.length === 3);
yes('an empty secret is an empty string', returns[0] === 'return "";');
yes('an already tagged secret comes back as it is', returns[1] === 'return plain;' &&
    rest.indexOf('plain.StartsWith(Tag') >= 0 &&
    rest.indexOf('plain.StartsWith(Tag') < rest.indexOf('return plain;'));
yes('and a secret it encrypted comes back tagged', /^return Tag \+ Convert\.ToBase64String\(/.test(returns[2]));
yes('the tagged ciphertext is the only thing the try hands back',
    !/\breturn plain\b/.test(noComments(body(protect, 'try'))));
yes('the fail-open wording is gone', !/Better a working launcher/.test(src) &&
    !/plaintext password/.test(src));
yes('and the class says Protect never hands a secret back unencrypted',
    /Protect never hands a secret back unencrypted/.test(src));

// ----------------------------------------------------- Unprotect, as was --
const uCatch = body(unprotect, 'catch');
yes('Unprotect still catches', uCatch.length > 0);
yes('and still gives back an empty string', /return\s*"";/.test(noComments(uCatch)));
yes('and still never throws', !/(^|[^.\w])throw\b/.test(noComments(uCatch)));
yes('an untagged string still comes back unchanged, so an old plaintext file loads',
    /!stored\.StartsWith\(Tag/.test(unprotect) && /return stored;/.test(unprotect));

// ------------------------------------------- what the throw reaches first --
const save = body(read('launcher/app/Config.cs'), 'public void Save(string path)');
yes('Config.Save protects the update token', save.indexOf('Secrets.Protect(tk)') >= 0);
yes('and it is inside a try that logs, so the throw is a Save that did not happen',
    save.indexOf('try') >= 0 && save.indexOf('try') < save.indexOf('Secrets.Protect(tk)') &&
    /catch \(Exception ex\) \{ Swallow\.Note\("Config\.Save/.test(save));
yes('and the plaintext token is put back in memory either way',
    /finally[\s\S]*UpdateToken = tk;/.test(save));
yes('the file is written after the protect, so nothing is written when it throws',
    save.indexOf('Secrets.Protect(tk)') < save.indexOf('File.WriteAllBytes(path'));

const dSave = body(read('launcher/app/Discord.cs'), 'static void Save(string t, string who, string pic)');
yes('Discord.Save protects the ticket', dSave.indexOf('Secrets.Protect(t ?? "")') >= 0);
yes('and it is the argument to the write, so a throw leaves the ticket file alone',
    /File\.WriteAllText\(TicketFile, Secrets\.Protect\(t \?\? ""\)\)/.test(dSave));
yes('and that write is inside a try that logs',
    dSave.indexOf('try') >= 0 && dSave.indexOf('try') < dSave.indexOf('Secrets.Protect(t ?? "")') &&
    /catch \(Exception ex\) \{ Swallow\.Note\("Discord\.Save"/.test(dSave));

yes('nothing else in the launcher calls Protect',
    fs.readdirSync(path.join(ROOT, 'launcher/app'))
      .filter((n) => /\.cs$/.test(n) && n !== 'Secrets.cs')
      .filter((n) => read('launcher/app/' + n).indexOf('Secrets.Protect') >= 0)
      .sort().join(',') === 'Config.cs,Discord.cs');

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
