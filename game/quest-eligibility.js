'use strict';
// Pure eligibility for the expanded catalogue. The caller owns session fences
// and reads saved state without entering character initialization or migration.
function record(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function field(value, key) {
  if (!record(value)) return undefined;
  var desc = Object.getOwnPropertyDescriptor(value, key);
  return desc && desc.enumerable && Object.prototype.hasOwnProperty.call(desc, 'value') ? desc.value : undefined;
}
function strings(value) {
  if (!Array.isArray(value)) return null;
  var out = [];
  for (var i = 0; i < value.length; i++) {
    var desc = Object.getOwnPropertyDescriptor(value, i);
    if (!desc || !desc.enumerable || !Object.prototype.hasOwnProperty.call(desc, 'value') ||
        typeof desc.value !== 'string') return null;
    out.push(desc.value);
  }
  return out;
}
function createQuestEligibility(source) {
  var table, spellIds;
  try {
    table = JSON.parse(JSON.stringify(source.table));
    spellIds = JSON.parse(JSON.stringify(source.spellIds));
    if (!record(table) || !Array.isArray(table.ranks) ||
        table.ranks.join(',') !== 'novice,advanced,expert,master' ||
        !record(table.classes) || !record(table.professions) ||
        !Array.isArray(table.schools) || !record(table.spells) || !record(spellIds)) throw Error('metadata');
  } catch (error) { throw new Error('Invalid quest eligibility metadata.'); }
  var ranks = table.ranks;
  function validate(gate) {
    function invalid() { throw new Error('Invalid quest gate.'); }
    if (!record(gate)) return invalid();
    var prototype = Object.getPrototypeOf(gate);
    if (prototype !== null && prototype !== Object.prototype) return invalid();
    var keys = Reflect.ownKeys(gate), out = Object.create(null);
    keys.forEach(function (key) {
      if (['open', 'classKey', 'profession', 'rank', 'half', 'school'].indexOf(key) < 0 ||
          (key === 'open' ? field(gate, key) !== true : typeof field(gate, key) !== 'string')) invalid();
      out[key] = field(gate, key);
    });
    if (keys.length === 1 && out.open === true) return Object.freeze(out);
    if (field(out, 'open') !== undefined || ranks.indexOf(out.rank) < 0) return invalid();
    if (field(out, 'classKey') !== undefined) {
      if (keys.length !== 2 || !field(table.classes, out.classKey)) return invalid();
    } else {
      var profession = field(table.professions, out.profession);
      if (!record(profession)) return invalid();
      if (out.profession === 'mage') {
        if (field(out, 'half') !== undefined || keys.length !== (field(out, 'school') === undefined ? 2 : 3) ||
            field(out, 'school') !== undefined && table.schools.indexOf(out.school) < 0 ||
            out.rank === 'master' && field(out, 'school') === undefined) return invalid();
      } else if (field(out, 'school') !== undefined ||
          keys.length !== (field(out, 'half') === undefined ? 2 : 3) ||
          !record(profession.halves) || field(out, 'half') !== undefined && !field(profession.halves, out.half) ||
          out.rank === 'master' && field(out, 'half') === undefined) return invalid();
    }
    return Object.freeze(out);
  }
  function check(gate, state) {
    function missing(detail) { return {ok:false, why:'eligibility', detail:detail}; }
    function title(key) { return key.charAt(0).toUpperCase() + key.slice(1); }
    try {
      gate = validate(gate);
      if (gate.open === true) return {ok:true};
      var standing = field(state, 'ranks');
      if (field(state, 'v') !== 1 || !record(standing)) return missing();
      function hasRank(key) {
        var index = ranks.indexOf(field(standing, key));
        return index >= 0 && index >= ranks.indexOf(gate.rank);
      }
      function rankOf(name) { return missing('This work requires ' + title(gate.rank) + ' standing in ' + name + '.'); }
      if (field(gate, 'classKey') !== undefined) {
        var cls = table.classes[gate.classKey].name || title(gate.classKey);
        if (field(state, 'cls') !== gate.classKey) return missing('This work requires the ' + cls + ' class.');
        return hasRank(gate.classKey) ? {ok:true} : rankOf(cls);
      }
      var profession = table.professions[gate.profession], name = profession.name || title(gate.profession);
      if (field(state, 'prof') !== gate.profession) return missing('This work requires the ' + name + ' profession.');
      if (gate.profession !== 'mage') {
        var halves = Object.keys(profession.halves);
        var qualified = field(gate, 'half') !== undefined ? hasRank(gate.half) : halves.some(hasRank);
        return qualified ? {ok:true} : rankOf(gate.half ? profession.halves[gate.half] : name);
      }
      var schools = strings(field(state, 'schools'));
      if (!schools || schools.some(function (s) {return table.schools.indexOf(s) < 0;})) return missing();
      var selected = field(gate, 'school') !== undefined ? [gate.school] : schools;
      var ranked = selected.some(function (school) { return schools.indexOf(school) >= 0 && hasRank(school); });
      if (!ranked) return rankOf(gate.school ? title(gate.school) : 'a school of magic');
      if (gate.rank !== 'master') return {ok:true};
      // A master gate names exactly one school. Its mastered spell is required as well as the saved rank.
      var known = strings(field(field(state, 'spells'), 'known'));
      var master = field(field(table.spells, gate.school), 'master');
      var mastered = !!known && Array.isArray(master) && known.some(function (spell) {
        var desc = field(spellIds, spell);
        return master.indexOf(spell) >= 0 && typeof desc === 'string' &&
          /^[0-9a-f]{1,6}:[^:\r\n]+\.(?:esm|esp|esl)$/i.test(desc);
      });
      return mastered ? {ok:true} : missing('This work requires a Master ' + title(gate.school) + ' spell.');
    } catch (error) { return missing(); }
  }
  function allows(gate, state) { return check(gate,state).ok; }
  return Object.freeze({validate: validate, allows: allows, check: check});
}
module.exports = {createQuestEligibility: createQuestEligibility};
