'use strict';
// launcher-csc.js
// For the JavaScript harnesses that compile launcher C#, what
// tests\Launcher-Csc.ps1 is for the PowerShell ones (#498): the code is built
// the way launcher\app\Thornswood.csproj builds it, by the .NET 10 SDK at the
// project's LangVersion, against its target framework and every package it
// references (#4823). That works on Linux as well as on Windows, so a harness
// compiles and runs launcher code everywhere.
//
//   const lc = require('./launcher-csc');
//   const dll = lc.build({ sources: [code], files: [path], exe: true });
//   const r = lc.run(dll, ['arg']);   // { status, stdout, stderr }
//
//   build() takes as well:
//     launcher: true    the whole launcher as the project has it: every
//                       launcher/app/*.cs, every *.axaml there as Avalonia
//                       XAML, and every EmbeddedResource under its LogicalName.
//     main: 'Ns.Type'   the class whose Main starts the program
//                       (StartupObject), which a driver beside the whole
//                       launcher needs, since Shell.Main is in the build too.
//     resources: { 'skyrim-files.json': standIn }
//                       files embedded under the names given: one the project
//                       already embeds under that name is replaced, any other
//                       name is added. Their bytes are in the hash, so a
//                       changed stand-in is built again.
//     properties: { GenerateAssemblyInfo: 'false' }
//                       MSBuild properties added after the project's own, so
//                       one given here wins; they are in the project text,
//                       and so in the hash.
//
//   const dll = lc.buildProject();   // launcher/app/Thornswood.csproj as it
//                                    // is, built once for each state of the
//                                    // files under launcher/app and the
//                                    // resources it embeds; the path of
//                                    // Thornswood.dll.
//
//   lc.dotnet       the dotnet that builds the launcher: the one on PATH, else
//                   DOTNET_ROOT's, else ~/.dotnet's; null when there is none.
//   lc.langVersion  the LangVersion the project names.
//   lc.framework    the TargetFramework the project names.
//   lc.onWindows    true on Windows, for a harness whose code under test does
//                   something only Windows has.
//
// build() and buildProject() throw with the compiler's words when the code is
// refused, and when there is no SDK. The builds go under out/harness/ in the
// repository, which git ignores, in a folder named by a hash of the project,
// every source and the bytes of every file read, so the same code is built
// once; a build() folder and its assembly carry that hash in their name.
// tests\Launcher-Csc.ps1 writes the same project the same way, and names a
// buildProject() folder by the same hash, so the two share it. A build() is
// for this machine's runtime identifier, so it carries this machine's native
// libraries only, and package files are hard links to the NuGet cache where
// the disk allows one: copied, one build of the whole launcher was 580 MB.
//
// Until #4823 this found the Roslyn csc in Visual Studio's Build Tools, which
// only Windows has, and every compile here was SKIP off Windows (#3005).

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const repo = path.resolve(__dirname, '..');
const appDir = path.join(repo, 'launcher', 'app');
const projPath = path.join(appDir, 'Thornswood.csproj');
const proj = fs.readFileSync(projPath, 'utf8');
const onWindows = process.platform === 'win32';

function prop(name) {
  const m = new RegExp('<' + name + '>([^<]*)</' + name + '>').exec(proj);
  return m ? m[1].trim() : null;
}
const langVersion = prop('LangVersion');
if (!langVersion) throw new Error('launcher\\app\\Thornswood.csproj names no LangVersion, so the harnesses cannot compile at the version the build does.');
const framework = prop('TargetFramework');
if (!framework) throw new Error('launcher\\app\\Thornswood.csproj names no TargetFramework, so the harnesses cannot compile against what the build does.');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
const copied = ['Nullable', 'ImplicitUsings', 'AllowUnsafeBlocks', 'EnableWindowsTargeting', 'AvaloniaUseCompiledBindingsByDefault']
  .filter((n) => prop(n) !== null).map((n) => '    <' + n + '>' + esc(prop(n)) + '</' + n + '>');
const packages = [];
// Each with the assets it leaves out, as the project says (the project
// leaves Avalonia.BuildServices out whole).
for (const m of proj.matchAll(/<PackageReference\s+([^>]*?)\/>/g)) {
  const attr = (n) => { const a = new RegExp('\\b' + n + '="([^"]*)"').exec(m[1]); return a ? a[1] : null; };
  let line = '    <PackageReference Include="' + esc(attr('Include')) + '" Version="' + esc(attr('Version')) + '"';
  ['ExcludeAssets', 'PrivateAssets'].forEach((a) => { if (attr(a) !== null) line += ' ' + a + '="' + esc(attr(a)) + '"'; });
  packages.push(line + ' />');
}
// The project's resources, each as a full path and the name the code asks
// for, read from the project the way the packages are.
const projResources = [];
for (const m of proj.matchAll(/<EmbeddedResource\s+Include="([^"]+)"\s*>\s*<LogicalName>([^<]+)<\/LogicalName>\s*<\/EmbeddedResource>/g)) {
  projResources.push({ path: path.resolve(appDir, m[1].replace(/\\/g, path.sep)), name: m[2].trim() });
}
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const byOrdinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function findDotnet() {
  const exe = onWindows ? 'dotnet.exe' : 'dotnet';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && fs.existsSync(path.join(dir, exe))) return path.join(dir, exe);
  }
  for (const root of [process.env.DOTNET_ROOT, path.join(os.homedir(), '.dotnet')]) {
    if (root && fs.existsSync(path.join(root, exe))) return path.join(root, exe);
  }
  return null;
}
const dotnet = findDotnet();

// The runtime identifier of this machine, as the SDK names it, asked once.
let hostRid = null;
function rid() {
  if (hostRid) return hostRid;
  const r = cp.spawnSync(dotnet, ['--info'], { encoding: 'utf8' });
  const m = /^\s*RID:\s*(\S+)/m.exec(r.stdout || '');
  if (!m) throw new Error('launcher-csc: dotnet --info names no RID, so a build cannot pick this machine\'s native libraries. It said:\n' + ((r.stdout || '') + (r.stderr || '')).trim());
  hostRid = m[1];
  return hostRid;
}

function build(opts) {
  const sources = (opts && opts.sources) || [];
  let files = ((opts && opts.files) || []).map((f) => {
    if (!fs.existsSync(f)) throw new Error('launcher-csc build: ' + f + ' is not there.');
    return fs.realpathSync(f);
  });
  if (!dotnet) throw new Error('launcher-csc build: the .NET SDK the launcher builds with is not on this machine. docs/guide/set-up-a-machine.md "Setting up a machine" has the install line.');
  if (sources.length + files.length === 0 && !opts.launcher) throw new Error('launcher-csc build: nothing to build.');
  let xaml = [];
  let resources = [];
  if (opts.launcher) {
    const names = fs.readdirSync(appDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort(byOrdinal);
    const whole = names.filter((n) => n.endsWith('.cs')).map((n) => path.join(appDir, n));
    files = whole.concat(files.filter((f) => !whole.includes(f)));
    xaml = names.filter((n) => n.endsWith('.axaml')).map((n) => path.join(appDir, n));
    resources = projResources.slice();
    for (const r of resources) {
      if (!fs.existsSync(r.path)) throw new Error('launcher-csc build: ' + r.path + ', a resource the project embeds, is not there.');
    }
  }
  // The harness's own resources, in ordinal order of their names, each in
  // place of the project's resource of the same name.
  const given = (opts && opts.resources) || {};
  for (const n of Object.keys(given).sort(byOrdinal)) {
    if (!fs.existsSync(given[n])) throw new Error('launcher-csc build: ' + given[n] + ', the file given for the resource ' + n + ', is not there.');
    resources = resources.filter((r) => r.name !== n).concat([{ path: fs.realpathSync(given[n]), name: n }]);
  }

  let text = [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '  <PropertyGroup>',
    '    <OutputType>' + (opts.exe ? 'Exe' : 'Library') + '</OutputType>',
    '    <TargetFramework>' + framework + '</TargetFramework>',
    '    <LangVersion>' + langVersion + '</LangVersion>',
    ...copied,
    '    <AssemblyName>ASSEMBLY_NAME</AssemblyName>',
    '    <RootNamespace>Thornswood</RootNamespace>',
    '    <EnableDefaultItems>false</EnableDefaultItems>',
    '    <UseAppHost>false</UseAppHost>',
    '    <CopyLocalLockFileAssemblies>true</CopyLocalLockFileAssemblies>',
    '    <CreateHardLinksForCopyLocalIfPossible>true</CreateHardLinksForCopyLocalIfPossible>',
    '    <RuntimeIdentifier>' + rid() + '</RuntimeIdentifier>',
    '    <SelfContained>false</SelfContained>',
    '    <GenerateDocumentationFile>false</GenerateDocumentationFile>',
    '    <SatelliteResourceLanguages>en</SatelliteResourceLanguages>',
    ...(opts.main ? ['    <StartupObject>' + esc(opts.main) + '</StartupObject>'] : []),
    ...Object.keys(opts.properties || {}).sort(byOrdinal).map((n) => {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(n)) throw new Error('launcher-csc build: ' + n + ' is not a name MSBuild takes for a property.');
      return '    <' + n + '>' + esc(opts.properties[n]) + '</' + n + '>';
    }),
    '  </PropertyGroup>',
    '  <ItemGroup>',
    ...packages,
    '  </ItemGroup>',
    '  <ItemGroup>',
    ...sources.map((s, i) => '    <Compile Include="source' + i + '.cs" />'),
    ...files.map((f) => '    <Compile Include="' + esc(f) + '" />'),
    ...xaml.map((f) => '    <AvaloniaXaml Include="' + esc(f) + '" />'),
    ...resources.map((r) => '    <EmbeddedResource Include="' + esc(r.path) + '" LogicalName="' + esc(r.name) + '" />'),
    '  </ItemGroup>',
    '</Project>',
  ].join('\n') + '\n';

  // The folder and the assembly are named by everything in the build: the
  // project, each source, and the bytes of each file it reads, by their own
  // sha256. .NET loads one assembly of a name, and the same code is built once.
  const h = crypto.createHash('sha256');
  h.update(text);
  for (const s of sources) h.update('\0' + s);
  for (const f of files.concat(xaml, resources.map((r) => r.path))) h.update('\0' + sha(fs.readFileSync(f)));
  const hash = h.digest('hex').slice(0, 24);
  const name = 'launcher-code-' + hash;
  text = text.replace('ASSEMBLY_NAME', name);
  const base = path.join(repo, 'out', 'harness');
  const done = path.join(base, hash);
  const dll = path.join(done, name + '.dll');
  if (fs.existsSync(dll)) return dll;

  const work = path.join(base, 'building-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(work, { recursive: true });
  try {
    fs.writeFileSync(path.join(work, 'launcher-code.csproj'), text);
    sources.forEach((s, i) => fs.writeFileSync(path.join(work, 'source' + i + '.cs'), s));
    const bin = path.join(work, 'bin');
    // --disable-build-servers: no MSBuild node or compiler server outlives the
    // build, holding files under its folder open so that on Windows the folder
    // can be neither moved into place nor removed (tests\Launcher-Csc.ps1).
    const r = cp.spawnSync(dotnet, ['build', path.join(work, 'launcher-code.csproj'), '-c', 'Release', '-o', bin,
      '-nologo', '-v:q', '-clp:NoSummary;ErrorsOnly', '--disable-build-servers'], { encoding: 'utf8' });
    if (r.status !== 0 || !fs.existsSync(path.join(bin, name + '.dll'))) {
      throw new Error('launcher-csc build: the .NET SDK refused it:\n' + ((r.stdout || '') + (r.stderr || '')).trim());
    }
    // Into place in one rename. Another harness may have built the same code
    // meanwhile; its copy is the same, and is used.
    try { fs.renameSync(bin, done); } catch (e) { if (!fs.existsSync(dll)) throw e; }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return dll;
}

// Every file a build of the project reads that can change: each file under
// launcher/app and each resource the project embeds, as its path from the
// repository and the sha256 of its bytes, in ordinal order.
// tests\Launcher-Csc.ps1 Get-LauncherProjectHash does the same.
function projectHash() {
  const all = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (e.isFile()) all.push(p);
    }
  };
  walk(appDir);
  for (const r of projResources) all.push(r.path);
  const rel = [...new Set(all.map((p) => path.relative(repo, p).split(path.sep).join('/')))].sort(byOrdinal);
  return sha(rel.map((r) => r + '\0' + sha(fs.readFileSync(path.join(repo, r))) + '\n').join('')).slice(0, 24);
}

function buildProject() {
  if (!dotnet) throw new Error('launcher-csc buildProject: the .NET SDK the launcher builds with is not on this machine. docs/guide/set-up-a-machine.md "Setting up a machine" has the install line.');
  const base = path.join(repo, 'out', 'harness');
  const done = path.join(base, 'project-' + projectHash());
  const dll = path.join(done, 'Thornswood.dll');
  if (fs.existsSync(dll)) return dll;

  // A folder of its own for the build, obj included: the project's
  // Directory.Build.props puts obj under out/obj/launcher, which two
  // harnesses building at once would share, so both bases are given here.
  const work = path.join(base, 'building-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(work, { recursive: true });
  try {
    const bin = path.join(work, 'bin');
    const r = cp.spawnSync(dotnet, ['build', projPath, '-c', 'Release', '-o', bin,
      '-p:BaseIntermediateOutputPath=' + path.join(work, 'obj') + path.sep,
      '-p:BaseOutputPath=' + path.join(work, 'out') + path.sep,
      '-p:CreateHardLinksForCopyLocalIfPossible=true',
      '-nologo', '-v:q', '-clp:NoSummary;ErrorsOnly', '--disable-build-servers'], { encoding: 'utf8' });
    if (r.status !== 0 || !fs.existsSync(path.join(bin, 'Thornswood.dll'))) {
      throw new Error('launcher-csc buildProject: the .NET SDK refused launcher/app/Thornswood.csproj:\n' + ((r.stdout || '') + (r.stderr || '')).trim());
    }
    // Into place in one rename, as build() does.
    try { fs.renameSync(bin, done); } catch (e) { if (!fs.existsSync(dll)) throw e; }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return dll;
}

function run(dll, args, options) {
  const r = cp.spawnSync(dotnet, [dll, ...(args || [])], Object.assign({ encoding: 'utf8', timeout: 120000 }, options || {}));
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

module.exports = { onWindows, dotnet, langVersion, framework, build, buildProject, run };
