'use strict';

// Read-only candidate counts from canonical Extended JSON. No rows or removal decisions out.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, name) => Object.hasOwn(value, name);
const targets = new Set([0x15493, 0x15494, 0x15495, 0x154e0]);

function fail() {
  throw Error('World reset preview cannot be verified');
}

function uint32(value, positive, bsonType) {
  if (!object(value) || Object.keys(value).length !== 1) fail();
  const expected = { int: '$numberInt', long: '$numberLong', double: '$numberDouble' }[bsonType];
  if (!expected || !own(value, expected)) fail();
  let number;
  if (own(value, '$numberInt') || own(value, '$numberLong')) {
    const text = value.$numberInt ?? value.$numberLong;
    if (typeof text !== 'string' || text.length > 20 || !/^-?(0|[1-9][0-9]*)$/.test(text)) fail();
    const integer = BigInt(text);
    if (integer < 0n || integer > 0xffffffffn || bsonType === 'int' && integer > 2147483647n) fail();
    number = Number(integer);
  } else if (own(value, '$numberDouble')) {
    const text = value.$numberDouble;
    if (typeof text !== 'string' || text.length > 64 || !/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(text)) fail();
    number = Number(text);
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) fail();
  } else fail();
  if (positive && number === 0) fail();
  return number;
}

function descriptor(value) {
  if (typeof value !== 'string') fail();
  const match = /^([0-9a-f]{1,6}):([^:/\\\x00-\x1f]+\.(esm|esp|esl))$/i.exec(value);
  if (!match) fail();
  return match[2].toLowerCase() === 'thornswood-content.esp' && targets.has(parseInt(match[1], 16));
}

function createCounter(options) {
  if (!options || !Number.isSafeInteger(options.maxForms) || options.maxForms < 1 || options.maxForms > 200000) fail();
  const counts = { forms: 0, inventoryStacks: 0, candidateStacks: 0, candidateUnits: 0,
    legacyNumericStacks: 0, legacyNumericUnits: 0, runtimeStacks: 0,
    dropCandidateStacks: 0, dropCandidateUnits: 0, staticTargetDrops: 0,
    wornCandidateStacks: 0, equipmentCandidateStacks: 0, malformedRecords: 0, duplicateForms: 0 };
  const forms = new Set();

  function entry(value, equipment, proof) {
    if (!object(value) || !object(proof)) fail();
    const units = uint32(value.count, true, proof.count);
    for (const flag of ['worn', 'wornLeft']) {
      if (own(value, flag) && typeof value[flag] !== 'boolean') fail();
    }
    if (!equipment) counts.inventoryStacks++;
    if (value.baseId === 'made' && proof.base === 'string' && object(value.made)) {
      if (!equipment) counts.runtimeStacks++;
      return;
    }
    if (typeof value.baseId !== 'string') {
      const base = uint32(value.baseId, true, proof.base);
      if (!equipment) {
        if (base >= 0xff000000) counts.runtimeStacks++;
        else { counts.legacyNumericStacks++; counts.legacyNumericUnits += units; }
      }
      return;
    }
    if (proof.base !== 'string') fail();
    if (!descriptor(value.baseId)) return;
    if (equipment) { counts.equipmentCandidateStacks++; return; }
    counts.candidateStacks++;
    counts.candidateUnits += units;
    if (value.worn === true || value.wornLeft === true) counts.wornCandidateStacks++;
  }

  function add(doc) {
    if (counts.forms >= options.maxForms) fail();
    counts.forms++;
    const previous = { ...counts };
    try {
      if (!object(doc) || typeof doc.formDesc !== 'string' ||
          !/^[0-9a-f]{1,8}(:[^:\\/*?"<>|\x00-\x1f]+)?$/.test(doc.formDesc)) fail();
      if (forms.has(doc.formDesc)) counts.duplicateForms++;
      forms.add(doc.formDesc);
      const proof = doc.__resetPreviewTypes;
      if (!object(doc.inv) || !Array.isArray(doc.inv.entries) || !object(proof) ||
          !Array.isArray(proof.inventory) || proof.inventory.length !== doc.inv.entries.length) fail();
      for (let index = 0; index < doc.inv.entries.length; index++) entry(doc.inv.entries[index], false, proof.inventory[index]);
      if (doc.equipmentDump !== undefined && doc.equipmentDump !== null) {
        if (!object(doc.equipmentDump) || !object(doc.equipmentDump.inv) || !Array.isArray(doc.equipmentDump.inv.entries)) fail();
        if (!Array.isArray(proof.equipment) || proof.equipment.length !== doc.equipmentDump.inv.entries.length) fail();
        for (let index = 0; index < doc.equipmentDump.inv.entries.length; index++) {
          entry(doc.equipmentDump.inv.entries[index], true, proof.equipment[index]);
        }
      }
      if (doc.isDeleted !== undefined && typeof doc.isDeleted !== 'boolean') fail();
      if (typeof doc.baseDesc === 'string' && doc.baseDesc.includes(':') && descriptor(doc.baseDesc) && doc.isDeleted !== true) {
        if (doc.formDesc.includes(':')) counts.staticTargetDrops++;
        else {
          if (uint32(doc.recType, false, proof.recType) !== 0) fail();
          counts.dropCandidateStacks++;
          counts.dropCandidateUnits += uint32(doc.count, true, proof.count);
        }
      }
    } catch (_) {
      const duplicates = counts.duplicateForms;
      Object.assign(counts, previous);
      counts.duplicateForms = duplicates;
      counts.malformedRecords++;
    }
    if (!Object.values(counts).every(Number.isSafeInteger)) fail();
  }

  return {
    add,
    addCanonicalJson(text) {
      if (typeof text !== 'string' || Buffer.byteLength(text) > 8 * 1024 * 1024) fail();
      let doc;
      try { doc = JSON.parse(text); } catch (_) { fail(); }
      add(doc);
    },
    result() {
      return { mode: 'preview-only', blocked: true,
        coverage: { world: counts.malformedRecords === 0 && counts.duplicateForms === 0,
          propertyClaims: false, farmClaims: false,
          privateItems: false, protectedInstances: false, pendingTransfers: false },
        counts: { ...counts } };
    }
  };
}

function previewWorld(documents, options) {
  try {
    const counter = createCounter(options);
    for (const doc of documents) counter.add(doc);
    return counter.result();
  } catch (_) { fail(); }
}

module.exports = { createCounter, previewWorld };
