'use strict';
/*
  test-4408-deploy-docs-words.js

      node tests\test-4408-deploy-docs-words.js

  #4408. scripts\deploy\Deploy-Docs.ps1's header said the member password
  crosses the wire in clear because the site is plain HTTP on an IP, and the
  usage line for -Password said it asks for the password. Every run ended by
  printing http://<the box's address>:3001. None of that is what the script
  does now:

    - -Password reads the password from a locked file on the box
      (Get-ThornswoodDocsPasswordFile, DocsPasswordFile.ps1, #2116), and
      asks for it only when there is no such file;
    - the site listens on loopback unless the box sets
      THORNSWOOD_DOCS_EXPOSE=1 (site\lib\base.js, #2185), and the script
      takes the firewall rule for its port away unless it does, so that
      port is shut from outside;
    - people reach it through the web front, Caddy, on HTTPS at the domain
      Setup-Domain.ps1 sets up.

  This reads the code for each of those and holds the header and the last
  line the script prints to it. Read only.
*/
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const ROOT = path.join(__dirname, '..');
// A file that is not there fails by name rather than reading as empty.
function read(...p) {
  const f = path.join(ROOT, ...p);
  const there = fs.existsSync(f);
  yes('reads ' + path.join(...p), there);
  return there ? fs.readFileSync(f, 'utf8').split('\r\n').join('\n') : '';
}

const DEPLOY = read('scripts', 'deploy', 'Deploy-Docs.ps1');
const DOMAIN = read('scripts', 'deploy', 'Setup-Domain.ps1');
const BASE = read('site', 'lib', 'base.js');

/* ---- what the code does ------------------------------------------------- */
console.log('\nwhat the code does:');
yes('-Password reads the password file on the box first (Get-ThornswoodDocsPasswordFile)',
  /if \(-not \$PasswordFile\) \{ \$PasswordFile = Get-ThornswoodDocsPasswordFile \}/.test(DEPLOY));
yes('  and asks only when the box has no such file (PWFILE MISSING)',
  /\$pwState -eq 'PWFILE MISSING'\)[\s\S]{0,200}Read-ThornswoodSecret/.test(DEPLOY));
yes('the site listens on loopback unless THORNSWOOD_DOCS_EXPOSE=1',
  /const BIND\s*=\s*EXPOSED \? '0\.0\.0\.0' : '127\.0\.0\.1'/.test(BASE));
yes('the script takes the firewall rule for its port away unless the box set EXPOSE',
  /`\$expose -ne '1'\) \{\s*if \(`\$fwHas\) \{ Remove-NetFirewallRule/.test(DEPLOY));
const dm = /\[string\]\$Domain = '([a-z0-9.-]+)'/.exec(DOMAIN);
const SITE = dm ? 'https://' + dm[1] : '';
yes('Setup-Domain.ps1 names the domain the web front answers on (' + SITE + ')', !!SITE);

/* ---- the header --------------------------------------------------------- */
console.log('\nthe header:');
const head = (/^<#[\s\S]*?#>/.exec(DEPLOY) || [''])[0];
const flat = head.replace(/\s+/g, ' ');
yes('it is there', head.length > 0);
yes('it no longer says the password crosses the wire in clear, or that the site is plain HTTP on an IP',
  !/crosses the wire in clear/i.test(flat) && !/plain HTTP on an IP/i.test(flat));
yes('it names the password file (DocsPasswordFile.ps1) for -Password',
  /-Password[\s\S]{0,400}DocsPasswordFile\.ps1/.test(flat));
yes('  and says it asks only when the box has no such file',
  /no such file[^.]*asks/i.test(flat) || /asks[^.]*only when[^.]*no[^.]*file/i.test(flat));
yes('  and no longer says -Password simply asks for the password',
  !/-Password asks for a new member password/.test(flat));
yes('it names the public address, ' + SITE + ', and that it is HTTPS through the web front',
  !!SITE && flat.indexOf(SITE) >= 0 && /Caddy/.test(flat) && /HTTPS/.test(flat));
yes('it says the site listens on loopback, with its port shut from outside unless the box set EXPOSE',
  /loopback/i.test(flat) && /THORNSWOOD_DOCS_EXPOSE=1/.test(flat) && /firewall/i.test(flat));

/* ---- the last line ------------------------------------------------------ */
console.log('\nthe last line:');
const hosts = DEPLOY.trimEnd().split('\n').filter((l) => /^\s*Write-Host\b/.test(l));
const last = hosts.length ? hosts[hosts.length - 1] : '';
yes('it is a Write-Host (' + last.trim() + ')', !!last);
yes('it names the public address, ' + SITE, !!SITE && last.indexOf(SITE) >= 0);
yes('and not the box\'s own address on the port the script keeps shut',
  !/http:\/\/\$\{?Vps\}?/.test(last) && !/\$\{?Vps\}?:\$Port/.test(last));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
