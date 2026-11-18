'use strict';
// Server-Log starts Node programs. Keep its canonical rolling/ageing behavior
// and give the native foreground relay a small, fixed no-shell child adapter.
const cp = require('child_process');
const path = require('path');
const powershell = path.join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe');
const child = cp.spawn(powershell, ['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(__dirname,'Run-Coturn.ps1')], {
  cwd: path.dirname(__dirname), stdio: ['ignore','inherit','inherit'], windowsHide: true, shell: false
});
let started = false;
child.on('spawn', () => { started = true; });
child.on('error', () => { console.error('relay child did not start'); process.exitCode = 1; });
child.on('close', code => { if (started) process.exitCode = Number.isInteger(code) ? code : 1; });
for (const event of ['SIGTERM','SIGINT']) process.on(event, () => { if (!child.killed) child.kill(); });
