// ==== thornswood custom quests ====
/*
  Scarce quests and scene quests, from the two tables on
  docs/systems/quests.md. Supply is not this block. Scene gold is created
  in the quest's atomic inventory commit. It is not taken from a trader purse.

  The rare mine is bound: RARE_PLACES below is the one building each rare
  seam is, and every vein of that seam anywhere else stays shut. The other
  scarce sources and scene places are specified in quest-locations.md.
  Seven retrievals use measured original sources and their appointed specialists;
  the mammoth ground and existing Farmer orchard use their verified source controllers. The miner offer requires an explicit
  choice among the four gems on the miner page.
*/
(function () {
  var HOUR = 60 * 60 * 1000;
  var GEMS = ['Amethyst', 'Emerald', 'Ruby', 'Sapphire'];
  var RARE = {
    'Ebony Ore': 'ebony',
    'Amethyst': 'gem',
    'Emerald': 'gem',
    'Ruby': 'gem',
    'Sapphire': 'gem',
    'Stalhrim': 'stalhrim',
    'Heart Stone': 'heartstone'
  };
  /*
    THE ONE PLACE EACH RARE SEAM IS (#1380).

    Patrick, 4 Oct: ebony is Raven Rock Mine, stalhrim Kolbjorn Barrow, heart
    stone Coldcinder Cave, ruby White Ridge Sanctum, sapphire Highpoint Tower,
    emerald Kolbjorn Barrow, amethyst Highpoint Tower. A place is the
    building, keyed by its cell as game/data/mine-buildings.json keys it, so
    every vein of that seam inside it is the place (thirteen ebony in Raven
    Rock Mine) and the same seam in any other building or on open ground is
    shut. The trader's scarce quest is the only way in. Once it is turned in
    the place is shut to that person until the quest's cooldown ends, which
    turnIn stamps below. No steward has any part in it.
  */
  var RARE_PLACES = {
    ebony: { cell: '142fc:Dragonborn.esm' },
    stalhrim: { cell: '142ee:Dragonborn.esm' },
    heartstone: { cell: '3929e:Dragonborn.esm' },
    gem: {
      cells: {
        Ruby: '3c7f5:Dragonborn.esm',
        Sapphire: '184f0:Dragonborn.esm',
        Emerald: '142ee:Dragonborn.esm',
        Amethyst: '184f0:Dragonborn.esm'
      }
    }
  };
  var SCARCE = [
    { gate: {classKey: 'miner', rank: 'master'}, id: 'ebony', name: 'The ebony', who: 'Miner, master', classKey: 'miner', rank: 'master', ask: 4, holds: 12, hours: 24, scarce: true },
    { gate: {classKey: 'miner', rank: 'master'}, id: 'gem', name: 'A gem', who: 'Miner, master', classKey: 'miner', rank: 'master', ask: 2, holds: 6, hours: 24, scarce: true, gems: GEMS },
    { gate: {classKey: 'miner', rank: 'master'}, id: 'stalhrim', name: 'The stalhrim', who: 'Miner, master', classKey: 'miner', rank: 'master', ask: 3, holds: 8, hours: 24, scarce: true },
    { gate: {classKey: 'miner', rank: 'master'}, id: 'heartstone', name: 'The heart stone', who: 'Miner, master', classKey: 'miner', rank: 'master', ask: 3, holds: 8, hours: 24, scarce: true },
    { gate: {classKey: 'fisher', rank: 'master'}, id: 'longfin', name: 'The longfin', who: 'Fisher, master', classKey: 'fisher', rank: 'master', ask: 2, holds: 8, hours: 12, scarce: true },
    { gate: {classKey: 'fisher', rank: 'expert'}, id: 'pearl', name: 'The pearl bed', who: 'Fisher, expert', classKey: 'fisher', rank: 'expert', ask: 1, holds: 3, hours: 8, scarce: true },
    { gate: {classKey: 'gatherer', rank: 'novice'}, id: 'crimson', name: 'The crimson', who: 'Gatherer', classKey: 'gatherer', rank: '', ask: 3, holds: 8, hours: 12, scarce: true },
    { gate: {classKey: 'hunter', rank: 'master'}, id: 'mammoth', name: 'The mammoth ground', who: 'Hunter, master', classKey: 'hunter', rank: 'master', ask: 1, holds: 3, hours: 24, scarce: true },
    { gate: {classKey: 'farmer', rank: 'expert'}, id: 'orchard', name: 'The orchard', who: 'Farmer, expert', classKey: 'farmer', rank: 'expert', ask: 4, holds: 10, hours: 12, scarce: true },
    { gate: {profession: 'enchanter', rank: 'novice'}, id: 'geode', name: 'The geode', who: 'Enchanter', profession: 'enchanter', ask: 2, holds: 6, hours: 12, scarce: true }
  ];
  var SCENE = [
    { gate: {open: true}, id: 'satchel', name: 'The satchel', check: 'A satchel in a sack they name, by a road in this hold.', gold: 20, hours: 3, kind: 'retrieval', count: 0, match: null },
    { gate: {open: true}, id: 'ledger', name: 'The ledger', check: 'A book on a shelf they name. It grants no skill.', gold: 30, hours: 6, kind: 'retrieval', count: 0, match: null },
    { gate: {open: true}, id: 'signet', name: 'The signet', check: 'A ring in a chest they name.', gold: 40, hours: 8, kind: 'retrieval', count: 0, match: null },
    { gate: {open: true}, id: 'locket', name: 'The locket', check: 'A locket in an urn they name.', gold: 45, hours: 10, kind: 'retrieval', count: 0, match: null },
    { gate: {open: true}, id: 'case', name: 'The case', check: 'A sealed case in a strongbox they name. It does not open.', gold: 50, hours: 8, kind: 'retrieval', count: 0, match: null },
    { gate: {open: true}, id: 'dispatch', name: 'The dispatch', check: 'That same kind of case, in a chest in this hold, handed to the trader in a hold they name.', gold: 60, hours: 12, kind: 'retrieval', count: 0, match: null, handoff: true },
    { gate: {open: true}, id: 'seal', name: 'The seal', check: 'A stamp in a chest in a ruin they name.', gold: 70, hours: 14, kind: 'retrieval', count: 0, match: null },
    { gate: {open: true}, id: 'wolf', name: 'A wolf', check: 'You kill a wolf in the place they name in this hold.', gold: 25, hours: 3, kind: 'kill', count: 1, match: 'wolf' },
    { gate: {open: true}, id: 'sabre', name: 'A sabre cat', check: 'You kill a sabre cat in the place they name.', gold: 40, hours: 6, kind: 'kill', count: 1, match: 'sabre cat' },
    { gate: {open: true}, id: 'camp', name: 'The camp', check: 'You kill three bandits in the camp they name.', gold: 45, hours: 6, kind: 'kill', count: 3, match: 'bandit' },
    { gate: {open: true}, id: 'bear', name: 'A bear', check: 'You kill a bear in the place they name.', gold: 50, hours: 8, kind: 'kill', count: 1, match: 'bear' },
    { gate: {open: true}, id: 'barrow', name: 'The barrow', check: 'You kill a draugr in the barrow they name.', gold: 60, hours: 10, kind: 'kill', count: 1, match: 'draugr' },
    { gate: {open: true}, id: 'giant', name: 'A giant', check: 'You kill a giant in this hold.', gold: 100, hours: 18, kind: 'kill', count: 1, match: 'giant' }
  ];
  var expandedRows=typeof MERCHANT_TRADING!=='undefined' && typeof MERCHANT_TRADING.expandedScenes==='function' ?
    MERCHANT_TRADING.expandedScenes() : [];
  SCENE=SCENE.concat(expandedRows.map(function(source){
    return {expanded:true,sourceHash:source.sourceHash,id:source.id,kind:'kill',count:source.count,
      name:source.tier.charAt(0).toUpperCase()+source.tier.slice(1)+': '+source.name,
      who:source.gate.rank.charAt(0).toUpperCase()+source.gate.rank.slice(1)+' '+
        source.gate.profession.charAt(0).toUpperCase()+source.gate.profession.slice(1),gate:source.gate,
      check:source.text+' New guild jobs share a 150-gold daily payment limit, with up to three open jobs.',
      gold:source.rewardGold,hours:source.cooldownHours,merchantRef:source.merchant.reference,role:source.merchant.role};
  }));
  var byId = {};
  SCARCE.concat(SCENE).forEach(function (row) { byId[row.id] = row; });
  var LEGACY_TRADE = {longfin:'Alchemist',pearl:'Enchanter',ebony:'Smith',gem:'Enchanter',stalhrim:'Smith',heartstone:'Smith',
    wolf:'Tailor',sabre:'Tailor',camp:'Smith',bear:'Tailor',barrow:'Smith',giant:'Smith',crimson:'Alchemist',geode:'Enchanter',mammoth:'Cook',orchard:'Cook'};
  // New legacy work has one appointed specialist. Already accepted work
  // keeps its former compatible trade and destination rules after the cut.
  var LEGACY_OFFER_REF = {longfin:'198d2:Skyrim.esm',pearl:'177da:Dragonborn.esm',ebony:'1828f:Dragonborn.esm',gem:'177da:Dragonborn.esm',
    stalhrim:'1828f:Dragonborn.esm',heartstone:'1828f:Dragonborn.esm',
    wolf:'1a684:Skyrim.esm',sabre:'1b124:Skyrim.esm',camp:'1a67c:Skyrim.esm',
    bear:'31efc3:Riften Expansion.esp',barrow:'3a19f:Skyrim.esm',giant:'1a67c:Skyrim.esm',crimson:'1c1aa:Skyrim.esm',geode:'1e7d6:Skyrim.esm',mammoth:'1a66e:Skyrim.esm',orchard:'1a66e:Skyrim.esm'};

  function createCustomQuests(deps) {
    deps = deps || {};
    var active = true;
    var GOLD_DESC = deps.goldDesc;
    var places = {};
    var huntBundles=deps.huntBundles || (typeof MERCHANT_TRADING!=='undefined' && MERCHANT_TRADING.huntBundles);
    var retrievalRows=deps.retrievalData ? JSON.parse(JSON.stringify(deps.retrievalData.sources)) : [];
    var retrievalByQuest=Object.create(null);
    var retrievalPlaces={satchel:'The roadside sack outside Whiterun',ledger:'The upstairs books at Riverwood Trader',
      signet: "The chest in Redoran's Retreat",locket:'The urn in Bleak Falls Temple',
      case:'The strongbox at Whiterun Stables',dispatch:'The chest in Halted Stream Camp',
      seal:'The chest inside the Silent Moons Camp ruins'};
    retrievalRows.forEach(function(source){retrievalByQuest[source.quest]=source;});
    var eligibility = deps.eligibility, gates = Object.create(null);
    if (!eligibility || typeof eligibility.validate !== 'function' || typeof eligibility.allows !== 'function' ||
        typeof deps.readCharacter !== 'function') throw new Error('The custom quests have no eligibility rules.');
    SCARCE.concat(SCENE).forEach(function(row){gates[row.id]=eligibility.validate(row.gate);});
    var kills = deps.killContracts;
    var budget=typeof MERCHANT_TRADING!=='undefined' ? MERCHANT_TRADING.sceneBudget : null;
    if(expandedRows.length && !budget)throw new Error('Expanded scene reward authority is unavailable.');
    function traderFor(row,ref,recovery) {
      if(row.id==='mammoth'||row.id==='orchard')return active && typeof deps.traderRole==='function' && deps.traderRole(ref)==='Cook' && descOf(ref)===LEGACY_OFFER_REF[row.id];
      var retrieval=retrievalByQuest[row.id];
      if(retrieval) {
        if(!active || typeof deps.traderRole!=='function' || deps.traderRole(ref)!==retrieval.role)return false;
        var desc=descOf(ref);
        return desc===retrieval.merchant || recovery===true && desc===retrieval.destination;
      }
      if (typeof deps.traderRole!=='function') return !row.expanded;
      var role=deps.traderRole(ref);
      if(row.expanded)return active && typeof row.role==='string' && row.role.length>0 &&
        role===row.role && descOf(ref)===row.merchantRef;
      return active && (role==='' || typeof role==='string' && role===(row.role || LEGACY_TRADE[row.id]) &&
        (recovery===true || descOf(ref)===LEGACY_OFFER_REF[row.id]));
    }
    function captureAdmission(actor,ref) {
      if(typeof deps.traderRole!=='function')return undefined;
      return typeof deps.traderAdmission==='function' ? deps.traderAdmission(actor,ref) || null : null;
    }
    function admitted(guard) {
      return guard===undefined || typeof guard==='function' && guard()===true;
    }
    /*
      WHAT EACH PERSON HOLDS IS ON THE CHARACTER (#1621), not in a map here.
      A map in this process was emptied by every restart: a scarce quest open
      at the time was gone while what it had drawn stayed in the pack, so
      twelve ebony out of Raven Rock Mine were kept with nothing left to put
      them back, and every cooldown came back at once. deps.load and deps.commit
      read one record on the character, { v, open, cool }. The server
      keeps it in the character's change form beside the pack and saves that
      form whole, so no save holds the goods without the quest that drew them.
      Nothing else holds it, so what the server enforces is what a restart
      reads.

      Inventory steps commit the complete next pack and quest record together.
      No intermediate save can close a quest without its reward, or count a
      draw without its goods. There is no compensating add, take or reopen.
    */
    if (typeof deps.load !== 'function' ||
        typeof deps.commit !== 'function' || typeof deps.identity !== 'function') {
      throw new Error('the custom quests have nowhere on the character to keep them');
    }
    var note = deps.log || function () {
      console.log('[quests] ' + Array.prototype.join.call(arguments, ' '));
    };
    var UNREAD = 'Your quests could not be read just now, so nothing changed. Tell staff with /helpme.';
    var UNWRITTEN = 'Quest work could not be committed just now. Tell staff with /helpme.';
    var traders = new Set();
    try {
      var data = (typeof NPC_POPULATION_DATA !== 'undefined') ? NPC_POPULATION_DATA : null;
      if (data && data.keep) {
        data.keep.forEach(function (row) {
          if (row[6] === 'trader') traders.add(row[0]);
        });
      }
    } catch (e) { /* the harness has no population table */ }

    function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
    function whole(n) {
      n = typeof n==='number' || typeof n==='string' ? Number(n) : 0;
      return (n > 0 && Math.floor(n) === n) ? n : 0;
    }
    /*
      One person's working quest view, read field by field rather than
      trusted whole. Unknown entries and expired cooldowns stay outside that
      view, but remain in the saved record. An unrelated action must preserve
      them and any malformed fields awaiting explicit recovery. Nothing
      there yet is nothing open and nothing waiting. A read that throws, or a
      value that is there and is not this record, is null: every step refuses
      and nothing is written over it, because writing would hand back every
      cooldown and forget what was drawn.
    */
    function questsOf(actor) {
      if (!active || deps.available && !deps.available()) return null;
      var raw,owner;
      try {
        owner=deps.identity(actor);
        if(!owner)return null;
        raw=deps.load(actor);
        if(deps.identity(actor)!==owner)return null;
      } catch (e) {
        note('could not read the quests of', actor + ':', e);
        return null;
      }
      var out = { open: {}, cool: {}, owner:owner, expected: raw === undefined ? null : raw,
        before: {open: {}, cool: {}} };
      if (raw === undefined || raw === null) return out;
      if (typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1 ||
          ['open','cool'].some(function(key){return own(raw,key) &&
            (!raw[key] || typeof raw[key] !== 'object' || Array.isArray(raw[key]));})) {
        note('the quests on', actor, 'are not a quest record, so nothing is written over them');
        return null;
      }
      var open = (raw.open && typeof raw.open === 'object') ? raw.open : {};
      Object.keys(open).forEach(function (id) {
        var o = open[id];
        if(id==='mammoth') {out.open[id]=JSON.parse(JSON.stringify(o));return;}
        if (own(byId,id) && byId[id].kind==='kill') {
          out.open[id]=JSON.parse(JSON.stringify(o));
          return;
        }
        if (!own(byId, id) || !o || typeof o !== 'object') return;
        out.open[id] = {
          drawn: whole(o.drawn),
          kills: whole(o.kills),
          gem: (byId[id].gems && byId[id].gems.indexOf(o.gem) >= 0) ? o.gem : undefined,
          itemDesc: (typeof o.itemDesc === 'string' && o.itemDesc) ? o.itemDesc : null
        };
      });
      var cool = (raw.cool && typeof raw.cool === 'object') ? raw.cool : {};
      var t = deps.now();
      Object.keys(cool).forEach(function (id) {
        if (!own(byId,id)) return;
        var until = whole(cool[id]);
        if (until > t) out.cool[id] = until;
      });
      out.before = JSON.parse(JSON.stringify({open: out.open, cool: out.cool}));
      if(own(raw,'sceneBudget')) {
        out.sceneBudget=JSON.parse(JSON.stringify(raw.sceneBudget));
        out.before.sceneBudget=JSON.parse(JSON.stringify(raw.sceneBudget));
      }
      return out;
    }
    // Apply only edits made to the working view, never its read normalization.
    // This keeps newer quest fields and unrelated damaged records verbatim.
    function recordEdits(raw, before, after) {
      var next = JSON.parse(JSON.stringify(raw || {}));
      Object.keys(before).forEach(function(key){
        if (!own(after,key)) delete next[key];
      });
      Object.keys(after).forEach(function(key){
        if (JSON.stringify(before[key]) === JSON.stringify(after[key])) return;
        var left=before[key], right=after[key], original=next[key];
        if (left && right && typeof left==='object' && typeof right==='object' &&
            !Array.isArray(left) && !Array.isArray(right)) {
          next[key]=recordEdits(original && typeof original==='object' && !Array.isArray(original) ? original : {},left,right);
        } else next[key]=right;
      });
      return next;
    }
    function keep(actor, b, changes, eligible) {
      try {
        if (!active || deps.available && !deps.available() || deps.identity(actor)!==b.owner) return false;
        var after={open:b.open,cool:b.cool};
        ['killHistory','killUncertain','sceneBudget'].forEach(function(key){if(own(b,key))after[key]=b[key];});
        var next = recordEdits(b.expected || {v:1,open:{},cool:{}}, b.before, after);
        next.v = 1;
        if(Buffer.byteLength(JSON.stringify(next),'utf8')>16384)return false;
        if(deps.identity(actor)!==b.owner)return false;
        var original=b.admission, finalSession=b.finalAdmission, admission=original;
        // Caller checks may reenter, then eligibility reads the final snapshot.
        // Only the captured callback-free session check follows that read.
        if(eligible)admission=function(){return admitted(original) && eligible() && admitted(finalSession);};
        if(!admitted(admission))return false;
        return deps.commit(actor, b.expected, next, changes || [],admission).ok === true;
      } catch (e) {
        note('could not write the quests of', actor + ', so nothing changed:', e);
        return false;
      }
    }
    function usable() {
      // These are callback-free service flags and metadata references. No
      // native query may follow the final character read at commit admission.
      return (!deps.available || deps.available()) && (!deps.rulesCurrent || deps.rulesCurrent()) && active;
    }
    function sceneTerms(row,b) {
      var entry=b.open[row.id],terms=entry && entry.terms;
      if(!row.expanded || !budget || b.sceneBudget===undefined || !budget.inspect(b.sceneBudget,deps.now()).ok ||
          !terms || terms.hash!==row.sourceHash || terms.gold!==row.gold || terms.hours!==row.hours ||
          terms.merchant!==row.merchantRef || terms.role!==row.role)return false;
      var held=b.sceneBudget.held[row.id];
      return !!held && held.token===terms.token && held.gold===terms.gold;
    }
    function sceneActionToken(row,b) {
      if(!row.expanded || !budget || b.sceneBudget===undefined || !budget.inspect(b.sceneBudget,deps.now()).ok)return null;
      var held=b.sceneBudget.held[row.id],entry=b.open[row.id];
      var token=held ? held.token : entry && entry.terms && entry.terms.token;
      return Number.isSafeInteger(token) && token>0 ? token : null;
    }
    function sceneActionCurrent(row,b,token) {
      var current=sceneActionToken(row,b);
      return current!==null && token==='@'+current;
    }
    function current(actor, owner) {return owner && deps.identity(actor)===owner && usable();}
    function qualify(actor, row, held, atCommit) {
      try {
        if (!held || !current(actor,held.owner)) return {ok:false,why:'unwritten'};
        var gate=gates[row.id], state=gate.open===true ? null : deps.readCharacter(actor);
        var ok=eligibility.allows(gate,state);
        // During final admission the native CAS owns the original body fence.
        // An identity query here could invalidate the progression just read.
        if(!(atCommit ? usable() : current(actor,held.owner)))return {ok:false,why:'unwritten'};
        return {ok:!!ok,why:ok?'':'eligibility'};
      } catch(error) {return {ok:false,why:'eligibility'};}
    }
    function creatureOk(match, name) {
      var n = String(name || '').toLowerCase().trim();
      if (n.indexOf('dragon') >= 0) return false;
      if (match === 'wolf') return /(?:^|\s)wolf(?:$|\s)/.test(n);
      if (match === 'sabre cat') return n.indexOf('sabre cat') >= 0 || n.indexOf('sabrecat') >= 0;
      if (match === 'bandit') return n.indexOf('bandit') >= 0;
      if (match === 'bear') return /(?:^|\s)bear(?:$|\s)/.test(n);
      if (match === 'draugr') return n.indexOf('draugr') >= 0;
      if (match === 'giant') return /(?:^|\s)giant(?:$|\s)/.test(n) && n.indexOf('spider') < 0;
      return false;
    }
    function lineup() {
      return {
        scarce: SCARCE.map(function (row) {
          return { id: row.id, name: row.name, who: row.who, ask: row.ask, holds: row.holds, hours: row.hours };
        }),
        scene: SCENE.map(function (row) {
          return {
            id: row.id, name: row.name, check: row.check, gold: row.gold, hours: row.hours,
            kind: row.kind, count: row.count, match: row.match
          };
        })
      };
    }
    function offerWork(actor, id, opts, held) {
      var row = byId[id];
      if (!row) return { ok: false, why: 'unknown' };
      if(typeof deps.traderRole==='function' && !boundOffer(row))return {ok:false,why:'unbound'};
      if (!traderFor(row,opts && opts.traderRef)) return {ok:false,why:'role'};
      var b = held || questsOf(actor);
      if (!b) return { ok: false, why: 'unread' };
      if (own(b.open,id)) return { ok: false, why: 'open' };
      if ((b.cool[id] || 0) > deps.now()) return { ok: false, why: 'cooldown' };
      var gate = qualify(actor, row, b);
      if (!gate.ok) return { ok: false, why: gate.why };
      var eligible=function(){return traderFor(row,opts && opts.traderRef) && qualify(actor,row,b,true).ok;};
      if (row.kind==='kill') {
        if(!kills)return {ok:false,why:'unbound'};
        if(typeof deps.traderRole==='function') {
          var source=kills.rows.find(function(r){return r.id===id;});
          if(!source || !deps.traderHold || deps.traderHold(opts && opts.traderRef)!==source.hold)return {ok:false,why:'hold'};
        }
        var accepted=kills.take(b,id);
        if(!accepted.ok)return accepted;
        if(row.expanded) {
          var reserved=budget.reserve(b.sceneBudget,id,row.gold,deps.now());
          if(!reserved.ok)return reserved;
          b.sceneBudget=reserved.next;
          b.open[id].terms={hash:row.sourceHash,gold:row.gold,hours:row.hours,
            merchant:row.merchantRef,role:row.role,token:reserved.token};
        }
        return keep(actor,b,[],eligible) ? {ok:true} : {ok:false,why:'unwritten'};
      }
      if (row.gems) {
        var gem = opts && opts.gem;
        if (row.gems.indexOf(gem) < 0) return { ok: false, why: 'gem' };
      }
      b.open[id] = { drawn: 0, kills: 0, gem: opts && opts.gem, itemDesc: null };
      if(id==='mammoth')b.open[id].bundles=[];
      if (!keep(actor, b, [], eligible)) return { ok: false, why: 'unwritten' };
      return { ok: true };
    }
    function drawScarce(actor,ref,row,data,sources,rules,stockReader,messages) {
      var unavailable={ok:false,text:messages.unavailable};
      if(!active || !data || data.quest!==row.id || !sources || typeof rules!=='function' || typeof stockReader!=='function')return unavailable;
      var held=questsOf(actor),open=held && held.open[row.id],item=data.sources[0].item;
      if(!held)return unavailable;
      if(!open)return {ok:false,text:messages.closed};
      if(open.drawn>=row.holds)return {ok:false,text:messages.full};
      if(open.drawn>0 && open.itemDesc!==item)return unavailable;
      var eligible=function(atCommit){return active && sources.verify(actor,ref) && !rules(actor) && qualify(actor,row,held,atCommit===true).ok;};
      if(!eligible())return {ok:false,text:messages.refused};
      var stock=stockReader(),wrote=false;
      if(!stock || typeof stock.take!=='function')return unavailable;
      open.drawn+=1;open.itemDesc=item;
      var taken=stock.take(ref,data.sources[0].returnMinutes*60000,function(){
        wrote=keep(actor,held,[{item:item,count:1}],function(){return eligible(true);});
        // Unknown native outcomes retain the reservation; only definite refusal releases it.
        return wrote || typeof deps.available==='function' && !deps.available();
      });
      if(!wrote)return taken.waitMs>0?{ok:false,text:messages.wait}:unavailable;
      return {ok:true,count:1};
    }
    function harvestOrchard(actor,ref,base,sowing) {
      var row=byId.orchard,held=questsOf(actor),open=held && held.open.orchard;
      var unavailable={ok:false,text:'The orchard work is unavailable for now.'};
      if(!held || !deps.orchardSources || !deps.orchardPlots || !deps.orchardPlots.available() || !deps.orchardSources.verify(actor,ref))return unavailable;
      if(!open && !qualify(actor,row,held).ok)return {ok:false,text:"This orchard needs Expert Farmer standing."};
      var farm=deps.orchardFarming && deps.orchardFarming();
      if(!farm || typeof farm.harvestQuest!=='function' || sowing && typeof farm.sowQuest!=='function')return unavailable;
      var owner=held.owner,wrote=false;
      var currentOwner=function(){return active && current(actor,owner);};
      function award(item,n,fence) {
        if(item!=='64b2e:Skyrim.esm' || !Number.isSafeInteger(n) || n<=0 || open && !Number.isSafeInteger(open.drawn) ||
          open && (open.drawn+n>row.holds || open.drawn>0 && open.itemDesc!==item))return false;
        if(open){open.drawn+=n;open.itemDesc=item;}
        wrote=keep(actor,held,[{item:item,count:n}],function(){
          return currentOwner() && fence() && deps.orchardSources.verify(actor,ref) && qualify(actor,row,held,true).ok;
        });
        return wrote ? true : typeof deps.available==='function' && !deps.available() ? null : false;
      }
      award.current=currentOwner;
      award.sourceCurrent=function(){return currentOwner() && deps.orchardSources.verify(actor,ref);};
      award.seed=function(item,fence) {
        if(item!=='64b2e:Skyrim.esm')return false;
        var done=keep(actor,held,[{item:item,count:-1}],function(){
          return currentOwner() && fence() && deps.orchardSources.verify(actor,ref) && qualify(actor,row,held,true).ok;
        });
        return done ? true : typeof deps.available==='function' && !deps.available() ? null : false;
      };
      var text=sowing ? farm.sowQuest(actor,ref,base,award) : farm.harvestQuest(actor,ref,base,award);
      return {ok:wrote,text:text || unavailable.text};
    }
    function harvestScarce(actor,ref) {
      return drawScarce(actor,ref,byId.crimson,deps.harvestData,deps.harvestSources,deps.harvestRules,deps.harvestStock,{
        unavailable:'This crimson plant is unavailable for now.',closed:'Take the crimson work from the Winterhold Alchemist first.',
        full:'This work has given you all eight plants. Return or abandon it first.',
        refused:'This plant needs Gatherer standing and a closer approach.',
        wait:'This crimson plant has already been picked. Come back after it returns.'});
    }
    function fishScarce(actor,ref) {
      return drawScarce(actor,ref,byId.pearl,deps.fishingData,deps.fishingSources,deps.fishingRules,deps.fishingStock,{
        unavailable:'This pearl bed is unavailable for now.',closed:'Take the pearl-bed work from the Solstheim Enchanter first.',
        full:'This work has given you all three pearls. Return or abandon it first.',
        refused:'This bed needs Expert Fisher standing, a suitable pole and a closer approach.',
        wait:'This pearl bed has already been gathered. Come back after it returns.'});
    }
    function longfinScarce(actor,ref) {
      return drawScarce(actor,ref,byId.longfin,deps.longfinData,deps.longfinSources,deps.longfinRules,deps.fishingStock,{
        unavailable:'This longfin water is unavailable for now.',closed:'Take the longfin work from the Haafingar Alchemist first.',
        full:'This work has given you all eight fish. Return or abandon it first.',
        refused:'This water needs Master Fisher standing, a suitable pole and a closer approach.',
        wait:'This longfin water has already been gathered. Come back after it returns.'});
    }
    function geodeScarce(actor,ref) {
      return drawScarce(actor,ref,byId.geode,deps.geodeData,deps.geodeSources,deps.geodeRules,deps.geodeStock,{
        unavailable:'This geode is unavailable for now.',closed:'Take the geode work from the Winterhold Enchanter first.',
        full:'This work has given you all six gems. Return or abandon it first.',
        refused:'This geode needs Enchanter standing and a closer approach.',
        wait:'This geode has already been worked. Come back after it returns.'});
    }
    function dressMammoth(actor,ref,base) {
      var unavailable={ok:false,text:'This mammoth ground is unavailable for now.'};
      if(!active || !huntBundles || !deps.mammothSources || !deps.mammothGoods || !deps.mammothStock || base!=='dd641:Skyrim.esm')return unavailable;
      var held=questsOf(actor),entry=held && held.open.mammoth,row=byId.mammoth;
      if(!held)return unavailable;
      if(!entry)return {ok:false,text:'Take the mammoth-ground work from the Whiterun Cook first.'};
      var before=huntBundles.readMammothDraw(entry);
      if(!before)return unavailable;
      if(before.drawn>=3)return {ok:false,text:'This work has given you all three mammoths. Return or abandon it first.'};
      var body=deps.mammothSources.read(actor,ref);
      if(!body || !qualify(actor,row,held).ok)return {ok:false,text:'This ground needs Master Hunter standing and a closer approach to an undisturbed mammoth carcass.'};
      var goods=deps.mammothGoods(actor,base);
      var appended=huntBundles.appendMammothDraw(before,Object.assign({},body,{goods:goods}));
      if(!appended.ok)return unavailable;
      var stock=deps.mammothStock(),wrote=false;
      if(!stock || typeof stock.dress!=='function')return unavailable;
      held.open.mammoth=appended.next;
      var fence=function(){return active && deps.mammothSources.verify(actor,ref,body);};
      var changes=[{item:'3ad6c:Skyrim.esm',count:goods[0]},{item:'669a4:Skyrim.esm',count:goods[1]}];
      var claimed=stock.dress(ref,function(){
        wrote=keep(actor,held,changes,function(){return fence() && qualify(actor,row,held,true).ok;});
        return wrote || typeof deps.available==='function' && !deps.available();
      },fence);
      if(!wrote)return claimed.ok ? unavailable : {ok:false,text:'This carcass cannot be dressed now.'};
      return {ok:true,text:'You take '+goods[0]+' Mammoth Tusk and '+goods[1]+' Mammoth Snout off the mammoth.'};
    }
    function bindPlace(id, place) {
      if (!byId[id]) return null;
      places[id] = place || {};
      return places[id];
    }
    function rareShut(actor, refrId, seam, held) {
      var id = RARE[seam && seam.name];
      if (!id) return null;
      var row = byId[id];
      var gate = qualify(actor, row, held);
      if (!gate.ok) return row.name + ' takes ' + (row.rank ? row.rank.charAt(0).toUpperCase() + row.rank.slice(1) + ' ' : '') + row.classKey.charAt(0).toUpperCase() + row.classKey.slice(1) + '.';
      if (!held) return UNREAD;
      var open = held.open[id];
      if (!open) return 'This place is shut.';
      var place = places[id] || {};
      if (row.gems && seam.name !== open.gem) return 'This place is shut.';
      var cell = row.gems ? (place.cells && place.cells[open.gem]) : place.cell;
      var veinCell = deps.cellOf ? deps.cellOf(refrId) : '';
      if (!cell || veinCell !== cell) return 'This place is shut.';
      if (open.drawn >= row.holds) return 'This place has nothing left until you turn the work in.';
      return null;
    }
    function giveRare(actor, refrId, seam, held) {
      var b = held || questsOf(actor);
      var shut = rareShut(actor, refrId, seam, b);
      if (shut) return { ok: false, text: shut };
      var id = RARE[seam.name];
      var row = byId[id];
      var open = b.open[id];
      open.drawn += 1;
      open.itemDesc = seam.ore;
      if (!keep(actor, b, [{item: seam.ore, count: 1}], function(){return qualify(actor,row,b,true).ok;}))
        return { ok: false, text: UNWRITTEN };
      return { ok: true, text: open.drawn >= row.holds ? 'That is all this place will give you.' : '' };
    }
    function mineRare(actor, refrId, seam) {
      var held=questsOf(actor),original=held && held.owner;
      if(!original)return UNREAD;
      var classGateFn = deps.classGate || classGate;
      var toolGateFn = deps.toolGate || toolGate;
      var miningFn = deps.mining || mining;
      var stopMiningFn = deps.stopMining || stopMining;
      var swingingFn = deps.swinging || swinging;
      var toolIdFn = deps.toolIdIn || toolIdIn;
      var swingFn = deps.swing || swing;
      var notifyFn = deps.notify || notify;
      var sayFn = deps.say || say;
      var creditFn = deps.creditWork || creditWork;
      var wearFn = deps.wearTool || wearTool;
      var anim = deps.swingAnim || SWING_MINE;
      var refused = classGateFn(actor, 'mine');
      if (refused) return refused;
      var tool = toolGateFn(actor, 'miner');
      if (tool) return tool;
      var shut = rareShut(actor, refrId, seam, held);
      if (shut) return shut;
      if(deps.identity(actor)!==original)return UNREAD;
      if (deps.ready && !deps.ready(actor)) return 'Quest work is waiting on a saved inventory change.';
      if (deps.identity(actor)!==original || !active || deps.available && !deps.available()) return UNREAD;
      var wasMining = miningFn(actor);
      if (deps.identity(actor)!==original || !active || deps.available && !deps.available()) return UNREAD;
      if (wasMining) { stopMiningFn(actor); return 'You put the pick down.'; }
      if (swingingFn(actor)) return '';
      var pick = toolIdFn(actor, 'miner');
      if(deps.identity(actor)!==original)return UNREAD;
      swingFn(actor, anim, function () {
        if (!active || deps.identity(actor) !== original) return;
        var result = giveRare(actor, refrId, seam, held);
        if (result.text) { notifyFn(actor, result.text); sayFn(actor, result.text); }
        if (!result.ok || !active || deps.available && !deps.available() || deps.identity(actor) !== original) return;
        try { creditFn(actor, 'mine'); } catch (e) {}
        if (!active || deps.available && !deps.available() || deps.identity(actor)!==original) return;
        try { wearFn(actor, 'miner'); } catch (e) {}
      }, { tool: pick, alive: function(){return active && (!deps.available || deps.available()) && deps.identity(actor) === original;} });
      return '';
    }
    function walkAway(actor, id, held, token) {
      var b = held || questsOf(actor);
      if (!b) return { ok: false, why: 'unread' };
      if(own(byId,id) && byId[id].expanded) {
        if(!budget || b.sceneBudget===undefined || !budget.inspect(b.sceneBudget,deps.now()).ok)
          return {ok:false,why:'recovery'};
        if(!sceneActionCurrent(byId[id],b,token))return {ok:false,why:'session'};
        var liability=b.sceneBudget.held[id],hasOpen=own(b.open,id);
        if(!liability && !hasOpen)return {ok:false,why:'none'};
        if(liability) {
          // Abandon owns this same-ID liability in the current actor snapshot.
          // It pays nothing, including when progress or copied terms are damaged.
          var released=budget.cancel(b.sceneBudget,id,liability.token,deps.now());
          if(!released.ok)return released;
          b.sceneBudget=released.next;
        }
        if(hasOpen) {
          var left=kills && kills.abandon(b,id);
          if(!left || !left.ok)return left || {ok:false,why:'unbound'};
        }
        return keep(actor,b,[]) ? {ok:true} : {ok:false,why:'unwritten'};
      }
      if (own(byId,id) && byId[id].kind==='kill') {
        if(!kills)return {ok:false,why:'unbound'};
        var left=kills.abandon(b,id);
        if(!left.ok)return left;
        return keep(actor,b,[]) ? {ok:true} : {ok:false,why:'unwritten'};
      }
      var open = b.open[id];
      if (!open) return { ok: false, why: 'none' };
      if(id==='mammoth') {
        var abandoned=huntBundles && huntBundles.mammothAbandon(open);
        if(!abandoned || !abandoned.ok)return {ok:false,why:'unavailable'};
        delete b.open[id];
        return keep(actor,b,abandoned.changes) ? {ok:true} : {ok:false,why:'unwritten'};
      }
      var changes = open.drawn > 0 ? [{item: open.itemDesc, count: -open.drawn}] : [];
      delete b.open[id];
      if (!keep(actor, b, changes)) return { ok: false, why: 'unwritten' };
      return { ok: true };
    }
    function offer(actor,id,opts,held) {
      if(!byId[id])return {ok:false,why:'unknown'};
      var admission=captureAdmission(actor,opts && opts.traderRef);
      if(!admitted(admission))return {ok:false,why:'session'};
      var b=held || questsOf(actor);
      if(!b)return {ok:false,why:'unread'};
      b.admission=admission;
      b.finalAdmission=admission;
      return offerWork(actor,id,opts,b);
    }
    function turnIn(actor,id,traderRef,held,token) {
      if(!byId[id])return {ok:false,why:'none'};
      var admission=captureAdmission(actor,traderRef);
      if(!admitted(admission))return {ok:false,why:'session'};
      var b=held || questsOf(actor);
      if(!b)return {ok:false,why:'unread'};
      b.admission=admission;
      b.finalAdmission=admission;
      return turnInWork(actor,id,traderRef,b,token);
    }
    function turnInWork(actor, id, traderRef, held, token) {
      var row = byId[id];
      var b = row ? held || questsOf(actor) : null;
      if (row && !b) return { ok: false, why: 'unread' };
      var open = row && b.open[id];
      if (!row || !open) return { ok: false, why: 'none' };
      if (!traderFor(row,traderRef,true)) return {ok:false,why:'role'};
      if(row.expanded && !sceneActionCurrent(row,b,token))return {ok:false,why:'session'};
      if (!row.scarce && row.kind !== 'retrieval' && row.kind !== 'kill') return { ok: false, why: 'unknown' };
      var changes = [];
      if (id==='mammoth') {
        var returned=huntBundles && huntBundles.mammothReturn(open);
        if(!returned || !returned.ok)return {ok:false,why:'short'};
        changes=returned.changes;
      } else if (row.scarce) {
        if (open.drawn < row.ask) return { ok: false, why: 'short' };
        changes.push({item: open.itemDesc, count: -row.ask});
      } else if (row.kind === 'retrieval') {
        if (open.drawn < 1) return { ok: false, why: 'short' };
        var retrieval=retrievalByQuest[id];
        if(retrieval && (descOf(traderRef)!==retrieval.destination || open.drawn!==1 || open.itemDesc!==retrieval.item))
          return {ok:false,why:'destination'};
        var place = places[id] || {};
        if (row.handoff && !retrieval) {
          var hold = deps.traderHold ? deps.traderHold(traderRef) : '';
          if (!place.handoffHold || hold !== place.handoffHold) return { ok: false, why: 'hold' };
        }
        changes.push({item: open.itemDesc, count: -1}, {item: GOLD_DESC, count: row.gold});
      } else {
        var source=kills && kills.rows.find(function(r){return r.id===id;});
        if(!source)return {ok:false,why:'unbound'};
        if(!deps.traderHold || deps.traderHold(traderRef)!==source.hold)return {ok:false,why:'hold'};
        if(!kills.ready(b,id)) return { ok: false, why: 'short' };
        if(row.expanded) {
          if(!sceneTerms(row,b))return {ok:false,why:'recovery'};
          var paid=budget.complete(b.sceneBudget,id,open.terms.token,deps.now());
          if(!paid.ok || paid.gold!==open.terms.gold)return {ok:false,why:'recovery'};
          b.sceneBudget=paid.next;
          changes.push({item:GOLD_DESC,count:open.terms.gold});
        } else changes.push({item: GOLD_DESC, count: row.gold});
      }
      delete b.open[id];
      b.cool[id] = deps.now() + (row.expanded ? open.terms.hours : row.hours) * HOUR;
      var eligible=retrieval ? function(){return traderFor(row,traderRef,true) && descOf(traderRef)===retrieval.destination && qualify(actor,row,b,true).ok;} : (id==='mammoth'||id==='orchard') ? function(){return traderFor(row,traderRef,true) && qualify(actor,row,b,true).ok;} : undefined;
      if (!keep(actor, b, changes,eligible)) return { ok: false, why: 'unwritten' };
      return { ok: true, gold: row.scarce ? 0 : row.gold };
    }
    function noteKill(killer, victim) {
      var b = questsOf(killer);
      if (!b) return { ok: false, why: 'unread' };
      if(!kills)return {ok:false,why:'unbound'};
      var credited=kills.credit(b,killer,victim);
      if(!credited.ok)return credited;
      return keep(killer,b,[]) ? {ok:true} : {ok:false,why:'unwritten'};
    }
    function noteContainer(actor, ref, cell, held) {
      var selected=retrievalRows.find(function(source){return source.reference===descOf(ref);});
      if(selected) {
        if(!active || !deps.retrievalSources)return 'This retrieval source is unavailable for now.';
        held=held || questsOf(actor);
        if(!held)return UNREAD;
        var row=byId[selected.quest],open=held.open[selected.quest];
        if(!open)return 'Take this retrieval work from its appointed specialist first.';
        if(open.drawn)return 'You already have this quest item.';
        var eligible=function(atCommit){return deps.retrievalSources.verify(actor,ref) && qualify(actor,row,held,atCommit).ok;};
        if(!eligible(false))return 'This retrieval needs a closer approach to its original source.';
        open.drawn=1;open.itemDesc=selected.item;
        return keep(actor,held,[{item:selected.item,count:1}],function(){return eligible(true);}) ? 'You take it.' : UNWRITTEN;
      }
      if(deps.retrievalData)return null;
      held = held || questsOf(actor);
      if (!held) return null;
      var said = null;
      SCENE.forEach(function (row) {
        if (said || row.kind !== 'retrieval') return;
        var open = held.open[row.id];
        if (!open || open.drawn) return;
        var place = places[row.id] || {};
        if (!place.ref || place.ref !== ref || !place.item) return;
        if (place.cell && cell !== place.cell) return;
        open.drawn = 1;
        open.itemDesc = place.item;
        if (!keep(actor, held, [{item: place.item, count: 1}])) { said = UNWRITTEN; return; }
        said = 'You take it.';
      });
      return said;
    }
    function descOf(refrId) {
      if (deps.descOf) return deps.descOf(refrId);
      try { return mp.getDescFromId(refrId); } catch (e) { return ''; }
    }
    function isTrader(refrId) {
      return traders.has(descOf(refrId));
    }
    var mineNames = {
      ebony: 'Raven Rock Mine', stalhrim: 'Kolbjorn Barrow', heartstone: 'Coldcinder Cave',
      pearl: 'Raven Rock coast', orchard:'Chillfurrow Farm orchard outside Whiterun', mammoth:'Bleakwind Basin and its western tundra',
      gem: {Ruby: 'White Ridge Sanctum', Sapphire: 'Highpoint Tower', Emerald: 'Kolbjorn Barrow', Amethyst: 'Highpoint Tower'}
    };
    function bound(row) {
      if(row.id==='orchard')return !!deps.orchardSources && !!deps.orchardPlots;
      if(row.id==='mammoth')return !!deps.mammothSources && !!huntBundles;
      if(row.kind==='retrieval' && typeof deps.traderRole==='function')return !!retrievalByQuest[row.id] && !!deps.retrievalSources;
      if(row.id==='longfin')return !!deps.longfinSources && !!deps.longfinData;
      if(row.id==='pearl')return !!deps.fishingSources && !!deps.fishingData;
      if(row.id==='geode')return !!deps.geodeSources && !!deps.geodeData;
      var place = places[row.id];
      return !!place && !!(row.gems ? place.cells && row.gems.every(function(gem){return !!place.cells[gem];}) : place.cell);
    }
    function boundOffer(row) {
      return (row.scarce || row.kind==='retrieval') && bound(row) || row.kind==='kill' && !!kills;
    }
    function describe(actor,traderRef) {
      var held = questsOf(actor);
      if (!held) return [];
      var ready = active && (!deps.ready || deps.ready(actor));
      var offers=SCARCE.filter(bound).filter(function(row){return traderFor(row,traderRef,own(held.open,row.id));}).map(function(row){
        var open = held.open[row.id], gate = qualify(actor,row,held), until = held.cool[row.id] || 0;
        var validDraw=row.id!=='mammoth' || !open || !!huntBundles.readMammothDraw(open);
        var huntCheck=row.id==='mammoth' ? 'Master Hunters may dress up to three mammoths. Return the tusks and snouts from the first carcass and keep the other draws. Leaving the work returns all outstanding goods.' : '';
        if(row.id==='mammoth' && validDraw && open && open.drawn>0)huntCheck+=' Return '+open.bundles[0].goods[0]+' Mammoth Tusk and '+open.bundles[0].goods[1]+' Mammoth Snout.';
        var state = open ? 'open' : until > deps.now() ? 'cooldown' : gate.ok ? 'available' : 'locked';
        var location = mineNames[row.id] || '';
        return {id:row.id,name:row.name,who:row.who,ask:row.ask,holds:row.holds,hours:row.hours,check:row.id==='orchard' ? 'Expert Farmers use the existing orchard plots, claims, shovel and seasonal growth. Return four apples, draw at most ten, and keep extras. A complete ripe harvest must fit the remaining allowance.' : huntCheck,
          state:state,drawn:open ? open.drawn : 0,gem:open && open.gem || '',
          gems:row.gems ? row.gems.slice() : [],locations:location,
          waitMinutes:until ? Math.max(0,Math.ceil((until-deps.now())/60000)) : 0,
          canTake:ready && validDraw && state==='available',canReturn:ready && validDraw && !!open && open.drawn>=row.ask && (!['mammoth','orchard'].includes(row.id) || gate.ok),
          canAbandon:ready && validDraw && !!open};
      });
      var hold=deps.traderHold && deps.traderHold(traderRef);
      retrievalRows.forEach(function(source){
        var row=byId[source.quest],open=held.open[row.id],until=held.cool[row.id] || 0;
        if(!bound(row)||!traderFor(row,traderRef,!!open))return;
        var gate=qualify(actor,row,held),atOffer=descOf(traderRef)===source.merchant,atReturn=descOf(traderRef)===source.destination;
        offers.push({id:row.id,name:row.name,kind:'retrieval',who:'Open to anyone',check:row.check,gold:row.gold,hours:row.hours,
          locations:retrievalPlaces[row.id]+'. Return to the '+(row.handoff?'Eastmarch ':source.hold+' ')+source.role+'.',
          state:open?'open':until>deps.now()?'cooldown':gate.ok?'available':'locked',drawn:open?open.drawn:0,
          waitMinutes:Math.max(0,Math.ceil((until-deps.now())/60000)),
          canTake:ready && gate.ok && atOffer && !open && until<=deps.now(),
          canReturn:ready && gate.ok && atReturn && !!open && open.drawn===1 && open.itemDesc===source.item,
          canAbandon:ready && !!open});
      });
      if(kills)kills.rows.forEach(function(source){
        if(source.hold!==hold || !traderFor(byId[source.id],traderRef,own(held.open,source.id)))return;
        var row=byId[source.id],hasOpen=own(held.open,row.id),open=held.open[row.id],until=held.cool[row.id] || 0;
        var liability=row.expanded && held.sceneBudget && held.sceneBudget.held && own(held.sceneBudget.held,row.id);
        var recovered=row.expanded && (hasOpen || liability) && !sceneTerms(row,held);
        var effectiveOpen=hasOpen || !!liability;
        var allowance=row.expanded ? budget.inspect(held.sceneBudget,deps.now()) : null;
        var canLeave=!row.expanded || held.sceneBudget!==undefined && allowance.ok;
        var funds=!row.expanded || allowance.ok && allowance.openCount<3 && allowance.availableGold>=row.gold;
        var gate=qualify(actor,row,held),available=kills.available(row.id),done=hasOpen && kills.ready(held,row.id) && !recovered;
        var count=open && Number.isSafeInteger(open.kills)?open.kills:0;
        offers.push({id:row.id,name:row.name,kind:'kill',
          check:row.check+(row.expanded && effectiveOpen && !canLeave ? ' Ask staff to recover the saved work before changing it.' : ''),
          gold:row.gold,count:row.count,exactMerchant:!!row.expanded,token:row.expanded ? sceneActionToken(row,held) : null,
          who:row.who,hours:row.hours,locations:source.place,kills:count,state:effectiveOpen?'open':until>deps.now()?'cooldown':!gate.ok?'locked':available&&funds?'available':'unavailable',
          waitMinutes:until?Math.max(0,Math.ceil((until-deps.now())/60000)):0,
          recovery:canLeave && (recovered || !kills.verified(held,row.id)),
          canTake:ready && gate.ok && !effectiveOpen && !until && available && funds && kills.verified(held,row.id),
          canReturn:ready && done,canAbandon:ready && effectiveOpen && canLeave && (!row.expanded || sceneActionToken(row,held)!==null)});
      });
      return current(actor,held.owner) ? offers : [];
    }
    function act(actor, verb, id, gem, traderRef, held, admission) {
      var row = byId[id];
      if (!row || !boundOffer(row)) return {ok:false,why:'unbound'};
      var origin=admission,current=captureAdmission(actor,traderRef);
      admission=function(){return admitted(origin) && admitted(current);};
      if(!admitted(admission))return {ok:false,why:'session'};
      held=held || questsOf(actor);
      if(!held)return {ok:false,why:'unread'};
      held.admission=admission;
      held.finalAdmission=current;
      if (!active || deps.ready && !deps.ready(actor)) return {ok:false,why:'unavailable'};
      if(deps.identity(actor)!==held.owner)return {ok:false,why:'identity'};
      if(!traderFor(row,traderRef,verb!=='take' && own(held.open,id)))return {ok:false,why:'role'};
      if(row.kind==='kill') {
        var source=kills.rows.find(function(r){return r.id===id;});
        if(!source || !deps.traderHold || deps.traderHold(traderRef)!==source.hold)return {ok:false,why:'hold'};
      }
      if(admission!==undefined && (typeof admission!=='function' || admission()!==true))return {ok:false,why:'session'};
      if (verb === 'take') return offerWork(actor,id,{gem:gem,traderRef:traderRef},held);
      if (verb === 'return') return turnInWork(actor,id,traderRef,held,gem);
      if (verb === 'abandon') return walkAway(actor,id,held,gem);
      return {ok:false,why:'unknown'};
    }
    function speak(actor, refrId) {
      if (!isTrader(refrId)) return null;
      return describe(actor,refrId);
    }
    function onActivate(actor, refrId) {
      if(deps.retrievalData)return noteContainer(actor,refrId);
      var held = questsOf(actor);
      if (!held) return null;
      var retrieval = false;
      Object.keys(held.open).forEach(function (id) {
        if (byId[id] && byId[id].kind === 'retrieval' && held.open[id].drawn < 1) retrieval = true;
      });
      if (!retrieval) return null;
      var cell = deps.cellOf ? (deps.cellOf(refrId) || '') : '';
      return noteContainer(actor, refrId, cell, held);
    }
    return {
      lineup: lineup, offer: offer, bindPlace: bindPlace, walkAway: walkAway,
      turnIn: turnIn, noteKill: noteKill, noteContainer: noteContainer,
      mineRare: mineRare, dressMammoth:dressMammoth, isRareSeam: function (seam) { return !!RARE[seam && seam.name]; },
      onActivate: onActivate, speak: speak, describe: describe, act: act, capture: questsOf, fishScarce:fishScarce, longfinScarce:longfinScarce, sowOrchard:function(actor,ref,base){return harvestOrchard(actor,ref,base,true);},harvestOrchard:harvestOrchard,harvestScarce:harvestScarce, geodeScarce:geodeScarce,
      shutdown: function () { active = false; }
    };
  }

  /*
    Where each person's quests are kept (#1621): on the character, seen by
    nobody's client, the way the perk clocks and the journals are. Never set
    reads as nothing open and nothing waiting.
  */
  var QUEST_PROPERTY = 'thornswoodQuests';
  if (typeof mp !== 'undefined' && mp && typeof addItem === 'function') {
    try {
      try {
        mp.makeProperty(QUEST_PROPERTY, {
          isVisibleByOwner: false, isVisibleByNeighbors: false,
          updateOwner: '', updateNeighbor: ''
        });
      } catch (e) { /* made by an earlier load. harmless. */ }
      if (globalThis.__thornswoodQuests && typeof globalThis.__thornswoodQuests.shutdown === 'function') globalThis.__thornswoodQuests.shutdown();
      if (globalThis.__thornswoodQuestTransactions) globalThis.__thornswoodQuestTransactions.shutdown();
      var questTransactions = MERCHANT_TRADING.createQuestTransactions({mp: mp, log: log,
        withInventoryMutation: function (actor, change) {
          var merchants = globalThis.__thornswoodMerchantTrade;
          return merchants ? merchants.withQuestInventoryMutation(actor, change) : {ok: false, why: 'unavailable'};
        }
      });
      globalThis.__thornswoodQuestTransactions = questTransactions;
      var retrievalData=typeof MERCHANT_TRADING.retrievalSources==='function'?MERCHANT_TRADING.retrievalSources():null;
      var retrievalSources=null,retrievalRefs=Object.create(null);
      globalThis.__thornswoodQuestRetrievalRefs=retrievalRefs;
      if(retrievalData) {
        retrievalData.sources.forEach(function(source){
          var ref=mp.getIdFromDesc(source.reference);
          if(!Number.isInteger(ref)||ref<=0||ref>=0xff000000||mp.getDescFromId(ref)!==source.reference||retrievalRefs[ref])
            throw new Error('The retrieval reference register cannot be resolved.');
          retrievalRefs[ref]=source.reference;
        });
        Object.freeze(retrievalRefs);
        try {retrievalSources=MERCHANT_TRADING.createQuestRetrievalSources(mp,retrievalData.sources);}
        catch(error){log('The retrieval work stays unavailable: '+String(error));}
      }
      var questRulesSource=globalThis.__thornswoodProgression;
      var questCharacterSource=globalThis.__thornswoodCharacter;
      var mammothSources=null;
      if(typeof MERCHANT_TRADING.createQuestMammothSources==='function') {
        try {mammothSources=MERCHANT_TRADING.createQuestMammothSources(mp,NPC_POPULATION_DATA);}
        catch(error){log('The mammoth ground stays unavailable: '+String(error));}
      }
      var fishingData=typeof MERCHANT_TRADING.scarceFishing==='function'?MERCHANT_TRADING.scarceFishing():null;
      var longfinData=typeof MERCHANT_TRADING.scarceLongfin==='function'?MERCHANT_TRADING.scarceLongfin():null;
      var fishingSources=null,longfinSources=null,fishingRefs=Object.create(null);
      // Register every selected water before fallible source construction.
      // Missing services cannot make a selected reference ordinary fishing.
      [fishingData,longfinData].filter(Boolean).forEach(function(data){
        data.sources.forEach(function(source){
          var ref=mp.getIdFromDesc(source.reference);
          if(!Number.isInteger(ref) || ref<=0 || ref>=0xff000000 || mp.getDescFromId(ref)!==source.reference || fishingRefs[ref])
            throw new Error('The scarce fishing reference register cannot be resolved.');
          fishingRefs[ref]=source.base;
        });
      });
      globalThis.__thornswoodQuestFishingRefs=Object.freeze(fishingRefs);
      if(fishingData) {
        try {fishingSources=MERCHANT_TRADING.createQuestFishingSources(mp,fishingData.sources);}
        catch(error){log('The pearl bed stays unavailable: '+String(error));}
      }
      if(longfinData) {
        try {longfinSources=MERCHANT_TRADING.createQuestLongfinSources(mp,longfinData.sources);}
        catch(error){log('The longfin work stays unavailable: '+String(error));}
      }
      var harvestData=typeof MERCHANT_TRADING.scarceHarvest==='function'?MERCHANT_TRADING.scarceHarvest():null;
      var harvestSources=null;
      if(harvestData) {
        try {harvestSources=MERCHANT_TRADING.createQuestHarvestSources(mp,harvestData.sources);}
        catch(error){log('The crimson work stays unavailable: '+String(error));}
      }
      var geodeData=typeof MERCHANT_TRADING.scarceGeodes==='function'?MERCHANT_TRADING.scarceGeodes():null;
      var orchardData=typeof MERCHANT_TRADING.orchardSources==='function' ? MERCHANT_TRADING.orchardSources() : null,orchardSources=null,orchardPlots=null;
      var orchardRefs=Object.create(null);globalThis.__thornswoodQuestOrchardRefs=null;
      try {
      if(!orchardData || !Array.isArray(orchardData.sources) || orchardData.sources.length!==10)throw Error('Orchard source evidence unavailable');
      orchardData.sources.forEach(function(source){
        var id=mp.getIdFromDesc(source.reference);
        if(!Number.isInteger(id)||id<=0||id>=0xff000000||mp.getDescFromId(id)!==source.reference||orchardRefs[id])throw Error('Invalid orchard references');
        orchardRefs[id]=source.reference;
      });
      Object.freeze(orchardRefs);globalThis.__thornswoodQuestOrchardRefs=orchardRefs;
      }catch(error){log("The orchard reference register is unavailable: "+String(error));}
      if(globalThis.__thornswoodOrchardPlots)globalThis.__thornswoodOrchardPlots.shutdown();
      globalThis.__thornswoodOrchardPlots=null;
      var orchardOwner={};globalThis.__thornswoodOrchardPlotOwner=orchardOwner;
      try {
        orchardSources=MERCHANT_TRADING.createQuestOrchardSources(mp,orchardData.sources);
        var refs=orchardData.sources.map(function(r){return r.reference;});
        var storage=MERCHANT_TRADING.orchardPlots.createOrchardStorage(require('fs'),require('path'),mp.getServerSettings(),mp.writeFileWhole.bind(mp),refs);
        storage.current=function(){return globalThis.__thornswoodOrchardPlotOwner===orchardOwner;};
        orchardPlots=MERCHANT_TRADING.orchardPlots.createOrchardPlots(storage,refs);
        globalThis.__thornswoodOrchardPlots=orchardPlots;
      }catch(error){log('The orchard work stays unavailable: '+String(error));}
      var geodeSources=null;
      if(geodeData) {
        try {geodeSources=MERCHANT_TRADING.createQuestGeodeSources(mp,geodeData.sources);}
        catch(error){log('The geode work stays unavailable: '+String(error));}
      }
      globalThis.__thornswoodQuests = createCustomQuests({
        orchardSources:orchardSources,orchardPlots:orchardPlots,orchardFarming:function(){return globalThis.__thornswoodFarming;},
        mammothSources:mammothSources,mammothStock:function(){return globalThis.__thornswoodResourceStock;},
        mammothGoods:function(actor,base){
          var row=HUNTS_BY_BASE[base],pair=row && row.yield && row.yield[3];
          if(!pair || pair[0]!==1 || pair[1]!==5 || !row.gives || row.gives.length!==2 ||
            row.gives[0].item!=='3ad6c:Skyrim.esm' || row.gives[1].item!=='669a4:Skyrim.esm')return null;
          return row.gives.map(function(){return randInt(pair[0],pair[1]);});
        },
        retrievalData:retrievalData,retrievalSources:retrievalSources,
        geodeData:geodeData,geodeSources:geodeSources,geodeRules:function(actor){return toolGate(actor,'enchanter');},
        geodeStock:function(){return globalThis.__thornswoodResourceStock;},
        harvestData:harvestData,harvestSources:harvestSources,
        harvestStock:function(){return globalThis.__thornswoodResourceStock;},
        harvestRules:function(actor){
          var plant=plantAt('b6fb9:Skyrim.esm');
          if(!plant || plant.produce!=='b701a:Skyrim.esm')return 'The crimson plant cannot be verified.';
          var refusal=classGate(actor,'harvest');if(refusal)return refusal;
          var want=RANK_LADDER.indexOf(plant.rank);
          return want>0 && rankStep(actor,'gatherer')<want ? 'This plant needs a higher Gatherer rank.' : null;
        },
        longfinData:longfinData,longfinSources:longfinSources,
        longfinRules:function(actor){return classGate(actor,'fish') || toolGate(actor,'fisher') ||
          (typeof poleTooWeak==='function'?poleTooWeak(actor,'master'):null);},
        fishingData:fishingData,fishingSources:fishingSources,
        fishingStock:function(){return globalThis.__thornswoodResourceStock;},
        fishingRules:function(actor){return classGate(actor,'fish') || toolGate(actor,'fisher') ||
          (typeof poleTooWeak==='function'?poleTooWeak(actor,'expert'):null);},
        eligibility: MERCHANT_TRADING.createQuestEligibility({table:questRulesSource.TABLE,spellIds:questRulesSource.SPELL_IDS}),
        rulesCurrent: function(){return globalThis.__thornswoodProgression===questRulesSource &&
          globalThis.__thornswoodCharacter===questCharacterSource;},
        now: function () { return Date.now(); },
        goldDesc: globalThis.__thornswoodDungeonLoot && globalThis.__thornswoodDungeonLoot.GOLD_DESC,
        load: function (actor) { return mp.get(actor, QUEST_PROPERTY); },
        log: function () {
          var a = Array.prototype.slice.call(arguments);
          a.unshift('custom quests:');
          log.apply(null, a);
        },
        commit: questTransactions.commit,
        identity: questTransactions.identity,
        killContracts: MERCHANT_TRADING.createKillContracts({mp:mp,population:NPC_POPULATION_DATA,expandedRows:expandedRows,
          raceOf:raceEdidOf,identity:questTransactions.identity}),
        available: questTransactions.available,
        ready: function (actor) {
          var merchants = globalThis.__thornswoodMerchantTrade;
          return questTransactions.available() && !!merchants && merchants.questReady(actor);
        },
        readCharacter: function (actor) {
          var c = questCharacterSource;
          if (!c || typeof c.PROPERTY !== 'string' || !c.PROPERTY) return '';
          try {
            // Read only. The shared evaluator validates saved standing;
            // character initialization alone owns migration and repair.
            return mp.get(actor, c.PROPERTY);
          } catch (e) { return undefined; }
        },
        creatureName: function (id) {
          try {
            var desc = mp.get(id, 'baseDesc');
            var baseId = idOf(desc);
            var rec = mp.lookupEspmRecordById(baseId);
            var fields = (rec && rec.record && rec.record.fields) || [];
            for (var i = 0; i < fields.length; i++) {
              if (fields[i].type === 'FULL') {
                var data = fields[i].data;
                if (typeof data === 'string') return data.replace(/\0+$/, '');
                if (data && data.length) return Buffer.from(data).toString('utf8').replace(/\0+$/, '');
              }
            }
            return String(desc || '');
          } catch (e) { return ''; }
        },
        cellOf: function (id) {
          try {
            var loc = mp.get(id, 'locationalData');
            return (loc && loc.cellOrWorldDesc) || '';
          } catch (e) { return ''; }
        },
        traderHold: function (ref) {
          var merchants=globalThis.__thornswoodMerchantTrade;
          return merchants ? merchants.questHold(ref) : '';
        },
        traderRole: function (ref) {
          var merchants=globalThis.__thornswoodMerchantTrade;
          return merchants && typeof merchants.questRole==='function' ? merchants.questRole(ref) : null;
        },
        traderAdmission: function (actor,ref) {
          var merchants=globalThis.__thornswoodMerchantTrade;
          return merchants && typeof merchants.questAdmission==='function' ? merchants.questAdmission(actor,ref) : null;
        }
      });
      if(longfinSources)globalThis.__thornswoodQuests.bindPlace('longfin',{cell:'3c:Skyrim.esm'});
      if(geodeSources)globalThis.__thornswoodQuests.bindPlace('geode',{cell:'1ee62:Skyrim.esm'});
      if(harvestSources)globalThis.__thornswoodQuests.bindPlace('crimson',{cell:'1ee62:Skyrim.esm'});
      Object.keys(RARE_PLACES).forEach(function (id) {
        globalThis.__thornswoodQuests.bindPlace(id, RARE_PLACES[id]);
      });
    } catch (e) {
      try { log('custom quests failed to start:', e); } catch (e2) {}
    }
  }
  globalThis.__thornswoodCustomQuestsCreate = createCustomQuests;
})();
// ==== end thornswood custom quests ====

