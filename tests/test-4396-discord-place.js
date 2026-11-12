'use strict';
// The Discord link belongs to the sidebar, not to one launcher page.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let failed = 0;
function yes(label, value) {
  console.log((value ? 'PASS  ' : 'FAIL  ') + label);
  if (!value) failed++;
}
const xaml = read('launcher/app/MainWindow.axaml');
const bottom = xaml.slice(xaml.indexOf('<StackPanel DockPanel.Dock="Bottom"'));
yes('Connect Discord stays in the bottom sidebar above Settings',
  bottom.indexOf('x:Name="ButtonDiscord"') >= 0 &&
  bottom.indexOf('x:Name="ButtonDiscord"') < bottom.indexOf('x:Name="NavSettings"'));
for (const file of ['site/data/help.md', 'site/data/site/join.md', 'site/public/hub.js', 'launcher/app/Door.cs']) {
  const text = read(file).replace(/\s+/g, ' ');
  const mentions = [...text.matchAll(/Connect Discord/g)];
  yes(file + ' still offers Connect Discord', mentions.length > 0);
  const instructions = mentions.map(m => text.slice(Math.max(0, m.index - 40), m.index + 220));
  yes(file + ' gives the left sidebar above Settings, not Play or the main page',
    instructions.some(s => /left sidebar/i.test(s) && /above Settings/i.test(s)) &&
    !instructions.some(s => /Connect Discord.{0,65}(?:Play page|main page|front page)/i.test(s)));
}
const chars = read('launcher/app/ShellChars.cs');
yes('a turn-away does not send someone to Play to find Discord',
  !/Door\.Explain\(st,\s*delegate\s*\{\s*ShowPage\(PagePlay\);\s*\}\)/.test(chars));
console.log(`${failed} failed`);
process.exitCode = failed ? 1 : 0;
