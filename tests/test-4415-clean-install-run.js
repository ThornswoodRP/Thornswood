/*
  #4415: the clean install checklist describes today's install, not the old one.

  docs/CLEAN-INSTALL-RUN.md was written for the installer from before #4824: a
  black setup console that unpacked a download into a scratch folder with a
  READ ME FIRST.txt, asked one age box, ended waiting for Enter, and was not
  code signed. Since #4824 and #4825 Velopack's signed setup program puts the
  signed launcher down, and the launcher's first start is the Thornswood Setup
  window (launcher/app/InstallWindow.cs): an age box and three boxes for the
  Terms, the Privacy Policy and the Rules lock Install, the steps run in the
  window with nothing to download, and every line goes to Profile\setup-log.txt.
  The list also cited the settled design from the ops repo's CLAUDE.md, which
  no longer holds it; docs/guide/settled-design.md does. And the launcher puts
  Connect Discord after the collection, so the list's rows do too.

  Fails on the old phrases, and on a list that has lost today's. Read only.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const doc = read('docs/CLEAN-INSTALL-RUN.md');
const flat = doc.replace(/\s+/g, ' ');

let pass = 0;
let fail = 0;
function yes(name, ok) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
}

// What the code says today, so a check here cannot outlive the window.
const win = read('launcher/app/InstallWindow.cs');
const agree = read('launcher/app/InstallAgreements.cs');
yes('the setup window is still called Thornswood Setup', /const string Title_ = "Thornswood Setup";/.test(win));
yes('and still locks Install behind the age box and the three agreement boxes',
  /AgeWords = "I am 18 or over\./.test(agree) && /Terms and Conditions/.test(agree) && /Privacy Policy/.test(agree) && /agree to the Rules/.test(agree));
yes('and still writes every line to Profile\\setup-log.txt', /"setup-log\.txt"/.test(win));

// The old installer's phrases.
const OLD = [
  [/setup console/i, 'a setup console'],
  [/black (?:setup )?console/i, 'a black console'],
  [/(?:waited|waits|wait) for Enter/i, 'waiting for Enter'],
  [/download's size|its speed and when it finished/i, 'a download step in the install'],
  [/unpacking count/i, 'an unpacking count'],
  [/Installing from box/i, 'an Installing from box'],
  [/READ ME FIRST/i, 'the scratch folder\'s READ ME FIRST.txt'],
  [/This folder will be read from only/, 'the standalone installer\'s line'],
  [/Nothing is code signed/i, 'an unsigned installer'],
  [/CLAUDE\.md/, 'the settled design cited from CLAUDE.md'],
  [/tick the box that says 18 or over, and press Install/i, 'one age box before Install'],
];
OLD.forEach(function (o) {
  const m = o[0].exec(doc);
  yes('says nothing of ' + o[1] + (m ? ': "' + m[0] + '"' : ''), !m);
});

// Today's install.
yes('points at the Developer Guide\'s settled design section (docs/guide/settled-design.md)', /docs\/guide\/settled-design\.md|docs\\guide\\settled-design\.md/.test(doc));
yes('names the Thornswood Setup window', /Thornswood Setup window/.test(flat));
yes('asks for all four boxes before Install', /Terms and Conditions/.test(flat) && /Privacy Policy/.test(flat) && /Rules/.test(flat) && /18 or over/.test(flat));
yes('reads the install\'s own record, Profile\\setup-log.txt', /setup-log\.txt/.test(doc));
yes('says the setup program and the launcher are signed, and asks for the publisher Windows shows',
  /signed/i.test(flat) && /publisher/i.test(flat) && !/unsigned/i.test(flat));

// The launcher's order: the collection, then Connect Discord.
const coll = doc.search(/^### The collection$/m);
const disc = doc.search(/^### Discord in the launcher$/m);
yes('the run takes the collection before Connect Discord, as the launcher does', coll > 0 && disc > coll);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
