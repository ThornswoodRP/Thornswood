// nexus-standin.js
//
// A stand-in for the parts of Nexus Mods the release scripts talk to (#2914),
// for tests\test-2914-nexus-scripts.ps1. It listens on a port of 127.0.0.1 the
// system picks and prints "[nexus] listening on 127.0.0.1:<port>".
//
//   NEXUS_STANDIN_KEY    the made-up key every API request has to carry
//   NEXUS_STANDIN_SAVE   a folder each finished upload is written to, <id>.bin
//
// It answers the v3 operations the scripts use, with the shapes of
// https://api.nexusmods.com/openapi.yaml as read on 20 October 2026, the v2
// GraphQL queries and mutation they send, and the presigned storage addresses
// an upload hands out (/s3/...). It checks what a real one would refuse: an
// API request without the key or the Application headers, a storage request
// WITH the key, an upload whose Content-MD5, Content-Disposition or size does
// not match what it was started with, parts that do not match their ETags, a
// storage request with an x-amz header its address does not sign, a whole
// file whose CRC-64/NVME is not the one its complete address carries, and a
// version made from an upload that is not available. Everything it was asked
// is kept for GET /_requests; POST /_control changes how it answers.
//
// For Install-NexusRevision.ps1 (#2754, tests\test-2754-revision-layout.ps1)
// it also answers a mod file version's download-link, a collection revision's
// download_link and its downloadLink in GraphQL, and serves the files behind
// them at /cdn/..., refusing a CDN request that carries the key. What it
// serves is set through /_control: serve maps a file id to a local file and
// the name its Content-Disposition gives (a version made from an upload
// serves that upload's bytes when serve does not name it, #4980), corrupt names file ids whose bytes
// it changes on the way out, premium false answers download-link with the
// 403 Nexus gives a free account, and addRevision adds a revision with the
// local collection archive its download serves.
//
// For NexusPublished.ps1 (#4068) it answers the collection's newest
// published revision without the key, as Nexus does, and says another
// collection is not there.
// For New-NexusRevision.ps1 -Discard (#4070) it answers discardRevision as the
// live schema has it (read 30 October), and addRevision with status draft
// makes that revision the waiting draft.
//
// For New-NexusRevision.ps1 -Add (#2969) it also knows a mod of somebody
// else's, 1932, with an optional file 8662, and answers legacyModsByDomain
// with each mod's author and category.

'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY = process.env.NEXUS_STANDIN_KEY || '';
const SAVE = process.env.NEXUS_STANDIN_SAVE || '';

const control = {
  pollsUntilAvailable: 2, // GET /uploads/<id> answers created this many times after finalise
  unknownState: '',       // answer this state instead, once finalised
  versionFails: false,    // POST /mod-files/<id>/versions answers 422
  storeOdd: false,        // PATCH /mods/<id> keeps the text without the stored line breaks
  partSize: 65536,        // multipart part size
  unboundComplete: false, // the complete address leaves out the CRC it was started with
  serve: {},              // file id -> { path, name }: what /cdn/file/<id> sends
  corrupt: [],            // file ids whose bytes are changed on the way out
  premium: true,          // false: download-link answers 403 as for a free account
};

const requests = [];
const violations = [];

function storedOf(text) { return text.replace(/\\/g, '&#92;').replace(/\n/g, '\n<br />'); }

const mods = {
  '192762': { uid: 'mod-192762', name: 'Thornswood Client Runtime', files: ['file-runtime'], author: 'EvilPatrick06', category: 'Utilities',
    description: storedOf('[size=4][b]Thornswood Client Runtime[/b][/size]\n\nThe runtime, in Data\\Platform\\Distribution.\n\n[b]What is in it[/b]\nThe server\'s files.') },
  '192001': { uid: 'mod-192001', name: 'Thornswood Content', files: ['file-content'], author: 'EvilPatrick06', category: 'Miscellaneous',
    description: storedOf('[size=4][b]Description[/b][/size]\nThornswood Content is the plugin for Thornswood.\n\n[size=4][b]Installation[/b][/size]\nThe collection installs it.') },
  // Not Thornswood's: a mod a revision adds, which the team's list leaves out.
  '1932': { uid: 'mod-1932', name: 'KS Hairdos Lite SE', files: ['file-hair'], author: 'Brataccas', category: 'Body, Face, and Hair', notTeam: true, description: '' },
};
const files = {
  'file-runtime': { id: 'file-runtime', name: 'Thornswood Client Runtime', mod: '192762', versions: [
    { id: 'ver-809366', game_scoped_id: '809366', name: 'Thornswood Client Runtime', version: '1.0.0', category: 'main', uploaded_at: '2026-09-22T22:17:00Z', is_primary: true, position: '1' }] },
  'file-content': { id: 'file-content', name: 'Thornswood Content', mod: '192001', versions: [
    { id: 'ver-809365', game_scoped_id: '809365', name: 'Thornswood Content', version: '1.1', category: 'old_version', uploaded_at: '2026-09-22T22:11:00Z', is_primary: false, position: '1' },
    { id: 'ver-811029', game_scoped_id: '811029', name: 'Thornswood Content', version: '1.2', category: 'main', uploaded_at: '2026-09-26T22:15:00Z', is_primary: true, position: '2',
      file_name: 'Thornswood Content 192001 1.2 2026-09-26T22-15Z EwgfAezil.zip' }] },
  'file-hair': { id: 'file-hair', name: 'KS Hairdos Lite SE NoNPCs', mod: '1932', versions: [
    { id: 'ver-8662', game_scoped_id: '8662', name: 'KS Hairdos Lite SE NoNPCs', version: '1.3', category: 'optional', uploaded_at: '2016-11-17T08:37:45Z', is_primary: false, position: '1' }] },
};
let nextFileId = 812345;
const collection = { id: 515846, slug: '7essxf', name: 'Thornswood', latest: 2, draft: null,
  revisions: { 2: { id: '801014', status: 'published', upload: null } } };
const uploads = {};
const changelogs = [];

function versionView(v, f) {
  return { id: v.id, file: { id: f.id, name: f.name }, position: v.position, game_scoped_id: v.game_scoped_id, name: v.name,
    version: v.version, category: v.category, uploaded_at: v.uploaded_at, manifest_url: null, is_primary: v.is_primary };
}
function findVersion(pred) {
  for (const f of Object.values(files)) for (const v of f.versions) if (pred(v)) return { v, f };
  return null;
}

function send(res, code, obj, type) {
  const body = obj === undefined ? '' : (typeof obj === 'string' ? obj : JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': type || 'application/json' });
  res.end(body);
}
function problem(res, code, detail) {
  send(res, code, { type: 'about:blank', title: 'Problem', status: code, detail, instance: '/' }, 'application/problem+json');
}

// CRC-64/NVME, the reflected form, as storage checks a whole multipart object.
const POLY = 0x9A6C9329AC4BC9B5n;
const TABLE = (() => { const t = []; for (let i = 0n; i < 256n; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1n) ? (c >> 1n) ^ POLY : c >> 1n; t.push(c); } return t; })();
function crc64nvme(buf) {
  let crc = 0xFFFFFFFFFFFFFFFFn;
  for (const b of buf) crc = TABLE[Number((crc ^ BigInt(b)) & 0xFFn)] ^ (crc >> 8n);
  crc ^= 0xFFFFFFFFFFFFFFFFn;
  const out = Buffer.alloc(8); out.writeBigUInt64BE(crc); return out.toString('base64');
}

function finishUpload(u, bytes) {
  u.bytes = bytes; u.sent = true;
  if (SAVE) fs.writeFileSync(path.join(SAVE, u.id + '.bin'), bytes);
}

function api(req, res, url, body, json) {
  const p = url.pathname;
  let m;
  if (req.method === 'GET' && (m = p.match(/^\/v3\/games\/skyrimspecialedition\/mods\/(\d+)$/))) {
    const mod = mods[m[1]]; if (!mod) return problem(res, 404, 'No mod ' + m[1]);
    return send(res, 200, { data: { id: mod.uid, game_scoped_id: m[1], game_id: '1704', name: mod.name } });
  }
  if (req.method === 'GET' && (m = p.match(/^\/v3\/mods\/([^/]+)\/files$/))) {
    const mod = Object.values(mods).find(x => x.uid === m[1]); if (!mod) return problem(res, 404, 'No mod');
    return send(res, 200, { data: { mod_files: mod.files.map(id => { const f = files[id]; return { id: f.id, name: f.name, is_active: true, last_file_uploaded_at: f.versions[f.versions.length - 1].uploaded_at, versions_count: f.versions.length, archived_count: f.versions.filter(v => v.category === 'archived').length, removed_count: 0 }; }) } });
  }
  if (req.method === 'GET' && (m = p.match(/^\/v3\/mod-files\/([^/]+)\/versions$/))) {
    const f = files[m[1]]; if (!f) return problem(res, 404, 'No mod file');
    return send(res, 200, { data: { versions: f.versions.map(v => versionView(v, f)) } });
  }
  if (req.method === 'GET' && (m = p.match(/^\/v3\/mod-file-versions\/([^/]+)$/))) {
    const hit = findVersion(v => v.id === m[1]); if (!hit) return problem(res, 404, 'No version');
    return send(res, 200, { data: versionView(hit.v, hit.f) });
  }
  if (req.method === 'GET' && (m = p.match(/^\/v3\/games\/skyrimspecialedition\/mod-file-versions\/(\d+)\/download-link$/))) {
    if (!control.premium) return problem(res, 403, 'Download links require Premium, or a valid key and expires.');
    if (!control.serve[m[1]] && !uploadedFile(m[1])) return problem(res, 404, 'No mod file version ' + m[1]);
    const base = 'http://127.0.0.1:' + server.address().port;
    return send(res, 200, { data: { links: [
      { name: 'Nexus Global Content Delivery Network', short_name: 'Nexus CDN', url: base + '/cdn/file/' + m[1] + '?md5=x&expires=4102444800' },
      { name: 'Amsterdam (Premium)', short_name: 'Amsterdam', url: base + '/cdn/file/' + m[1] + '?md5=y&expires=4102444800' }],
      expires_at: '2100-01-01T00:00:00Z' } });
  }
  if (req.method === 'GET' && (m = p.match(/^\/v2\/collections\/(\d+)\/revisions\/(\d+)\/download_link$/))) {
    if (Number(m[1]) !== collection.id) return problem(res, 404, 'No collection');
    const n = Object.keys(collection.revisions).find(k => collection.revisions[k].id === m[2]);
    if (!n || !collection.revisions[n].archive) return problem(res, 404, 'No revision ' + m[2]);
    const base = 'http://127.0.0.1:' + server.address().port;
    return send(res, 200, { download_links: [{ name: 'Nexus CDN', short_name: 'Nexus CDN', URI: base + '/cdn/collection/' + m[2] + '?md5=z&expires=4102444800' }] });
  }
  if (req.method === 'GET' && (m = p.match(/^\/v3\/games\/skyrimspecialedition\/mod-file-versions\/(\d+)$/))) {
    const hit = findVersion(v => v.game_scoped_id === m[1]); if (!hit) return problem(res, 404, 'No version');
    return send(res, 200, { data: versionView(hit.v, hit.f) });
  }
  // v1's file record, the one place a file's name on Nexus is given (a mod
  // rule names a file by it): <name> <mod> <version> <uploaded> <token>.<ext>.
  if (req.method === 'GET' && (m = p.match(/^\/v1\/games\/skyrimspecialedition\/mods\/(\d+)\/files\/(\d+)\.json$/))) {
    const hit = findVersion(v => v.game_scoped_id === m[2]);
    if (!hit || hit.f.mod !== m[1]) return send(res, 404, { error: 'File ID \'' + m[2] + '\' not found' });
    const v = hit.v;
    const fileName = v.file_name || (v.name + ' ' + m[1] + ' ' + v.version + ' ' + v.uploaded_at.slice(0, 16).replace(':', '-') + 'Z Tok' + v.game_scoped_id + '.7z');
    return send(res, 200, { id: [Number(m[2]), 1704], file_id: Number(m[2]), name: v.name, version: v.version, category_name: v.category.toUpperCase(), is_primary: v.is_primary, file_name: fileName, mod_version: v.version });
  }
  if (req.method === 'GET' && p === '/v3/team-mods') {
    return send(res, 200, { data: { mods: Object.keys(mods).filter(k => !mods[k].notTeam).map(k => ({ mod: { id: mods[k].uid, game_scoped_id: k, name: mods[k].name, game: { id: '1704', name: 'Skyrim Special Edition', domain_name: 'skyrimspecialedition' } }, affiliation: 'owner', bug_tracker: 'open', open_bug_count: 0 })) }, meta: { page: 1, page_size: 100, total_count: 2 } });
  }
  if (req.method === 'POST' && (p === '/v3/uploads' || p === '/v3/uploads/multipart')) {
    if (!json || typeof json.size_bytes !== 'number' || typeof json.filename !== 'string') return problem(res, 422, 'size_bytes and filename');
    const id = crypto.randomUUID();
    const base = 'http://127.0.0.1:' + server.address().port;
    const u = { id, multipart: p.endsWith('multipart'), size: json.size_bytes, filename: json.filename, md5: json.md5 || null, crc: json.crc64nvme || null, state: 'created', finalised: false, polls: 0, claimed: false, parts: {} };
    if (!u.multipart && json.md5 !== undefined && !/^[0-9a-fA-F]{32}$/.test(json.md5)) return problem(res, 422, 'md5');
    if (u.multipart && json.md5 !== undefined) return problem(res, 422, 'md5 is not a field of a multipart upload');
    uploads[id] = u;
    if (!u.multipart) return send(res, 201, { data: { id, user: { id: 'user-1' }, state: 'created', presigned_url: base + '/s3/single/' + id + '?X-Amz-Signature=x' } });
    const n = Math.max(1, Math.ceil(u.size / control.partSize));
    const urls = []; for (let i = 1; i <= n; i++) urls.push(base + '/s3/part/' + id + '/' + i + '?partNumber=' + i + '&X-Amz-SignedHeaders=host&X-Amz-Signature=x');
    // As Nexus's storage (Cloudflare R2) hands it out, measured 20 Oct: the CRC
    // is in the signed query and only host is a signed header.
    const bound = u.crc && !control.unboundComplete ? 'x-amz-checksum-crc64nvme=' + encodeURIComponent(u.crc) + '&x-amz-checksum-type=FULL_OBJECT&' : '';
    return send(res, 201, { data: { id, user: { id: 'user-1' }, state: 'created', part_size_bytes: control.partSize, part_presigned_urls: urls, complete_presigned_url: base + '/s3/complete/' + id + '?' + bound + 'X-Amz-SignedHeaders=host&X-Amz-Signature=x' } });
  }
  if (req.method === 'POST' && (m = p.match(/^\/v3\/uploads\/([^/]+)\/finalise$/))) {
    const u = uploads[m[1]]; if (!u) return problem(res, 404, 'No upload');
    if (!u.sent) return problem(res, 422, 'The upload has no data yet');
    u.finalised = true;
    return send(res, 200, { data: { id: u.id, user: { id: 'user-1' }, state: u.state } });
  }
  if (req.method === 'GET' && (m = p.match(/^\/v3\/uploads\/([^/]+)$/))) {
    const u = uploads[m[1]]; if (!u) return problem(res, 404, 'No upload');
    if (u.finalised && u.state === 'created') {
      if (control.unknownState) u.state = control.unknownState;
      else if (++u.polls > control.pollsUntilAvailable) u.state = 'available';
    }
    return send(res, 200, { data: { id: u.id, user: { id: 'user-1' }, state: u.state } });
  }
  if (req.method === 'POST' && (m = p.match(/^\/v3\/mod-files\/([^/]+)\/versions$/))) {
    const f = files[m[1]]; if (!f) return problem(res, 404, 'No mod file');
    if (control.versionFails) return problem(res, 422, 'The stand-in was told to refuse this version');
    const u = uploads[json && json.upload_id];
    if (!u || u.state !== 'available' || u.claimed) return problem(res, 422, 'upload_id is not an available upload');
    if (!/^[a-zA-Z0-9 _'().-]+$/.test(json.name || '') || json.name.length > 50) return problem(res, 422, 'name');
    if (!/^[a-zA-Z0-9.-]+$/.test(json.version || '')) return problem(res, 422, 'version');
    if (['main', 'optional', 'miscellaneous'].indexOf(json.file_category) < 0) return problem(res, 422, 'file_category');
    u.claimed = true;
    if (json.archive_existing_file === true) for (const v of f.versions) if (['main', 'update', 'optional', 'miscellaneous'].indexOf(v.category) >= 0) v.category = 'archived';
    const v = { id: 'ver-' + nextFileId, game_scoped_id: String(nextFileId), name: json.name, version: json.version, category: json.file_category, uploaded_at: '2026-10-20T20:00:00Z', is_primary: json.primary_mod_manager_download === true, position: String(f.versions.length + 1), upload: u.id };
    nextFileId++;
    f.versions.push(v);
    return send(res, 201, { data: { file: { id: f.id, game_scoped_id: v.game_scoped_id, name: f.name, file_category: v.category }, version: { id: v.id, position: v.position } } });
  }
  if (req.method === 'POST' && (m = p.match(/^\/v3\/mods\/([^/]+)\/changelogs$/))) {
    if (!json || !json.version || !json.changelog) return problem(res, 422, 'version and changelog');
    changelogs.push({ mod: m[1], version: json.version, changelog: json.changelog });
    return send(res, 201, { data: { version: json.version, changelog: json.changelog } });
  }
  if (req.method === 'PATCH' && (m = p.match(/^\/v3\/mods\/([^/]+)$/))) {
    const mod = Object.values(mods).find(x => x.uid === m[1]); if (!mod) return problem(res, 404, 'No mod');
    if (!json || typeof json.description !== 'string' || !json.description.trim()) return problem(res, 422, 'description');
    // legacyModsByDomain goes on answering what was there before, as some of Nexus's
    // nodes did for this edit on 20 Oct; mod(modId, gameId) answers the edit at once.
    mod.cached = mod.description;
    mod.description = control.storeOdd ? json.description : storedOf(json.description);
    res.writeHead(204); return res.end();
  }
  if (req.method === 'POST' && (m = p.match(/^\/v3\/collections\/(\d+)\/revisions$/))) {
    if (Number(m[1]) !== collection.id) return problem(res, 404, 'No collection');
    const u = uploads[json && json.upload_id];
    if (!u || u.state !== 'available' || u.claimed) return problem(res, 422, 'upload_id is not an available upload');
    const d = json.collection_data;
    const mf = d && d.collection_manifest;
    const ok = d && typeof d.adult_content === 'boolean' && typeof d.collection_schema_id === 'number' && mf && mf.info && mf.info.author && mf.info.name && mf.info.domain_name && Array.isArray(mf.mods) &&
      mf.mods.every(x => x.name && typeof x.version === 'string' && typeof x.optional === 'boolean' && x.domain_name && x.source && x.source.type);
    if (!ok) return problem(res, 422, 'collection_data does not match CollectionPayload');
    u.claimed = true;
    const n = Math.max(collection.latest, collection.draft || 0) + 1;
    collection.revisions[n] = { id: String(900000 + n), status: 'draft', upload: u.id, data: d };
    collection.draft = n;
    return send(res, 200, { data: { id: String(900000 + n), collection_id: String(collection.id), revision_number: n, revision_status: 'draft' } });
  }
  return problem(res, 404, 'The stand-in has no ' + req.method + ' ' + p);
}

function graph(req, res, json) {
  const q = (json && json.query) || '';
  let m;
  if (/mutation/.test(q) && /publishRevision/.test(q)) {
    const id = String(json.variables && json.variables.revisionId);
    const n = Object.keys(collection.revisions).find(k => collection.revisions[k].id === id);
    if (!n || collection.revisions[n].status !== 'draft') return send(res, 200, { errors: [{ message: 'No draft revision ' + id }] });
    collection.revisions[n].status = 'published'; collection.latest = Number(n); collection.draft = null;
    return send(res, 200, { data: { publishRevision: { success: true } } });
  }
  if (/mutation/.test(q) && /discardRevision/.test(q)) {
    const v = json.variables || {};
    const n = String(v.revisionNumber);
    if (String(v.collectionId) !== String(collection.id)) return send(res, 200, { errors: [{ message: 'No collection ' + v.collectionId }] });
    if (!collection.revisions[n] || collection.revisions[n].status !== 'draft') return send(res, 200, { errors: [{ message: 'No draft revision ' + n }] });
    delete collection.revisions[n];
    if (String(collection.draft) === n) collection.draft = null;
    return send(res, 200, { data: { discardRevision: { success: true } } });
  }
  if ((m = q.match(/legacyModsByDomain\(ids: \[\{gameDomain: "skyrimspecialedition", modId: (\d+)\}\]\)/))) {
    const mod = mods[m[1]];
    return send(res, 200, { data: { legacyModsByDomain: { nodes: mod ? [{ modId: Number(m[1]), name: mod.name, author: mod.author, modCategory: { name: mod.category }, description: mod.cached !== undefined ? mod.cached : mod.description }] : [] } } });
  }
  if ((m = q.match(/(?:^|[{\s])mod\(modId: (\d+), gameId: (\d+)\)/))) {
    const mod = m[2] === '1704' ? mods[m[1]] : undefined;
    if (!mod) return send(res, 200, { data: { mod: null }, errors: [{ message: 'Mod not found' }] });
    return send(res, 200, { data: { mod: { modId: Number(m[1]), name: mod.name, description: mod.description } } });
  }
  if ((m = q.match(/collectionRevision\(slug: "7essxf", revision: (\d+)/))) {
    const r = collection.revisions[m[1]];
    if (!r) return send(res, 200, { errors: [{ message: 'Revision not found' }] });
    return send(res, 200, { data: { collectionRevision: { id: r.id, revisionNumber: Number(m[1]), status: r.status, downloadLink: '/v2/collections/' + collection.id + '/revisions/' + r.id + '/download_link' } } });
  }
  if (/collection\(slug: "(?!7essxf")[A-Za-z0-9]+", domainName: "skyrimspecialedition"\)/.test(q)) {
    return send(res, 200, { data: { collection: null }, errors: [{ message: 'Collection not found' }] });
  }
  if (/collection\(slug: "7essxf", domainName: "skyrimspecialedition"\)/.test(q)) {
    return send(res, 200, { data: { collection: { id: collection.id, name: collection.name, latestPublishedRevision: { id: Number(collection.revisions[collection.latest].id), revisionNumber: collection.latest }, draftRevisionNumber: collection.draft } } });
  }
  return send(res, 200, { errors: [{ message: 'The stand-in does not know this query' }] });
}

function storage(req, res, url, body) {
  const p = url.pathname;
  let m;
  if (req.headers.apikey !== undefined) { violations.push('the key went to storage: ' + req.method + ' ' + p); return problem(res, 400, 'apikey sent to storage'); }
  // Storage takes an x-amz header only when the address signs it, and none of these do.
  const unsigned = Object.keys(req.headers).filter(h => h.startsWith('x-amz-'));
  if (unsigned.length) return problem(res, 403, 'SignatureDoesNotMatch: ' + unsigned.join(', ') + ' is not signed');
  if (req.method === 'PUT' && (m = p.match(/^\/s3\/single\/([^/]+)$/))) {
    const u = uploads[m[1]]; if (!u || u.multipart) return problem(res, 404, 'No upload');
    const md5 = crypto.createHash('md5').update(body).digest();
    if (req.headers['content-disposition'] !== 'attachment; filename="' + u.filename + '"') return problem(res, 403, 'Content-Disposition does not match the signature');
    if (u.md5 && req.headers['content-md5'] !== Buffer.from(u.md5, 'hex').toString('base64')) return problem(res, 403, 'Content-MD5 does not match the signature');
    if (req.headers['content-md5'] && req.headers['content-md5'] !== md5.toString('base64')) return problem(res, 400, 'BadDigest');
    if ((req.headers['content-type'] || '') !== 'application/octet-stream') return problem(res, 403, 'Content-Type does not match the signature');
    if (body.length !== u.size) return problem(res, 400, 'size');
    finishUpload(u, body);
    res.writeHead(200, { ETag: '"' + md5.toString('hex') + '"' }); return res.end();
  }
  if (req.method === 'PUT' && (m = p.match(/^\/s3\/part\/([^/]+)\/(\d+)$/))) {
    const u = uploads[m[1]]; if (!u || !u.multipart) return problem(res, 404, 'No upload');
    const md5 = crypto.createHash('md5').update(body).digest('hex');
    u.parts[m[2]] = { bytes: body, etag: md5 };
    res.writeHead(200, { ETag: '"' + md5 + '"' }); return res.end();
  }
  if (req.method === 'POST' && (m = p.match(/^\/s3\/complete\/([^/]+)$/))) {
    const u = uploads[m[1]]; if (!u || !u.multipart) return problem(res, 404, 'No upload');
    const xml = body.toString('utf8');
    const parts = []; const re = /<PartNumber>(\d+)<\/PartNumber>\s*<ETag>([^<]+)<\/ETag>/g; let x;
    while ((x = re.exec(xml)) !== null) parts.push({ n: x[1], etag: x[2] });
    const n = Math.max(1, Math.ceil(u.size / control.partSize));
    if (parts.length !== n) return problem(res, 400, 'InvalidPart: ' + parts.length + ' of ' + n);
    const bufs = [];
    for (let i = 0; i < parts.length; i++) {
      const got = u.parts[String(i + 1)];
      if (parts[i].n !== String(i + 1) || !got || got.etag !== parts[i].etag) return problem(res, 400, 'InvalidPart ' + (i + 1));
      bufs.push(got.bytes);
    }
    const whole = Buffer.concat(bufs);
    if (whole.length !== u.size) return problem(res, 400, 'size');
    const crc = crc64nvme(whole);
    const bound = url.searchParams.get('x-amz-checksum-crc64nvme');
    if (bound && bound !== crc) return problem(res, 400, 'BadDigest: the file\'s CRC-64/NVME is ' + crc);
    finishUpload(u, whole);
    return send(res, 200, '<CompleteMultipartUploadResult/>', 'application/xml');
  }
  return problem(res, 404, 'No storage address ' + p);
}

// The CDN behind the download links: signed already, so it takes no key.
// A version made from an upload serves the bytes that upload carried, as
// Nexus does (#4980), unless serve names something else for its file id.
function uploadedFile(id) {
  const hit = findVersion(v => v.game_scoped_id === id && v.upload);
  const u = hit ? uploads[hit.v.upload] : null;
  return u && u.bytes ? { bytes: u.bytes, name: u.filename } : null;
}
function cdn(req, res, url) {
  const p = url.pathname;
  let m, item = null;
  if (req.headers.apikey !== undefined) { violations.push('the key went to the CDN: ' + req.method + ' ' + p); return problem(res, 400, 'apikey sent to the CDN'); }
  if (req.method === 'GET' && (m = p.match(/^\/cdn\/file\/(\d+)$/))) item = control.serve[m[1]] ? Object.assign({ id: m[1] }, control.serve[m[1]]) : (uploadedFile(m[1]) ? Object.assign({ id: m[1] }, uploadedFile(m[1])) : null);
  else if (req.method === 'GET' && (m = p.match(/^\/cdn\/collection\/(\d+)$/))) {
    const n = Object.keys(collection.revisions).find(k => collection.revisions[k].id === m[1]);
    if (n && collection.revisions[n].archive) item = { path: collection.revisions[n].archive, name: path.basename(collection.revisions[n].archive) };
  }
  if (!item) return problem(res, 404, 'Nothing at ' + p);
  let bytes = item.bytes ? Buffer.from(item.bytes) : fs.readFileSync(item.path);
  if (item.id && control.corrupt.indexOf(item.id) >= 0) { bytes = Buffer.from(bytes); bytes[0] = bytes[0] ^ 0xFF; }
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'Content-Disposition': 'attachment; filename="' + item.name + '"' });
  return res.end(bytes);
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://127.0.0.1');
    let json = null;
    const isJson = /json/.test(req.headers['content-type'] || '');
    if (isJson && body.length) { try { json = JSON.parse(body.toString('utf8')); } catch (e) { return problem(res, 400, 'not JSON'); } }
    if (url.pathname === '/_requests') return send(res, 200, { requests, violations, changelogs, uploads: Object.values(uploads).map(u => ({ id: u.id, multipart: u.multipart, md5: u.md5, crc: u.crc, size: u.size, filename: u.filename, claimed: u.claimed })), collection, mods, files });
    if (url.pathname === '/_control') {
      const c = Object.assign({}, json || {});
      // A description put straight into the stored form, to give the scripts one they cannot read back.
      if (c.setStored) { mods[c.setStored.mod].description = c.setStored.stored; mods[c.setStored.mod].cached = undefined; delete c.setStored; }
      // A revision whose download is a local collection archive.
      if (c.addRevision) { collection.revisions[c.addRevision.n] = { id: String(c.addRevision.id), status: c.addRevision.status || 'published', upload: null, archive: c.addRevision.archive }; if (c.addRevision.status === 'draft') collection.draft = c.addRevision.n; delete c.addRevision; }
      // Which published revision is the newest, as publishing one on the website would leave it.
      if (c.setLatest) { if (collection.revisions[c.setLatest]) collection.latest = Number(c.setLatest); delete c.setLatest; }
      Object.assign(control, c);
      return send(res, 200, control);
    }
    const isApi = url.pathname.startsWith('/v3/') || url.pathname.startsWith('/v1/') || url.pathname === '/v2/graphql' || url.pathname.startsWith('/v2/collections/');
    requests.push({ method: req.method, path: url.pathname, query: url.search, api: isApi,
      key: req.headers.apikey === undefined ? 'none' : (req.headers.apikey === KEY ? 'right' : 'wrong'),
      appName: req.headers['application-name'] || '', appVersion: req.headers['application-version'] || '',
      contentMd5: req.headers['content-md5'] || '', contentDisposition: req.headers['content-disposition'] || '', contentType: req.headers['content-type'] || '',
      crc: req.headers['x-amz-checksum-crc64nvme'] || '', boundCrc: url.searchParams.get('x-amz-checksum-crc64nvme') || '', length: body.length, json: isApi ? json : null });
    // The newest published revision is public on Nexus and answered without
    // a key, as the real one does (NexusPublished.ps1, #4068); every other
    // API request needs it.
    const isPublicRead = url.pathname === '/v2/graphql' && json && typeof json.query === 'string' &&
      /^\{ collection\(slug: "[A-Za-z0-9]+", domainName: "[a-z0-9]+"\) \{ latestPublishedRevision \{ revisionNumber \} \} \}$/.test(json.query);
    if (isApi) {
      if (req.headers.apikey !== KEY && !(isPublicRead && req.headers.apikey === undefined)) { violations.push('an API request without the key: ' + req.method + ' ' + url.pathname); return problem(res, 401, 'apikey'); }
      if (!req.headers['application-name'] || !req.headers['application-version']) { violations.push('an API request without Application-Name and Application-Version: ' + url.pathname); return problem(res, 400, 'Application headers'); }
      if (url.pathname === '/v2/graphql') return graph(req, res, json);
      return api(req, res, url, body, json);
    }
    if (url.pathname.startsWith('/s3/')) return storage(req, res, url, body);
    if (url.pathname.startsWith('/cdn/')) return cdn(req, res, url);
    return problem(res, 404, 'nothing here');
  });
});
server.listen(0, '127.0.0.1', () => { console.log('[nexus] listening on 127.0.0.1:' + server.address().port); });
