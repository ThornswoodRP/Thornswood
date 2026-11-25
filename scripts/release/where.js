'use strict';
/**
 * where.js
 *
 *   const { where, repoRoot } = require('./where.js');
 *   where('Engine')
 *   where('bot')
 *
 * Same map as Where.ps1: reads layout.json at the repository root. Since
 * 28 September there are no old places in it (issue #440), so the answer is
 * always the place in the repository.
 *
 * Read only. Creates nothing.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const here = __dirname;
const repo = path.resolve(here, '..', '..');
const layoutPath = path.join(repo, 'layout.json');

function loadLayout() {
  if (!fs.existsSync(layoutPath)) {
    throw new Error(
      'layout.json is not at ' + layoutPath +
      '. It is in the repository, so the path is wrong.'
    );
  }
  return JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
}

function joinUnder(root, rel) {
  if (!rel) return root;
  const parts = String(rel).split(/[\\/]+/).filter((p) => p && p !== '.');
  return path.join(root, ...parts);
}

function own(obj, name) {
  return obj && Object.prototype.hasOwnProperty.call(obj, name) ? obj[name] : undefined;
}

// This machine's own data, the same folder Where.ps1's Get-MachineData names:
// %LOCALAPPDATA%\Thornswood, or with no LOCALAPPDATA the folder .NET's
// GetFolderPath('LocalApplicationData') gives for it. On Windows that is the
// Local AppData known folder, AppData\Local in the profile; off Windows it is
// $XDG_DATA_HOME, else ~/.local/share. Before #2872 a missing LOCALAPPDATA
// made these paths relative to wherever node was started, and until #1273
// Windows got the off-Windows folder, so the two scripts named two places.
function machineData() {
  let d = process.env.LOCALAPPDATA;
  if (!d && process.platform === 'win32') d = path.join(os.homedir(), 'AppData', 'Local');
  if (!d) d = process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME) ? process.env.XDG_DATA_HOME : path.join(os.homedir(), '.local', 'share');
  return path.join(d, 'Thornswood');
}

function getPlace(layout, name) {
  if (name === 'Repo') return repo;
  // This machine's working copies of the feeds (Feed-Store.ps1, #907), not
  // clones of Thornswood-Releases beside the repository any more.
  if (name === 'Releases' || name === 'ReleasesDev') {
    return path.join(machineData(), 'feed', name === 'Releases' ? 'main' : 'dev');
  }
  // This machine's engine build (#2019), the same answer as Where.ps1's
  // EngineBuild: the fork folder %LOCALAPPDATA%\Thornswood\engine-build.json
  // names, or the checkout's own engine when it names none. A record naming
  // a folder with no build in it throws rather than falling back.
  if (name === 'EngineBuilds') {
    return path.join(machineData(), 'engine-build.json');
  }
  // CI's engine build of this checkout's pin (#3047), the same answer as
  // Where.ps1's EngineArtifact: engine-ci/<the fork commit
  // records/server-build.json names, 12> in this machine's data.
  if (name === 'EngineArtifact') {
    const record = path.join(repo, 'records', 'server-build.json');
    let commit = '';
    try { commit = String(JSON.parse(fs.readFileSync(record, 'utf8').replace(/^\uFEFF/, '')).source.commit || '').toLowerCase(); } catch (e) { commit = ''; }
    if (!/^[0-9a-f]{40}$/.test(commit)) {
      throw new Error(record + ' names no fork commit (source.commit), so which CI engine build this checkout takes is not known.');
    }
    return path.join(machineData(), 'engine-ci', commit.slice(0, 12));
  }
  if (name === 'EngineBuild') {
    const file = getPlace(layout, 'EngineBuilds');
    if (!fs.existsSync(file)) return getPlace(layout, 'Engine');
    let rec;
    try { rec = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) {
      throw new Error(file + ' does not read as JSON, so which engine build this machine uses is not known.');
    }
    if (rec && rec.ci === true) return getPlace(layout, 'EngineArtifact');
    const fork = rec && typeof rec.fork === 'string' ? rec.fork : '';
    if (!fork) throw new Error(file + ' names no engine build.');
    if (!fs.existsSync(path.join(fork, 'build', 'dist'))) {
      throw new Error(file + ' names ' + fork + ' as this machine\'s engine build, and there is no build\\dist in it.');
    }
    return fork;
  }
  const place = own(layout.places, name);
  if (place != null) return joinUnder(repo, place);
  const der = own(layout.derived, name);
  if (der) return joinUnder(getPlace(layout, der.from), der.join);
  return null;
}

const PLACE_NAMES = [
  'Repo', 'Engine', 'EngineBuild', 'EngineBuilds', 'EngineArtifact', 'ServerDist', 'ClientDist', 'ServerSettings', 'ChangeForms',
  'Out', 'Dist', 'Package', 'Payload', 'ServerZip', 'Local', 'Backups',
  'Releases', 'ReleasesDev'
];

/**
 * @param {string} what Place or top folder name from layout.json
 * @returns {string}
 */
function where(what) {
  const layout = loadLayout();
  if (PLACE_NAMES.indexOf(what) >= 0) {
    const p = getPlace(layout, what);
    if (p == null) throw new Error('Where does not know place ' + what);
    return p;
  }
  const folder = own(layout.folders, what);
  if (folder != null) return joinUnder(repo, folder);
  throw new Error(
    "where.js does not know '" + what + "'. Known: " +
    PLACE_NAMES.concat(Object.keys(layout.folders || {})).join(', ')
  );
}

function repoRoot() {
  return repo;
}

module.exports = {
  where,
  repoRoot,
  layoutPath,
  PLACE_NAMES
};

if (require.main === module) {
  const code = cli();
  if (code !== undefined) process.exitCode = code;
}
// Run as a program. A function, so a stop is a return and not node's exit
// function, which can hang on Node 24 (#6036).
function cli() {
  const arg = process.argv[2];
  if (!arg) {
    process.stderr.write('Usage: node where.js <Place|Folder>\n');
    return 2;
  }
  process.stdout.write(where(arg) + '\n');
}
