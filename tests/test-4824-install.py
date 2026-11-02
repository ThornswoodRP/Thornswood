"""The install in compiled code holds the rules the setup script and the setup program were held to (#4824).

    python tests/test-4824-install.py

Until #4824 the install was installer/Setup-Thornswood.ps1, run hidden by
Thornswood-Setup.exe (installer/setup/Bootstrap.cs) and in a console by
Setup.bat and Install.bat. Decided 27 Oct: the installer is compiled code plus
Velopack, and the script and both batch files retire. The install is now the
launcher's first start: launcher/app/InstallWindow.cs asks, InstallSteps.cs
installs. The harnesses that read the script and the setup program
(test-setup-*.ps1, test-own-folder-first.ps1 and -again.ps1, test-payload-hash.ps1
and the rest) held these rules; this holds the compiled install to them.

What this holds:
  - the script, both batch files and the setup program are gone, and nothing
    in the launcher starts PowerShell or a .ps1 to install;
  - the steps, built with the .NET SDK into a small runner and run against
    stand-in folders (a pretend Steam copy, a pretend package, a temp
    install folder; no Steam, no network, no install):
      * not chosen: Thornswood's own files go into the Steam copy with
        Profile/installed-into-game.txt listing them, and config.json gets no
        MakeOwnGame (#1226);
      * own folder chosen: the files go into Profile/Payload, nothing is
        written into the Steam copy, no list is written, MakeOwnGame and a good
        Vortex folder go into config.json and a folder Vortex never deployed
        into does not (#906, #1226);
      * a folder the launcher made (Game with Profile/OwnGame/files.txt) is
        written into and not parked; an old Game folder with no record is
        parked as Game-old-<date> and nothing in it is deleted (#1233);
      * no Profile/accepted.json stops before anything is written (#1018);
      * no Steam copy stops with the script's words;
      * config.json: what was on the disk stays, a blank field in the package
        never wipes a filled one, the package's new fields come in, UTF-8
        with no byte order mark;
      * the profile folders, applied.txt only when there is none, SOURCE
        CODE.txt, the licence texts, and licences/ replaced whole (#421, #3099);
      * the checks at the end: the script extender and the address library
        are [next], a wrong build is [next] for the Downgrade button, a
        missing multiplayer client is a [MISS] that fails the install;
      * the bar ends full;
  - the agreements: Install is on for exactly one of the sixteen ways the
    four boxes can be ticked; Profile/accepted.json has the time, each page's
    address and hash and nothing about the person; only the site's own pages
    open (#1009);
  - the Vortex folder check refuses what OwnGame.PointAt refuses, with its
    sentences;
  - the window: four boxes that start unticked with the agreed words, a link
    to each page, Install off until all four are ticked, no close while
    installing, Skyrim's drive first and C:\\Thornswood only without one, a
    second ask on another drive, the own folder card in Settings' own words,
    no colour of its own (#2851);
  - the launcher reads what the card writes (Config.cs) and makes the folder
    without its question when MakeOwnGame is set (ShellOwnGame.cs);
  - Skyrim still running: closed politely first, then a Yes or No before
    anything is ended, and No stops with nothing installed;
  - no em dash, and never the word the project does not use.

The runner needs the .NET SDK (dotnet on the PATH or in ~/.dotnet); without it
those checks print SKIP. Everything it makes is under a temp folder it removes.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / 'launcher' / 'app'

passed = 0
failed = 0


def check(what, cond):
    global passed, failed
    if cond:
        passed += 1
        print('PASS  ' + what)
    else:
        failed += 1
        print('FAIL  ' + what)


def skip(what):
    print('SKIP  ' + what)


def read(p):
    return pathlib.Path(p).read_text(encoding='utf-8-sig')


def code_only(text):
    """C# with its comments taken out, so a check reads what runs. Strings,
    verbatim strings and characters are kept whole, // inside them too."""
    out = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        two = text[i:i + 2]
        if two == '//':
            j = text.find('\n', i)
            i = n if j < 0 else j
        elif two == '/*':
            j = text.find('*/', i + 2)
            i = n if j < 0 else j + 2
        elif two == '@"':
            j = i + 2
            while j < n:
                if text[j] == '"' and text[j + 1:j + 2] == '"':
                    j += 2
                elif text[j] == '"':
                    break
                else:
                    j += 1
            out.append(text[i:j + 1])
            i = j + 1
        elif c in '"\'':
            j = i + 1
            while j < n and text[j] != c:
                j += 2 if text[j] == '\\' else 1
            out.append(text[i:j + 1])
            i = j + 1
        else:
            out.append(c)
            i += 1
    return ''.join(out)


# ---------------------------------------------------------------- retired
for gone in ['installer/Setup-Thornswood.ps1', 'installer/Setup.bat', 'installer/Install.bat',
             'installer/setup/Bootstrap.cs', 'installer/setup/Setup.csproj', 'installer/setup/Setup.manifest']:
    check(gone + ' is gone', not (ROOT / gone).exists())

install_files = sorted(APP.glob('Install*.cs'))
names = [f.name for f in install_files]
for want in ['InstallSteps.cs', 'InstallWindow.cs', 'InstallAgreements.cs', 'InstallPlace.cs', 'InstallSkyrim.cs', 'InstallShortcut.cs']:
    check('launcher/app/' + want + ' is there', want in names)
src = {f.name: read(f) for f in install_files}
code = {n: code_only(t) for n, t in src.items()}
allcode = '\n'.join(code.values())
check('nothing in the install starts PowerShell or a script',
      not re.search(r'(?i)powershell|pwsh|\.ps1"|\.bat"|cmd\.exe', allcode))
check('nothing in the launcher still names the setup script as something to run',
      not any(re.search(r'"[^"]*Setup-Thornswood\.ps1', code_only(read(f))) for f in APP.glob('*.cs')))

# ---------------------------------------------------------------- words
for n, t in src.items():
    check(n + ' has no em dash', '\u2014' not in t)
    check(n + ' never says the word the project does not use', not re.search(r'(?i)\bplayers?\b', t))
readme = read(ROOT / 'installer' / 'README.md')
check('installer/README.md has no em dash', '\u2014' not in readme)
check('installer/README.md never says the word the project does not use', not re.search(r'(?i)\bplayers?\b', readme))

# ---------------------------------------------------------------- the window, read
win = code.get('InstallWindow.cs', '')
agree = code.get('InstallAgreements.cs', '')
place = code.get('InstallPlace.cs', '')
sky = code.get('InstallSkyrim.cs', '')
steps = code.get('InstallSteps.cs', '')

for words in ['I am 18 or over. Thornswood is an adult server.',
              'I have read and accept the Terms and Conditions',
              'I have read and accept the Privacy Policy',
              'I have read and agree to the Rules']:
    check('the box "' + words + '" is there', words in agree)
check('the three pages are terms, privacy and rules on the site',
      '"terms", "privacy", "rules"' in agree and re.search(r'"https://thornswood\.net"', agree) is not None)
check('every box starts unticked', 'IsChecked = false' in win)
check('Install starts switched off', re.search(r'Content = "Install", IsEnabled = false', win) is not None)
check('each box looks at the gate again on every tick and untick',
      win.count('IsCheckedChanged += delegate { Gate(); }') >= 2)
check('the gate turns Install on only when all four are ticked',
      'all[0] = chkAge.IsChecked' in win and 'InstallAgreements.AllTicked(all)' in win)
check('each page has a link beside its box that opens the site page',
      'OpenPage(InstallAgreements.Site + "/" + page)' in win and 'new HyperlinkButton' in win)
check('the one process the window starts is a site page, checked first',
      re.search(r'IsSitePage\(url\)\) return;\s*try \{ Process\.Start', win) is not None
      and win.count('Process.Start') == 1)
check('the window will not close while installing',
      re.search(r'if \(!installing\) return;.*?e\.Cancel = true;', win, re.S) is not None)
check('it starts on the drive Skyrim is on, found the way the launcher finds it',
      'Steam.SkyrimPath()' in win and 'InstallPlace.StartRoot(skyrimDrive)' in win)
check('C:\\Thornswood only when there is no Skyrim', '@"C:\\Thornswood"' in place
      and re.search(r'IsNullOrEmpty\(skyrimDrive\)\) return @"C:\\Thornswood"', place) is not None)
check('another drive asks once more and does not refuse',
      'Ask.YesNo(InstallPlace.OtherDriveQuestion(skyrimDrive, root)' in win and 'Yes installs on' in place)
check('another drive is said in the colour for what will not work', 'colour = "Bad";' in place)
check('the window holds no colour of its own (#2851)',
      not re.search(r'#[0-9A-Fa-f]{6}\b|Colors\.|Color\.From|Color\.Parse|new SolidColorBrush', win)
      and 'Themes.Apply(this, "Forge")' in win)
check('Install writes what was accepted before the steps run',
      win.find('InstallAgreements.Record(') != -1 and win.find('InstallAgreements.Record(') < win.find('steps.Run()'))
check('the steps refuse to install with no note of what was accepted',
      'Setup found no note that you accepted the terms, the privacy policy and the rules, so nothing was installed.' in steps)
check('the install folder is recorded only once it finished',
      re.search(r'if \(steps\.Bad > 0\)[^;]*;\s*else\s*InstallPlace\.Record\(choice\.Root\);', win) is not None)
check('a stop is said, and where its log is', 'Everything it said is below, and saved in ' in win and '"STOP. "' in win)

# The own folder card says what the launcher's Settings says.
about = 'Runs Thornswood from a Skyrim folder of its own, made from what Vortex has deployed while the Thornswood profile is on.'
settings = [p for p in list((ROOT / 'launcher').glob('*.xaml')) + list((ROOT / 'launcher').rglob('*.axaml')) if about in read(p)]
check('the own folder card has the words of Settings, Maintenance', about in src.get('InstallWindow.cs', '') and len(settings) > 0)
check('the tick box says what Settings says', 'Give Thornswood a Skyrim folder of its own' in win)

# What the card writes is what the launcher reads and acts on (#906).
cfgcs = code_only(read(APP / 'Config.cs'))
check('the launcher reads MakeOwnGame and VortexGame from config.json',
      re.search(r'\bbool MakeOwnGame\b', cfgcs) is not None and re.search(r'\bstring VortexGame\b', cfgcs) is not None)
shellown = code_only(read(APP / 'ShellOwnGame.cs'))
check('the launcher makes the folder without its question when MakeOwnGame is set, and a tick outweighs an earlier no',
      'cfg.MakeOwnGame' in shellown and '(!OwnGame.Declined || c.MakeOwnGame)' in shellown)

# Skyrim still running.
check('Skyrim and the script extender loader are looked for', '"SkyrimSE", "skse64_loader"' in sky)
check('the game is asked to close itself first', sky.find('CloseMainWindow') != -1 and sky.find('CloseMainWindow') < sky.find('askYesNo('))
check('every Kill sits after the Yes or No', sky.find('.Kill(') > sky.find('askYesNo(') > 0)
check('No stops with nothing installed', 'Skyrim is still open, so nothing was installed and nothing was ' in sky)
check('the question names what runs and what each answer does',
      all(w in sky for w in ['Skyrim is still running (', 'Yes ends it', 'No stops the install and changes nothing']))
check('the question is a Yes or No box on the window', 'Ask.YesNo(q, Title_, Ask.Icon.Warning)' in win)
check('no anti-debug call', not re.search(r'IsDebuggerPresent|CheckRemoteDebugger|Debugger\.IsAttached', allcode))

# A copy that fails stops, naming both folders (#2201).
check('a file that will not copy stops the install, naming both',
      re.search(r'throw Die\("Could not copy " \+ from \+ " to " \+ dest', steps) is not None)
check('a hard-linked name in a made folder comes off before the copy (#1233)',
      steps.find('RemoveSharedNames(payload, files, gameDir)') != -1
      and steps.find('RemoveSharedNames(payload, files, gameDir)') < steps.find('CopyPayload(payload, files, gameDir)'))

# ---------------------------------------------------------------- the runner
DRIVER = r'''
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Thornswood;

static class Driver
{
    static int Main(string[] a)
    {
        var o = new MemoryStream();
        using (var w = new Utf8JsonWriter(o))
        {
            w.WriteStartObject();
            if (a[0] == "install")
            {
                var c = new InstallChoice { Root = a[1], Package = a[2], SteamRoot = a[3], SteamGame = a[4], MakeOwnGame = a[5] == "1", VortexGame = a[6] };
                var lines = new List<string>();
                double last = -2;
                var s = new InstallSteps(c, lines.Add, f => last = f);
                try { s.Run(); w.WriteNull("stop"); }
                catch (InstallStop e) { w.WriteString("stop", e.Message); }
                w.WriteNumber("bad", s.Bad);
                w.WriteNumber("later", s.Later);
                w.WriteNumber("last", last);
                w.WriteStartArray("lines");
                foreach (string l in lines) w.WriteStringValue(l);
                w.WriteEndArray();
            }
            else if (a[0] == "agree")
            {
                w.WriteString("json", InstallAgreements.Json(new DateTime(2026, 11, 1, 12, 0, 0, DateTimeKind.Utc), new string[] { "aa", "", null }));
                w.WriteStartArray("gate");
                for (int m = 0; m < 16; m++)
                {
                    var b = new bool?[4];
                    for (int i = 0; i < 4; i++) b[i] = (m & (1 << i)) != 0;
                    w.WriteBooleanValue(InstallAgreements.AllTicked(b));
                }
                w.WriteEndArray();
                w.WriteBoolean("site", InstallAgreements.IsSitePage("https://thornswood.net/terms"));
                w.WriteBoolean("other", InstallAgreements.IsSitePage("https://thornswood.net.example.com/terms"));
                w.WriteBoolean("http", InstallAgreements.IsSitePage("http://thornswood.net/terms"));
                w.WriteString("sha", InstallAgreements.PageSha("abc"));
            }
            else if (a[0] == "vortex")
            {
                string full;
                string why = InstallPlace.VortexFolderProblem(a[1], out full);
                if (why == null) w.WriteNull("why"); else w.WriteString("why", why);
                w.WriteString("full", full);
            }
            w.WriteEndObject();
        }
        Console.Out.Write(Encoding.UTF8.GetString(o.ToArray()));
        return 0;
    }
}
'''


def find_dotnet():
    d = shutil.which('dotnet')
    if d:
        return d
    home = pathlib.Path.home() / '.dotnet' / 'dotnet'
    return str(home) if home.exists() else None


def write(p, text=''):
    p = pathlib.Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding='utf-8')


def tree(p):
    p = pathlib.Path(p)
    out = {}
    for f in sorted(p.rglob('*')):
        if f.is_file():
            out[str(f.relative_to(p))] = f.read_bytes()
    return out


dotnet = find_dotnet()
if not dotnet:
    skip('the steps run against stand-in folders: no .NET SDK on this machine')
else:
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='ts-4824-'))
    try:
        proj = tmp / 'runner'
        proj.mkdir()
        files = ';'.join(str(APP / n) for n in ['InstallSteps.cs', 'InstallAgreements.cs', 'InstallPlace.cs', 'InstallShortcut.cs'])
        write(proj / 'runner.csproj', f'''<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <NoWarn>CA1416</NoWarn>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="{files}" />
    <EmbeddedResource Include="{ROOT / 'records' / 'skyrim-files.json'}"><LogicalName>skyrim-files.json</LogicalName></EmbeddedResource>
  </ItemGroup>
</Project>
''')
        write(proj / 'Driver.cs', DRIVER)
        build = subprocess.run([dotnet, 'build', str(proj), '-c', 'Release', '-o', str(proj / 'bin'), '-nologo', '-v', 'q', '--disable-build-servers'],
                               capture_output=True, text=True)
        check('the install steps build on their own with the .NET SDK', build.returncode == 0)
        if build.returncode != 0:
            print(build.stdout[-3000:])
            raise SystemExit(1)
        runner = proj / 'bin' / 'runner.dll'
        appdata = tmp / 'appdata'
        env = dict(os.environ, XDG_DATA_HOME=str(appdata), DOTNET_CLI_TELEMETRY_OPTOUT='1')

        def run(*args):
            r = subprocess.run([dotnet, str(runner)] + [str(x) for x in args], capture_output=True, text=True, env=env)
            if r.returncode != 0:
                print(r.stdout[-2000:], r.stderr[-2000:])
            return json.loads(r.stdout)

        def fixture(name, made=False, leftover=False, accepted=True, plugins=True, mp=True):
            base = tmp / name
            steam = base / 'Steam'
            game = steam / 'steamapps' / 'common' / 'Skyrim Special Edition'
            write(game / 'SkyrimSE.exe', 'not 1.6.1170')
            write(game / 'Data' / 'Skyrim.esm', 'bethesda')
            write(game / 'Data' / 'Thornswood.esp', 'an older one, from Vortex')
            pkg = base / 'package'
            if mp:
                write(pkg / 'Game' / 'Data' / 'SKSE' / 'Plugins' / 'MpClientPlugin.dll', 'client')
            write(pkg / 'Game' / 'Data' / 'Thornswood.esp', 'this build')
            write(pkg / 'Game' / 'Data' / 'Platform' / 'UI' / 'build.js', 'front')
            write(pkg / 'applied.txt', 'pack-1\npack-2\n\n')
            write(pkg / 'SOURCE CODE.txt', 'where the source is')
            write(pkg / 'GPL-3.0.txt', 'gpl')
            write(pkg / 'licences' / 'lib-a.txt', 'a')
            write(pkg / 'config.json', json.dumps({'Server': 'thornswood.net', 'Password': '', 'Channel': 'dev'}))
            root = base / 'Thornswood'
            write(root / 'config.json', '\ufeff' + json.dumps({'Password': 'kept', 'Theme': 'Forge'}))
            write(root / 'licences' / 'old-lib.txt', 'gone after')
            if accepted:
                write(root / 'Profile' / 'accepted.json', '{}')
            if made:
                write(root / 'Game' / 'Data' / 'Thornswood.esp', 'the made folder')
                write(root / 'Profile' / 'OwnGame' / 'files.txt', 'Data/Thornswood.esp')
            if leftover:
                write(root / 'Game' / 'Data' / 'old.esp', 'old install')
            if plugins:
                write(appdata / 'Skyrim Special Edition' / 'plugins.txt', '*Skyrim.esm\n')
            elif (appdata / 'Skyrim Special Edition' / 'plugins.txt').exists():
                (appdata / 'Skyrim Special Edition' / 'plugins.txt').unlink()
            return root, pkg, steam, game

        # -- not chosen: into the Steam copy, with its list
        root, pkg, steam, game = fixture('plain')
        r = run('install', root, pkg, steam, game, '0', '')
        check('not chosen: it installs (' + str(r['stop']) + ')', r['stop'] is None and r['bad'] == 0)
        check('not chosen: the files go into the Steam copy', (game / 'Data' / 'Thornswood.esp').read_text() == 'this build'
              and (game / 'Data' / 'SKSE' / 'Plugins' / 'MpClientPlugin.dll').exists())
        listed = (root / 'Profile' / 'installed-into-game.txt').read_text(encoding='utf-8').split()
        check('not chosen: Profile/installed-into-game.txt lists exactly what went in',
              sorted(x.replace('\\', '/') for x in listed) == sorted(['Data/Platform/UI/build.js', 'Data/SKSE/Plugins/MpClientPlugin.dll', 'Data/Thornswood.esp']))
        check('not chosen: Bethesda\'s files are not touched', (game / 'Data' / 'Skyrim.esm').read_text() == 'bethesda')
        cfg_raw = (root / 'config.json').read_bytes()
        cfg = json.loads(cfg_raw)
        check('config.json: no MakeOwnGame when the card was left alone', 'MakeOwnGame' not in cfg and 'VortexGame' not in cfg)
        check('config.json: a blank field never wipes a filled one', cfg.get('Password') == 'kept')
        check('config.json: what was on the disk stays and the package\'s new fields come in',
              cfg.get('Theme') == 'Forge' and cfg.get('Server') == 'thornswood.net' and cfg.get('Channel') == 'dev')
        check('config.json: UTF-8 with no byte order mark', not cfg_raw.startswith(b'\xef\xbb\xbf'))
        check('the profile folders are made', all((root / 'Profile' / d).is_dir() for d in ['MyGames', 'LocalAppData', 'Default', 'MyGames/Saves']))
        check('applied.txt is laid down and counted', (root / 'Profile' / 'applied.txt').exists() and '  2 updates marked as already in this build' in r['lines'])
        check('SOURCE CODE.txt and the licence texts go into the install folder',
              (root / 'SOURCE CODE.txt').exists() and (root / 'GPL-3.0.txt').exists() and (root / 'licences' / 'lib-a.txt').exists())
        check('licences/ is replaced whole', not (root / 'licences' / 'old-lib.txt').exists())
        check('the load order comes from Vortex when the package has none', '  Load order comes from Vortex, nothing to install here.' in r['lines'])
        check('a wrong build is said up front and is the Downgrade button\'s at the end',
              '  This Skyrim is not build 1.6.1170, which is the one the server runs.' in r['lines']
              and "  [next] Game 1.6.1170  the launcher's Downgrade button fixes this" in r['lines'])
        check('the script extender and the address library are the collection\'s, next',
              '  [next] Script Extender  the collection installs this' in r['lines']
              and '  [next] Address library  the collection installs this' in r['lines'] and r['later'] == 3)
        check('the multiplayer client and the load order are checked', '  [ok]   Multiplayer' in r['lines'] and '  [ok]   Load order' in r['lines'])
        check('it ends with the script\'s words', 'Installed. 3 things still to come from the collection, which is the next step.' in r['lines']
              and 'Make a character named after yourself, save once, then connect.' in r['lines'])
        check('the bar ends full', r['last'] == 1)
        check('each step is headed as the script headed it',
              all(h in r['lines'] for h in ['Finding Skyrim', 'The base game', 'Installing the mods', 'Settings', 'Checking']))

        # -- a second run keeps applied.txt as it is
        (root / 'Profile' / 'applied.txt').write_text('real record\n')
        r2 = run('install', root, pkg, steam, game, '0', '')
        check('a second run leaves the real applied.txt as it is', (root / 'Profile' / 'applied.txt').read_text() == 'real record\n' and r2['stop'] is None)

        # -- own folder chosen: Profile/Payload, nothing into the Steam copy
        root, pkg, steam, game = fixture('own')
        vortex = tmp / 'own' / 'VortexGame'
        write(vortex / 'SkyrimSE.exe', 'x')
        write(vortex / 'Data' / 'vortex.deployment.json', '{}')
        before = tree(steam)
        r = run('install', root, pkg, steam, game, '1', vortex)
        check('chosen: it installs (' + str(r['stop']) + ')', r['stop'] is None and r['bad'] == 0)
        check('chosen: the files go into Profile/Payload', (root / 'Profile' / 'Payload' / 'Data' / 'Thornswood.esp').read_text() == 'this build')
        check('chosen: nothing is written into the Steam copy', tree(steam) == before)
        check('chosen: no installed-into-game list', not (root / 'Profile' / 'installed-into-game.txt').exists())
        cfg = json.loads((root / 'config.json').read_text(encoding='utf-8'))
        check('chosen: MakeOwnGame and the Vortex folder go into config.json',
              cfg.get('MakeOwnGame') is True and cfg.get('VortexGame') == str(vortex))
        check('chosen: the multiplayer client is read from Profile/Payload', '  [ok]   Multiplayer' in r['lines'])
        check('chosen: it says nothing was written into the Steam copy', 'Nothing was written into your Steam copy of Skyrim.' in r['lines'])

        root, pkg, steam, game = fixture('badvortex')
        notdeployed = tmp / 'badvortex' / 'NotDeployed'
        write(notdeployed / 'SkyrimSE.exe', 'x')
        r = run('install', root, pkg, steam, game, '0', notdeployed)
        cfg = json.loads((root / 'config.json').read_text(encoding='utf-8'))
        check('a folder Vortex never deployed into is said and not saved',
              'VortexGame' not in cfg and any('Vortex has not deployed into' in l for l in r['lines']) and r['stop'] is None)

        # -- a folder the launcher made: written into, not parked
        root, pkg, steam, game = fixture('made', made=True)
        before = tree(steam)
        r = run('install', root, pkg, steam, game, '0', '')
        check('made: it installs (' + str(r['stop']) + ')', r['stop'] is None)
        check('made: the files are written into Game', (root / 'Game' / 'Data' / 'Thornswood.esp').read_text() == 'this build')
        check('made: the folder is not parked', not any(p.name.startswith('Game-old-') for p in root.iterdir()))
        check('made: nothing goes into the Steam copy', tree(steam) == before)
        check('made: it says the folder was updated in place', "Thornswood's own folder was updated in place." in r['lines'])

        # -- an old Game folder with no record: parked, nothing deleted
        root, pkg, steam, game = fixture('leftover', leftover=True)
        r = run('install', root, pkg, steam, game, '0', '')
        parked = [p for p in root.iterdir() if p.name.startswith('Game-old-')]
        check('an old Game folder is parked as Game-old-<date>', len(parked) == 1 and not (root / 'Game').exists())
        check('nothing in the parked folder is deleted', len(parked) == 1 and (parked[0] / 'Data' / 'old.esp').read_text() == 'old install')

        # -- no note of what was accepted
        root, pkg, steam, game = fixture('noaccept', accepted=False)
        before = tree(steam)
        r = run('install', root, pkg, steam, game, '0', '')
        check('no accepted.json stops before anything is written',
              r['stop'] is not None and 'nothing was installed' in r['stop'] and tree(steam) == before
              and not (root / 'Profile' / 'installed-into-game.txt').exists())

        # -- no Steam copy
        root, pkg, steam, game = fixture('nosteam')
        r = run('install', root, pkg, '', '', '0', '')
        check('no Steam stops with the script\'s words', r['stop'] == 'Steam is not installed on this PC.')
        r = run('install', root, pkg, steam, '', '0', '')
        check('no Skyrim stops with the script\'s words', r['stop'] == 'Skyrim Special Edition was not found in any Steam library. Install it first.')

        # -- a missing client fails the install with a screenshot line
        root, pkg, steam, game = fixture('nomp', mp=False)
        r = run('install', root, pkg, steam, game, '0', '')
        check('a missing multiplayer client is a [MISS] that fails it',
              r['bad'] == 1 and '  [MISS] Multiplayer' in r['lines']
              and '1 check failed. Send staff a screenshot of this window in the Discord.' in r['lines'])

        # -- the agreements
        a = run('agree')
        check('Install is on for exactly one of the sixteen ways the four boxes can be ticked',
              a['gate'] == [False] * 15 + [True])
        rec = json.loads(a['json'])
        check('accepted.json has the time, the three pages and the about line, and nothing else',
              sorted(rec) == ['about', 'accepted', 'pages'] and rec['accepted'] == '2026-11-01T12:00:00Z'
              and sorted(rec['pages']) == ['privacy', 'rules', 'terms'])
        check('each page is recorded with its address and hash, empty when the site did not answer',
              rec['pages']['terms'] == {'url': 'https://thornswood.net/terms', 'sha256': 'aa'}
              and rec['pages']['privacy']['sha256'] == '' and rec['pages']['rules']['sha256'] == '')
        check('only the site\'s own https pages open', a['site'] and not a['other'] and not a['http'])
        check('a page\'s version is the SHA-256 of its text', a['sha'] == 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')

        # -- the Vortex folder check, against OwnGame.PointAt's sentences
        owngame = read(APP / 'OwnGame.cs')
        v = run('vortex', tmp / 'nothing-here')
        check('a folder with no SkyrimSE.exe is refused with PointAt\'s sentence',
              v['why'] is not None and ' has no SkyrimSE.exe in it, so it is not a Skyrim folder and nothing changed. Choose the folder that Open Game Folder opens in Vortex.' in v['why']
              and ' has no SkyrimSE.exe in it, so it is not a Skyrim folder and nothing changed. Choose the folder that Open Game Folder opens in Vortex.' in owngame)
        v = run('vortex', notdeployed)
        check('a folder Vortex never deployed into is refused with PointAt\'s sentence',
              v['why'] is not None and v['why'].startswith('Vortex has not deployed into ')
              and 'the record Vortex leaves in every folder it deploys to, so nothing changed.' in owngame)
        v = run('vortex', '"' + str(vortex) + '"')
        check('a deployed folder is taken, quotes off', v['why'] is None and v['full'] == str(vortex))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

print()
print(f'{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
