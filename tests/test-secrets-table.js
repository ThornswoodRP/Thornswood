// test-secrets-table.js
//
// The secrets table in the Developer Guide (docs/guide/secrets.md) says what each credential actually
// protects, and says not enforced where nothing checks it.
//
// WHY THIS EXISTS. The table's first row said the game server had a password,
// sPassword in server-settings.json, handed to the launcher by the site at
// check in. The script that manages that password,
// scripts\deploy\Rotate-ServerPassword.ps1, said the opposite in its own header: SkyMP
// has no join password, and it stopped touching the game server "because
// there was nothing to write there". The door key row named data\door.json
// while the gamemode reads private\door.json. The heading said none of them
// was in the repo while a row named a file inside bot. A table like
// that is read by the next person as a list of controls that exist.
//
// From the To Do List: "A secrets inventory lists each credential, where it
// lives, what it actually protects and who can reissue it, and says not
// enforced where a control does not exist rather than listing it as though it
// did."
//
// So this reads that section and holds each claim against the code it names:
// the four questions are the columns, the join password row says not enforced
// and the code still agrees, every script it names is in tools, every repo
// path it names is ignored by git, every VPS path it names is one a script
// uses, and nothing in it looks like a value. When the code changes under a
// row, this fails and says which row to rewrite.
//
// Read only. It reads the doc and the source, never a secret file.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const siteFiles = require('./site-files');

const ROOT = REPO_DIR;
const CR = String.fromCharCode(13);
const BS = String.fromCharCode(92);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').split(CR).join(''); }
  catch (e) { return ''; }
}

// ------------------------------------------------------------ the section ---
// The table is the guide's page docs/guide/secrets.md, and the page is the
// section. The rest of the guide is read whole (tests/guide-text.js) for the
// lines about it elsewhere.
const doc = require('./guide-text.js').whole();
const page = read('docs/guide/secrets.md');
yes('docs/guide/secrets.md is there to read', page.length > 0);

const head = page.match(/^# Secrets\b.*$/m);
yes('the page is titled as the secrets section', !!head && head.index === 0);
const section = head ? page : '';

// The heading used to promise none of them was in the repo, over a row that
// named bot\news-webhook.txt. Ignored by git is not the same thing.
const namesRepoPath = section.indexOf('`tools' + BS) >= 0;
yes('the heading does not say none of them is in the repo while a row names a file in it',
    !(namesRepoPath && /none of them in the repo/i.test(head ? head[0] : '')));

// ---------------------------------------------------------------- the table ---
function cells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
}
const tableLines = section.split('\n').filter(function (l) { return /^\|/.test(l.trim()); });
const header = tableLines.length ? cells(tableLines[0]) : [];
const rows = tableLines.slice(2).map(cells);

yes('the table asks the four questions: the secret, where it lives, what it actually protects, who reissues it',
    header.length === 4 &&
    /^secret$/i.test(header[0]) &&
    /^where it lives$/i.test(header[1]) &&
    /^what it actually protects$/i.test(header[2]) &&
    /^who reissues it$/i.test(header[3]));
yes('the table has a row for each credential, ' + rows.length + ' of them', rows.length >= 12);
const ragged = rows.filter(function (r) { return r.length !== 4 || r.some(function (c) { return c.length === 0; }); });
ragged.forEach(function (r) { console.log('      a row without four answers: ' + r[0]); });
yes('every row answers all four', rows.length > 0 && ragged.length === 0);

function row(re) {
  for (let i = 0; i < rows.length; i++) { if (re.test(rows[i][0])) return rows[i]; }
  return null;
}
const want = [
  ['the join password', /server password/i],
  ['the site member password', /member password/i],
  ['the site botKey', /botKey/],
  ['the site secret', /^Site `secret`$/],
  ['the Discord client secret', /client secret/i],
  ['the Discord bot token', /bot token/i],
  ['the #news webhook', /#news webhook/i],
  ['the dev updates webhook', /dev updates webhook/i],
  ['the voice join token key', /voice/i],
  ['the backup passphrase', /backup passphrase/i],
  ['GitHub access', /github/i],
  ['VPS access', /vps access/i],
  ['code signing', /signing/i]
];
want.forEach(function (w) { yes('there is a row for ' + w[0], !!row(w[1])); });

// ------------------------------------------------------- the join password ---
const pw = row(/server password/i) || ['', '', '', ''];
yes('the join password row says not enforced', /\*\*not enforced\.?\*\*/i.test(pw[2]));
yes('the join password row no longer places it in server-settings.json as sPassword',
    !/server-settings\.json|sPassword|sAdminPassword/.test(pw[1]));
yes('the join password row names the script that still rotates it', /Rotate-ServerPassword\.ps1/.test(pw[3]));

// And the code still agrees with it. If any of these stops being true, the
// game server has grown a password and the row has to be rewritten.
const deployGm = read('scripts/deploy/Deploy-Gamemode.ps1');
const gamemode = read('game/gamemode.js');
const site = siteFiles.source();
const rotate = read('scripts/deploy/Rotate-ServerPassword.ps1');
const publish = read('scripts/release/Publish-Update.ps1');
const voice = read('voice/voice-server.js');
const installVoice = read('scripts/deploy/Install-Voice.ps1');
yes('Deploy-Gamemode.ps1 still writes offlineMode true, so a client names its own profile id',
    /NotePropertyName offlineMode\s+-NotePropertyValue \$true/.test(deployGm));
yes('gamemode.js still reads no join password', gamemode.length > 0 && !/sPassword|serverPassword/.test(gamemode));
yes('the site still reads no serverPassword, so the value Rotate-ServerPassword writes has no reader',
    site.length > 0 && !/serverPassword/.test(site));
yes('Rotate-ServerPassword.ps1 still writes serverPassword into the site config the row names',
    /Get-ThornswoodSiteConfigSet -ConfigPath "\$docsWin\\config\.json" -Key 'serverPassword'/.test(rotate) &&
    /\$cfg\['\$Key'\] = `\$pw/.test(read('scripts/deploy/SiteConfigSet.ps1')) && /nothing to write/.test(rotate));
yes('the voice service still reads no secret.txt', voice.length > 0 && !/'secret\.txt'/.test(voice));
yes('the section records that a launcher older than 1.0.197 keeps what version.json gave it',
    /1\.0\.197/.test(section) && /older than 1\.0\.197/.test(rotate));
yes('Publish-Update.ps1 still takes serverPassword out of the feed, as the section says',
    /PSObject\.Properties\.Remove\('serverPassword'\)/.test(publish));

// ------------------------------------------------- the retired register secret ---
// The join password row used to place "the old four digit value" in
// server-secret.txt and the voice folder's secret.txt. They never held it after
// 18 September: they held the character register secret, 32 random bytes, and
// nothing has read them since the register went on 23 September. Publish-Update's
// own comment says what server-secret.txt holds, so the row is held against it.
yes('the join password row no longer names server-secret.txt or secret.txt',
    !/secret\.txt/.test(pw[1]));
const reg = row(/register secret/i) || ['', '', '', ''];
yes('there is a row for the retired character register secret', !!row(/register secret/i));
yes('the register secret row names server-secret.txt and the voice folder secret.txt',
    /`server-secret\.txt`/.test(reg[1]) &&
    reg[1].indexOf('C:' + BS + 'Thornswood-Voice' + BS + 'secret.txt') >= 0);
yes('the register secret row says not enforced, and 32 random bytes rather than the join password',
    /\*\*not enforced\.?\*\*/i.test(reg[2]) && /32 random bytes/.test(reg[2]) && /not the join password/i.test(reg[2]));
yes('Publish-Update.ps1 still says server-secret.txt holds the register secret, 32 random bytes',
    /character register\s+#\s*secret is 32 random bytes written into server-secret\.txt/.test(publish));
yes('Install-Voice.ps1 still sends no secret.txt, so the VPS copy has no reader either',
    installVoice.length > 0 && !/secret\.txt/.test(installVoice));

// ------------------------------------------------------------------ the door ---
const key = row(/botKey/) || ['', '', '', ''];
yes('the botKey row says it is also the door key', /door key/i.test(key[0]));
yes('the door key lives in private' + BS + 'door.json, where the gamemode reads it',
    key[1].indexOf('private' + BS + 'door.json') >= 0 && key[1].indexOf('data' + BS + 'door.json') < 0);
yes('gamemode.js still reads door.json and allowed.json out of the private folder',
    /var privDir = 'private';/.test(gamemode) &&
    gamemode.indexOf("path.join(privDir, 'door.json')") >= 0 &&
    gamemode.indexOf("path.join(privDir, 'allowed.json')") >= 0);
yes('the botKey row names every place the value is copied: the bot, both doors',
    /THORNSWOOD_KEY/.test(key[1]) && /C:\\Thornswood-Server\\private\\door\.json/.test(key[1]) &&
    /C:\\Thornswood-Server-Dev\\private\\door\.json/.test(key[1]));
yes('the botKey row reissues through Install-Bot.ps1 -RotateKey and then both doors',
    /Install-Bot\.ps1 -RotateKey/.test(key[3]) && (key[3].match(/Set-Door\.ps1 -Connect/g) || []).length >= 2);
const installBot = read('scripts/deploy/Install-Bot.ps1');
const setDoor = read('scripts/ops/Set-Door.ps1');
yes('Install-Bot.ps1 still has -RotateKey and still writes the key into the site as botKey',
    /\[switch\]\$RotateKey/.test(installBot) && /\$cfg\['botKey'\]/.test(installBot));
yes('Set-Door.ps1 still copies the site botKey into door.json',
    /\$c\.botKey/.test(setDoor) && /'door\.json'/.test(setDoor));
yes('the site still checks botKey on /api/ticket, /api/roster and /api/allowed',
    /route === '\/api\/ticket'/.test(site) && /(p|route) === '\/api\/roster'/.test(site) && /route === '\/api\/allowed'/.test(site) &&
    site.split('\n').filter(function (l) { return /sameSecret\(.*String\(cfg\.botKey\)\)/.test(l); }).length >= 3);

// Who actually gets in, said once under the table.
yes('the section says the door turns people away only with "enforce": true',
    section.indexOf('"enforce": true') >= 0 && section.indexOf('private' + BS + 'allowed.json') >= 0);
yes('gamemode.js still enforces only on a literal true', /enforce: doc\.enforce === true/.test(gamemode));
yes('the section says offline mode lets a client name its own profile id', /offlineMode/.test(section));

// ------------------------------------------------------------- the site secret ---
const sec = row(/^Site `secret`$/) || ['', '', '', ''];
yes('the site secret row says it signs the launcher ticket as well as the cookie',
    /ticket/i.test(sec[2]) && /cookie/i.test(sec[2]));
yes('the site still makes secret on first start and signs tickets with it',
    /cfg\.secret = crypto\.randomBytes\(32\)/.test(site) && /createHmac\('sha256', cfg\.secret\)/.test(site) &&
    /sign\('ticket:'/.test(site));

// ---------------------------------------------------------------- the bot token ---
const tok = row(/bot token/i) || ['', '', '', ''];
// Since issue #466 one writer, scripts\vps\Write-BotToken.ps1, puts the token
// in both files or neither, and every script that takes a token goes through it.
yes('the bot token row names both files it lives in, the one command and the one writer',
    /config\.json/.test(tok[1]) && /bot\.env\.json/.test(tok[1]) &&
    /Rotate-BotToken\.ps1/.test(tok[3]) && /Write-BotToken\.ps1/.test(tok[3]) &&
    /Set-DiscordLogin\.ps1/.test(tok[3]) && /Install-Bot\.ps1/.test(tok[3]));
const tokenWriter = read('scripts/vps/Write-BotToken.ps1');
yes('Write-BotToken.ps1 still writes DISCORD_TOKEN and discord.botToken together',
    /\$env2\['DISCORD_TOKEN'\] = \$Token/.test(tokenWriter) && /\$d\['botToken'\] = \$Token/.test(tokenWriter));
yes('Rotate-BotToken.ps1, Set-DiscordLogin.ps1 and Install-Bot.ps1 all hand the token to it',
    ['scripts/deploy/Rotate-BotToken.ps1', 'scripts/deploy/Set-DiscordLogin.ps1', 'scripts/deploy/Install-Bot.ps1']
      .every(function (f) { return /Write-ThornswoodBotToken -Token/.test(read(f)); }) &&
    !/\$d\.botToken = \$botToken/.test(read('scripts/deploy/Set-DiscordLogin.ps1')) &&
    !/DISCORD_TOKEN'\] = /.test(installBot));

// ------------------------------------------------------------------- the voice ---
const vk = row(/voice/i) || ['', '', '', ''];
// Since #1303 and #1315 the key is enforced: no setting lets an unproven join
// in, and nothing is minted without the site's yes.
yes('the voice key row says it is enforced, and no longer that it is not',
    /\bEnforced\b/.test(vk[2]) && !/\*\*not enforced\*\*/i.test(vk[2]) && !/-Auth on/.test(vk[2]));
yes('the voice service reads no auth setting and keeps its key in token-key.txt',
    !/process\.env\.THORNSWOOD_VOICE_AUTH/.test(voice) && /'token-key\.txt'/.test(voice));
yes('Install-Voice.ps1 has no -Auth to turn it off with', !/\[string\]\$Auth\b/.test(installVoice));

// ---------------------------------------------------------------- the VPS key ---
// The row used to say "Setup-SshKey.ps1 -KeyOnly makes a new key". It does not
// while the old one is there. The script first asks ssh whether it already gets
// in, through the config entry that names the old key, and stops if it does;
// then it uses a .pub it finds at the path again. So those steps handed Patrick
// the same public line, and then had him remove "the old one", which was the
// same key. Nothing was rotated and the developer lost VPS access.
// Since #2891 a new grant for the same name replaces that name's key and
// token on the box (Grant-BoxAccess.ps1), so no old line is left to take off;
// the old key still has to be moved aside first, or the new pair is the old
// key again.
const vps = row(/vps access/i) || ['', '', '', ''];
const aside = vps[3].indexOf('thornswood_ed25519');
const setupAt = vps[3].indexOf('Setup-SshKey.ps1', aside);
yes('the VPS access row moves the old key and its .pub aside before Setup-SshKey.ps1',
    aside >= 0 && setupAt > aside && /rename/i.test(vps[3].slice(0, setupAt)) && /\.pub/.test(vps[3].slice(aside, setupAt)));
yes('the VPS access row has the new grant replace the old key and token, one name at a time',
    /Grant-BoxAccess\.ps1 -Name <you> -FromClipboard/.test(vps[3]) && /replaces your old key and token/.test(vps[3]) && /-Remove/.test(vps[3]));
const setupSsh = read('scripts/vps/Setup-SshKey.ps1');
const reusePub = setupSsh.indexOf('if (Test-Path -LiteralPath "$KeyPath.pub") {');
yes('Setup-SshKey.ps1 still uses a .pub it finds again rather than making a new key',
    reusePub >= 0 && setupSsh.indexOf('using the one already at', reusePub) > reusePub);
const worksFn = (setupSsh.match(/function Works \{[\s\S]*?\n\}/) || [''])[0];
yes('Setup-SshKey.ps1 still checks through the ssh config rather than -KeyPath, so a new -KeyPath does not get round it',
    worksFn.length > 0 && !/KeyPath|\s-i\s/.test(worksFn));

// ------------------------------------------------------------- the rule itself ---
yes('the rule under the table: a control that does not exist is listed as not enforced',
    /control that does not exist is listed as\s+\*\*not enforced\*\*/i.test(section));

// The overview used to say Rotate-ServerPassword.ps1 changes "the server
// password", as though that meant something on the game server.
yes('the overview no longer says Rotate-ServerPassword.ps1 changes the server password',
    !/Rotate-ServerPassword\.ps1`\s+the\s+server\s+password/.test(doc));

// ----------------------------------------------------- every name is a real one ---
// Every script the section names is one that exists.
function exists(rel) { try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch (e) { return false; } }
const scripts = {};
(section.match(/[A-Za-z0-9-]+\.(?:ps1|py)\b/g) || []).forEach(function (s) { scripts[s] = true; });
const missing = Object.keys(scripts).filter(function (s) {
  return !['release', 'deploy', 'vps', 'ops', 'mods', 'dev'].some(function (a) { return exists('scripts/' + a + '/' + s); }) && !exists('bot/' + s);
});
missing.forEach(function (s) { console.log('      named but not in scripts: ' + s); });
yes('every script the section names is in scripts, ' + Object.keys(scripts).length + ' of them',
    Object.keys(scripts).length >= 10 && missing.length === 0);

// Every repo path a row says lives on a machine is one git will never take.
function ticks(text) {
  return (text.match(/`[^`]+`/g) || []).map(function (t) { return t.slice(1, -1); });
}
const local = [];
rows.forEach(function (r) {
  ticks(r[1]).forEach(function (t) {
    if (t.indexOf('local' + BS) === 0 || t.indexOf('bot' + BS) === 0 || t === 'records' + BS + 'signing' + BS + 'signing.json' || t === 'server-secret.txt') local.push(t);
  });
});
let gitOk = true;
try { execFileSync('git', ['--version'], { cwd: ROOT, stdio: 'ignore' }); } catch (e) { gitOk = false; }
if (!gitOk) {
  console.log('SKIP  git did not answer, so whether each repo path is ignored was not checked');
} else {
  const tracked = local.filter(function (t) {
    const rel = t.split(BS).join('/');
    try { execFileSync('git', ['check-ignore', '-q', rel], { cwd: ROOT, stdio: 'ignore' }); return false; }
    catch (e) { return true; }
  });
  tracked.forEach(function (t) { console.log('      not ignored by git: ' + t); });
  yes('every file a row places in the repo folder is ignored by git, ' + local.length + ' of them',
      local.length >= 4 && tracked.length === 0);
}

// Every VPS or profile path a row names is one some script actually uses, so
// a person checking the row is looking where the code looks.
const corpus = [];
function addDir(rel, re) {
  let names = [];
  try { names = fs.readdirSync(path.join(ROOT, rel)); } catch (e) { return; }
  names.filter(function (n) { return re.test(n); }).forEach(function (n) {
    corpus.push(read(rel + '/' + n).split('/').join(BS).toLowerCase());
  });
}
// The scripts are in scripts\<area> since phase 8 of issue #440.
['release', 'deploy', 'vps', 'ops', 'mods', 'dev'].forEach(function (a) { addDir('scripts/' + a, /\.(ps1|js)$/i); });
addDir('launcher/app', /\.cs$/i);
addDir('voice', /\.js$/i);
addDir('site', /^server\.js$/i);
addDir('bot', /\.py$/i);
function usedTogether(a, b) {
  a = a.toLowerCase(); b = (b || '').toLowerCase();
  return corpus.some(function (t) { return t.indexOf(a) >= 0 && t.indexOf(b) >= 0; });
}
// Or a script that builds the file name from a parameter: the folder, then a
// PowerShell variable and the extension, in the same script as the name
// itself in quotes, the way scripts\ops\Discord-Hook.ps1 builds
// C:\Thornswood-Bot\webhooks\$Name.txt with ValidateSet('dev', 'news').
function builtFrom(dir, leaf) {
  const dot = leaf.lastIndexOf('.');
  if (dot <= 0) return false;
  const stem = leaf.slice(0, dot).toLowerCase(), ext = leaf.slice(dot).toLowerCase();
  const esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  const re = new RegExp(esc(dir.toLowerCase() + BS) + '\\$\\w+' + esc(ext));
  return corpus.some(function (t) { return re.test(t) && t.indexOf("'" + stem + "'") >= 0; });
}
const unknown = [];
let placed = 0;
rows.forEach(function (r) {
  ticks(r[1]).forEach(function (t) {
    if (t.indexOf(BS) < 0 || t.indexOf('local' + BS) === 0 || t.indexOf('records' + BS) === 0) return;
    const parts = t.split(BS);
    placed++;
    if (/^[A-Za-z]:$/.test(parts[0])) {
      const top = parts.slice(0, 2).join(BS);
      const leaf = parts.length > 2 ? parts[parts.length - 1] : '';
      if (!usedTogether(top, leaf) && !(leaf && builtFrom(parts.slice(0, -1).join(BS), leaf))) unknown.push(t);
    } else if (!usedTogether(parts[parts.length - 1], '')) {
      unknown.push(t);
    }
  });
});
unknown.forEach(function (t) { console.log('      no script uses this path: ' + t); });
yes('every path a row names outside the repo is one a script uses, ' + placed + ' of them',
    placed >= 10 && unknown.length === 0);

// ----------------------------------------------------------- nothing is a value ---
const shapes = [
  ['a Discord webhook address', /discord(?:app)?\.com\/api\/webhooks\//i],
  ['a GitHub token', /\bgh[opsu]_[A-Za-z0-9]{10,}/],
  ['a public or private SSH key', /ssh-(?:ed25519|rsa)\s+AAAA|-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['a Discord id or any long number', /\b\d{17,}\b/],
  ['a key shaped run of letters and digits', /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{24,}\b/]
];
shapes.forEach(function (s) { yes('the section carries nothing that looks like ' + s[0], section.length > 0 && !s[1].test(section)); });

// And the house rules for anything people read.
yes('the section has no em dash', section.indexOf(String.fromCharCode(0x2014)) < 0);
yes('the section never says player', !/\bplayers?\b/i.test(section));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
