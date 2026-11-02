// ==== thornswood staff crafting ====
/*
  STAFF CRAFTING TOOLS, ON THE OFFICE PAGE OF K (#3167). Patrick, 22 Oct
  2026, on his report page: in game, on the K panel's Office page, and not
  commands. Three tools, for one person in the world that the staff member
  picks on the card:

    Ranks        every class, half and school the person has standing in,
                 with its rank and the work toward the next, and a Raise
                 button. A raise is one step through the rulebook's own
                 rankUp, so every ceiling holds (a taught trade stays at
                 novice, a sister half past novice needs its Master, a Master
                 is done), and it hands what a rank always hands: the skill
                 point, a mage's spell point, an Enchanter's staff spell
                 point. The count toward the next rank starts again at 0, as
                 it does when work raises the rank (professions.md).
    A recipe     recipes asked by what they make, for that person. A recipe
                 is stuck for one of four reasons, and the card names which:
                   - the craft gate refuses it, and says why (a rank, a half,
                     a race, a roll), which the rank tool or the person's own
                     picks change;
                   - their game was handed an older answer than the gate
                     gives now. Hand their game the list asks
                     handRecipesHidden, the one writer of that list, which
                     writes only when the answer changed, and a write is
                     logged as a finding, because everything that changes the
                     answer writes the character and hands the list itself;
                   - the game's own recipe asks for something first (a perk,
                     an item or a spell: the table's open is false), which
                     Skyrim's menu decides before the server is ever asked;
                   - none of those, and the server lists it for them.
    Give back    any item, by name or form id, with a count and a reason,
                 into their pack. NOTHING RECORDS WHAT SOMEBODY LOST: the
                 engine keeps the pack and nothing keeps what it used to
                 hold, so staff go on what the person and the logs say, and
                 the reason is the record. It is in the staff log with the
                 count and the item, and the person is told.

  WHO MAY. The staff block's own gate, before anything here runs: /craftstaff
  is in its WORDS_STAFF, so somebody who is not staff is told "That one is not
  yours to run.", and staff need the proven chat and the join pass. Nobody
  raises their own rank or gives themselves anything here: another staff
  member does it, so the staff log names two people.

  /craftstaff is a line the page sends, never one anybody is told to type:
    pick <profile>|-                     the person the card is for, or nobody
    raise <profile> <key>                one rank up in that class, half or school
    recipe <profile> <words>             what the gate says about recipes making that
    recipes <profile>                    hand their game the gate's list now
    give <profile> <n> <item> | <why>    give back n of an item, with the reason
*/
(function () {
  'use strict';
  var g = globalThis;
  var PEOPLE_MAX = 40;          // people the card offers to pick from
  var CHECK_MAX = 8;            // recipe rows one check lists
  var ASK_MOST = 60;            // characters of a recipe check kept
  var GIVE_MOST = 1000;         // the most of one thing given back in one press
  var WHY_MOST = 200;           // characters of a reason kept in the log

  // On globalThis, so a hot reload keeps who each staff member picked and
  // what they last checked; a restart forgets both, and the card says so by
  // offering the people again.
  if (!g.__thornswoodStaffCraftState) { g.__thornswoodStaffCraftState = { picked: {}, checks: {} }; }
  var state = g.__thornswoodStaffCraftState;

  function clog() {
    log.apply(null, ['staff crafting:'].concat(Array.prototype.slice.call(arguments)));
  }
  function tell(pid, text) {
    var t = g.__thornswoodToProfile;
    if (t && pid) { t(pid, text); }
  }
  function online() {
    try { return mp.get(0, 'onlinePlayers') || []; } catch (e) { return []; }
  }
  function profileOf(actorId) {
    try { return Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { return 0; }
  }
  function nameOfActor(actorId) {
    try {
      var ap = mp.get(actorId, 'appearance');
      if (ap && ap.name) { return String(ap.name); }
    } catch (e) { }
    return 'somebody';
  }
  function actorOf(pid) {
    var all = online();
    for (var i = 0; i < all.length; i++) { if (profileOf(all[i]) === pid) { return all[i]; } }
    return 0;
  }
  function rankWord(r) { return String(r || '').charAt(0).toUpperCase() + String(r || '').slice(1); }
  function sentence(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  /* How many of a record the pack holds, plain stock only, the way addItem counts it. */
  function carried(actorId, desc) {
    var id = idOf(desc);
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { inv = null; }
    var n = 0;
    var entries = (inv && Array.isArray(inv.entries)) ? inv.entries : [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e && e.baseId === id && !mintedEntry(e)) { n += Number(e.count) || 0; }
    }
    return n;
  }

  // ----------------------------------------------------------- the ranks --
  function rules() {
    var P = g.__thornswoodProgression, C = g.__thornswoodCharacter;
    return (P && C && C.stateOf && C.writeState) ? { P: P, C: C } : null;
  }

  /* One step up in key, as rankUp takes it, with the count started again, or the rulebook's reason it will not. */
  function raiseOf(r, actorId, s, key) {
    var up = r.P.rankUp(s, key, r.C.masterFor ? r.C.masterFor(actorId, s, key) : null);
    if (!up.ok) { return { ok: false, why: String(up.why || '') }; }
    up.state.work = up.state.work || {};
    up.state.work[key] = 0;
    return { ok: true, state: up.state };
  }

  function ranksOf(r, actorId, s) {
    var out = [];
    var ranks = (s && s.ranks) || {};
    for (var key in ranks) {
      if (!Object.prototype.hasOwnProperty.call(ranks, key)) { continue; }
      var up = raiseOf(r, actorId, s, key);
      out.push({ key: key, name: r.C.nameOf ? r.C.nameOf(key) : key, rank: ranks[key],
                 next: up.ok ? r.P.rankOf(up.state, key) : null,
                 work: r.P.workDone(s, key), need: r.P.workNeeded(s, key),
                 why: up.ok ? '' : sentence(up.why) });
    }
    out.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    return out;
  }

  // ---------------------------------------------------------- the recipes --
  /* The owned recipe rows whose output's name holds the words, at most CHECK_MAX. */
  function recipeRows(want) {
    var w = String(want || '').replace(/[‘’`]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
    var out = [], more = false;
    if (!w) { return { rows: out, more: more }; }
    var tables = [RECIPES_BY_ID, KEPT_SMELT];
    for (var t = 0; t < tables.length && !more; t++) {
      for (var desc in tables[t]) {
        if (!Object.prototype.hasOwnProperty.call(tables[t], desc)) { continue; }
        var row = tables[t][desc];
        if (!row || typeof row !== 'object' || String(row.name || '').toLowerCase().indexOf(w) === -1) { continue; }
        if (out.length >= CHECK_MAX) { more = true; break; }
        out.push({ desc: desc, row: row });
      }
    }
    return { rows: out, more: more };
  }

  /* Whether the person's game was handed this row as one to leave off the benches. */
  function handedHidden(actorId, desc) {
    var v = null;
    try { v = mp.get(actorId, RECIPES_HIDDEN_PROPERTY); } catch (e) { v = null; }
    var at = desc.indexOf(':');
    var files = (v && v.files) || {};
    return String(files[desc.slice(at + 1)] || '').split(',').indexOf(desc.slice(0, at)) !== -1;
  }

  function checkOf(actorId, want) {
    var found = recipeRows(want);
    return {
      want: String(want), more: found.more,
      rows: found.rows.map(function (x) {
        var refusal = craftAnswer(actorId, x.row).refusal;
        var hidden = handedHidden(actorId, x.desc);
        return { name: String(x.row.name || x.desc), half: String(x.row.half || ''), rank: String(x.row.rank || ''),
                 may: !refusal, why: refusal ? String(refusal) : '', hidden: hidden,
                 stale: (!refusal) === hidden, asks: x.row.open === false };
      })
    };
  }

  // ------------------------------------------------------------- the card --
  /** The Office page's crafting card for this staff member, or null when the tools are not running. */
  function staffView(staffPid) {
    var pid = Number(staffPid) || 0;
    var r = rules();
    if (!pid || !r) { return null; }
    var people = [];
    var all = online();
    for (var i = 0; i < all.length; i++) {
      var op = profileOf(all[i]);
      if (op) { people.push({ pid: op, name: nameOfActor(all[i]) }); }
    }
    people.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : a.pid - b.pid); });
    var view = { people: people.slice(0, PEOPLE_MAX), them: null };
    var picked = Number(state.picked[pid]) || 0;
    var actorId = picked ? actorOf(picked) : 0;
    if (!actorId) { return view; }
    var check = state.checks[pid];
    view.them = {
      pid: picked, name: nameOfActor(actorId), self: picked === pid,
      ranks: ranksOf(r, actorId, r.C.stateOf(actorId)),
      check: (check && check.pid === picked) ? checkOf(actorId, check.want) : null
    };
    return view;
  }

  /* This staff member's own K panel again, so the card says what is true now. */
  function redraw(actorId) {
    var r = rules();
    if (!r || !actorId) { return; }
    try { r.C.writeState(actorId, r.C.stateOf(actorId), true); } catch (e) { clog('the card could not be drawn again:', e); }
  }

  // ------------------------------------------------------------ the lines --
  /*
    From the staff block's command, once it has said this is staff with the
    proven chat and the join pass. words is the line after /craftstaff, me is
    the staff member's name, and look is /give's own lookups.
  */
  function command(words, pid, actorId, me, look) {
    var st = g.__thornswoodStaff;
    var verb = String(words[0] || '').toLowerCase();
    var r = rules();
    if (!r || !st || !st.record) {
      tell(pid, 'The staff crafting tools are not running on this server. Say so in the dev channel.');
      return true;
    }
    if (verb === 'pick') {
      var want = String(words[1] || '');
      delete state.checks[pid];
      if (want === '-') { delete state.picked[pid]; redraw(actorId); return true; }
      var n = /^\d+$/.test(want) ? Number(want) : 0;
      if (!n || !actorOf(n)) { tell(pid, 'That person is not in the world now.'); redraw(actorId); return true; }
      state.picked[pid] = n;
      redraw(actorId);
      return true;
    }

    var whoPid = /^\d+$/.test(String(words[1] || '')) ? Number(words[1]) : 0;
    var them = whoPid ? actorOf(whoPid) : 0;
    if (!them) { tell(pid, 'That person is not in the world now, so nothing changed.'); redraw(actorId); return true; }
    var name = nameOfActor(them);

    if (verb === 'recipe') {
      var asked = words.slice(2).join(' ').trim().slice(0, ASK_MOST);
      if (!asked) { tell(pid, 'Type part of the name of what the recipe makes, then press Check.'); return true; }
      state.checks[pid] = { pid: whoPid, want: asked };
      if (!recipeRows(asked).rows.length) { tell(pid, 'No recipe anybody owns makes anything called ' + asked + '.'); }
      redraw(actorId);
      return true;
    }
    if (verb === 'recipes') {
      var had = null, has = null;
      try { had = JSON.stringify(mp.get(them, RECIPES_HIDDEN_PROPERTY)); } catch (e) { had = null; }
      handRecipesHidden(them);
      try { has = JSON.stringify(mp.get(them, RECIPES_HIDDEN_PROPERTY)); } catch (e2) { has = null; }
      if (had !== has) {
        // A finding: the gate's answer changed with nothing writing the character.
        clog(name, '(profile ' + whoPid + ') had an older recipe list than the craft gate gives now, so it was handed the new one');
        st.record('craftrecipes', pid, me, whoPid, name, 'their game had an older recipe list than the craft gate gives now', 0);
        tell(pid, name + '\'s game had an older recipe list than the craft gate gives now. It has the new one, and their benches change as it lands. It is in the staff log.');
      } else {
        tell(pid, name + '\'s game already has the list the craft gate gives now, so nothing changed.');
      }
      redraw(actorId);
      return true;
    }

    // Everything below changes the person, so it is never your own.
    if (whoPid === pid) {
      tell(pid, 'Not on yourself: another staff member does it, so the staff log names two people. Nothing changed.');
      return true;
    }

    if (verb === 'raise') {
      var key = String(words[2] || '').toLowerCase();
      var s = r.C.stateOf(them);
      var was = r.P.rankOf(s, key);
      if (!was) { tell(pid, name + ' has no standing in that, so nothing changed.'); redraw(actorId); return true; }
      var up = raiseOf(r, them, s, key);
      if (!up.ok) { tell(pid, name + ': ' + sentence(up.why) + '. Nothing changed.'); redraw(actorId); return true; }
      var ns = up.state;
      var gave = { key: key, from: was, to: r.P.rankOf(ns, key),
                   points: (ns.points || 0) - (s.points || 0),
                   spellPoints: ((ns.spells && ns.spells.points) || 0) - ((s.spells && s.spells.points) || 0),
                   staffPoints: ns.prof === 'enchanter' ? r.P.staffPoints(ns) - r.P.staffPoints(s) : 0 };
      r.C.writeState(them, ns);
      var what = r.C.nameOf ? r.C.nameOf(key) : key;
      tell(whoPid, 'Staff raised your rank. ' + (r.C.raiseLines(them, { raised: gave }) || ''));
      tell(pid, name + ' is now ' + rankWord(gave.to) + ' in ' + what + '. It is in the staff log.');
      st.record('craftrank', pid, me, whoPid, name, what + ' from ' + rankWord(was) + ' to ' + rankWord(gave.to), 0,
                { key: key, from: was, to: gave.to });
      redraw(actorId);
      return true;
    }

    if (verb === 'give') {
      var rest = words.slice(2).join(' ');
      var bar = rest.indexOf('|');
      var why = bar < 0 ? '' : rest.slice(bar + 1).replace(/\s+/g, ' ').trim().slice(0, WHY_MOST);
      var head = (bar < 0 ? rest : rest.slice(0, bar)).trim().split(/\s+/);
      var count = /^\d+$/.test(head[0] || '') ? Number(head[0]) : 0;
      var thing = head.slice(1).join(' ').trim().toLowerCase();
      if (!(count > 0) || count > GIVE_MOST) { tell(pid, 'Give back 1 to ' + GIVE_MOST + ' at a time. Nothing changed.'); return true; }
      if (!thing) { tell(pid, 'Give back what? Type its name. Nothing changed.'); return true; }
      if (!why) { tell(pid, 'Say why: what they lost, and how. It goes in the staff log. Nothing changed.'); return true; }
      var hit = (look && look.findThing) ? look.findThing(thing) : { why: 'The server has no item list right now.' };
      if (!hit.desc && look && look.byFormId) { hit = look.byFormId(thing) || hit; }
      if (!hit.desc) { tell(pid, String(hit.why || 'Nothing is called that.') + ' Nothing changed.'); return true; }
      if (!addItem(them, hit.desc, count)) {
        tell(pid, hit.name + '\'s plugin is not in this load order, so there is nothing to give back.');
        return true;
      }
      tell(whoPid, 'Staff gave you back ' + count + ' ' + hit.name + '.');
      tell(pid, 'Gave ' + name + ' back ' + count + ' ' + hit.name + '. They carry ' + carried(them, hit.desc) +
                ' now. It is in the staff log.');
      st.record('craftgive', pid, me, whoPid, name, count + ' ' + hit.name + ': ' + why, 0,
                { item: hit.desc, count: count });
      redraw(actorId);
      return true;
    }

    tell(pid, 'The crafting card on the Office page of K picks somebody, raises a rank, checks a recipe and gives back. Nothing changed.');
    return true;
  }

  g.__thornswoodStaffCraft = { staffView: staffView, command: command, state: state };
  clog('ready');
})();
// ==== end thornswood staff crafting ====

