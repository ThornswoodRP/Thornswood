'use strict';

// Host-side read-only bridge. No apply, insert, update, delete, export or backup operation.
const fs = require('node:fs');
const path = require('node:path');
const { createCounter } = require('./PropertyResetWorldPreview');
const record = require('../../records/mongodb.json');

function fail() {
  throw Error('Mongo reset preview cannot be verified');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function bind(plan) {
  const keys = ['version', 'environment', 'database', 'uriFile', 'maxForms', 'source', 'fixtureRoot'];
  if (!plan || Object.keys(plan).length !== keys.length || !keys.every(key => Object.hasOwn(plan, key)) ||
      plan.version !== 1 || !/^[a-f0-9]{40}$/.test(plan.source) ||
      !Number.isSafeInteger(plan.maxForms) || plan.maxForms < 1 || plan.maxForms > 200000) fail();

  if (plan.environment === 'fixture') {
    const root = fs.realpathSync(plan.fixtureRoot);
    const scope = readJson(path.join(root, 'scope.json'));
    if (scope.kind !== 'local-disposable-mongo-fixture' || scope.root !== root ||
        !/^[a-f0-9]{16}$/.test(scope.nonce) || path.basename(root) !== 'db-fixture-' + scope.nonce ||
        scope.data !== path.join(root, 'data') || plan.database !== 'thornswood-reset-fixture-' + scope.nonce ||
        scope.database !== plan.database || plan.uriFile !== path.join(root, 'connection.uri') ||
        !Number.isSafeInteger(scope.port) || scope.port < 1024 || scope.port > 65535) fail();
    const uri = fs.readFileSync(plan.uriFile, 'utf8').trim();
    if (uri !== 'mongodb://127.0.0.1:' + scope.port + '/?directConnection=true') fail();
    return { uri, fixture: scope };
  }

  const server = plan.environment === 'main' ? 'live' : plan.environment === 'dev' ? 'dev' : '';
  const expectedFile = 'C:\\Thornswood-Mongo\\access\\' + server + '.uri';
  if (!server || plan.fixtureRoot !== '' || plan.database !== 'thornswood-' + server ||
      typeof plan.uriFile !== 'string' || path.win32.resolve(plan.uriFile).toLowerCase() !== expectedFile.toLowerCase()) fail();
  const uri = fs.readFileSync(plan.uriFile, 'utf8').trim();
  const parsed = new URL(uri);
  if (parsed.protocol !== 'mongodb:' || parsed.hostname !== record.bindIp || Number(parsed.port) !== record.port) fail();
  return { uri, fixture: null };
}

async function run(driver, planFile) {
  let connection;
  try {
    const plan = readJson(planFile);
    const binding = bind(plan);
    const counter = createCounter({ maxForms: plan.maxForms });
    connection = await new driver.Mongo(binding.uri);
    const admin = connection.getDB('admin');
    const version = await admin.runCommand({ buildInfo: 1 });
    if (version.ok !== 1 || version.version !== record.server.version) fail();
    if (binding.fixture) {
      const command = await admin.runCommand({ getCmdLineOpts: 1 });
      if (command.ok !== 1 || path.resolve(command.parsed.storage.dbPath) !== binding.fixture.data ||
          command.parsed.net.port !== binding.fixture.port || command.parsed.net.bindIp !== '127.0.0.1') fail();
    }
    const database = connection.getDB(plan.database);
    const collections = await database.getCollectionInfos({ name: 'changeForms' });
    if (collections.length !== 1 || collections[0].type !== 'collection') fail();
    const forms = database.getCollection('changeForms');
    const beforeCount = await forms.countDocuments({});
    if (!Number.isSafeInteger(beforeCount) || beforeCount > plan.maxForms) fail();
    // Server-generated types distinguish actual BSON numbers from literal EJSON-shaped documents.
    const entryTypes = input => ({ $cond: [
      { $isArray: input },
      { $map: { input, as: 'entry', in: { base: { $type: '$$entry.baseId' }, count: { $type: '$$entry.count' } } } },
      null
    ] });
    const projection = { formDesc: 1, recType: 1, inv: 1, equipmentDump: 1,
      baseDesc: 1, count: 1, isDeleted: 1, _id: 0,
      __resetPreviewTypes: { recType: { $type: '$recType' }, count: { $type: '$count' },
        inventory: entryTypes('$inv.entries'), equipment: entryTypes('$equipmentDump.inv.entries') } };
    // Imported Node modules do not receive mongosh's implicit-await rewriting.
    let cursor = await forms.aggregate([{ $project: projection }], { allowDiskUse: false });
    cursor = await cursor.sort({ formDesc: 1 });
    cursor = await cursor.batchSize(1000);
    cursor = await cursor.maxTimeMS(60000);
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      counter.addCanonicalJson(driver.EJSON.stringify(doc, null, 0, { relaxed: false }));
    }
    const result = counter.result();
    if (result.counts.forms !== beforeCount || await forms.countDocuments({}) !== beforeCount) fail();
    return { environment: plan.environment, source: plan.source, ...result };
  } catch (_) {
    fail();
  } finally {
    if (connection && typeof connection.close === 'function') {
      try { await connection.close(); } catch (_) { /* no write occurred; process exit also closes the reader */ }
    }
  }
}

module.exports = { run };
