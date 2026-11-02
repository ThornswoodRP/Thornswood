// ==== thornswood farming ====
/*
  FARMING: claiming ground, sowing it, waiting, and bringing it in.

  Patrick, 20 September: 'there is no system for claiming plots for farming,
  planting things, and then things growing, currently all the farms are already
  full but they shouldn't be and to make it so they can become full we could
  give farmers a few starting crops or something but I want it so you can't just
  farm infinitely like you usually can and have it so you actually have to plant
  and replant and wait you know'.

  WHAT WAS MEASURED IN THE FORK, at C:\Thornswood-Dev\skymp, because it is what
  decided the whole shape of this:

    MpObjectReference::ProcessActivateNormal treats a FLOR or TREE base as
    pickable. It reads the produce straight out of the record, puts it in the
    hands of whoever pressed it, calls SetHarvested(true) and RequestReloot().
    Nobody asked anybody's permission and nobody counted anything.

    MpObjectReference::Activate fires the gamemode hook FIRST. Returning false
    from mp.onActivate blocks ProcessActivateNormal outright. That is the whole
    lever this block stands on: the server can refuse any pick, and mp.onActivate
    returns false for every crop base without exception.

    MpObjectReference::GetRelootTime returns a hardcoded std::chrono::hours(1)
    for FLOR and for TREE. That hour is the free infinite farming: walk a row of
    cabbages, come back in an hour, walk it again, for ever.

  THE ONE HONEST LIMIT, AND THE NEXT PERSON WILL HIT IT, so it is written down
  in full rather than discovered.

  The server owns the RULE and does not own the LOOK. There is no property
  binding for isHarvested and none for a per-reference reloot time: the complete
  list is in skymp5-server\cpp\addon\property_bindings\PropertyBindingFactory.cpp
  and neither is among them. So this block can decide what a press gives and it
  cannot touch what the plot looks like or when the engine decides to put the
  model back. In practice that means two things, both of them visible:

    A plot that is empty by the rule may still look ripe. Nothing was sown, the
    cabbage model is standing there, and pressing it says the plot is empty.

    A plot that was just brought in looks picked for an hour and then the engine
    grows the model back on its own, with nothing sown in it. It looks ready and
    it gives nothing.

  The RULE still holds through all of that, which is the part that matters:
  every press goes through activate() below, an unsown plot gives nothing, and
  the engine never gets to run its own hand-out because the hook returns false
  first. Nobody farms infinitely. They just see a plot that is lying to them
  about which state it is in.

  Two property bindings in the fork would close the gap entirely, isHarvested
  and relootTime, and then the model would say what the record says. That is a
  fork change, which is a few lines in the dev channel first: the problem, the
  approach, what it touches, agreed between Patrick and Djinn before any code.
  Until then every grow time is kept under the engine's own hour so the look and
  the rule never drift further apart than that, and it is kept there by
  arithmetic rather than by care: mergeCrops near the top of the file caps every
  wait at CROP_GROW_MINUTES_MAX, which is the measured hour less five minutes.
  That cap is not decoration. The generated half of the crop table carries
  harvests.json's own grow times, which are 75 minutes for ten of the eleven and
  135 for Wheat, computed by a rule that is documented never to go under the
  hour. Without the cap, one run of the crops pass would have put every crop past
  the reloot and left plots standing ripe and answering 'still growing'.

  THE ALSO-HARVESTABLE REST OF SKYRIM IS NOT THIS BLOCK'S. tools\harvests.json
  counted 181 FLOR and TREE bases in this load order and CROPS holds fifteen of
  them. The other 166 are mountain flowers, thistle, mushrooms and the like, and
  the engine still hands those out to anybody on its own hour. That is the
  gatherer's verb rather than the farmer's, and closing it would mean deciding
  what happens when anybody in Skyrim presses a flower, which is a change to
  settled design and belongs in the dev channel before any code. What was closed
  here is the farm half: every crop base a farm is made of is in the table,
  including the four the crops pass does not list, so no plot in a farm pays out
  for free.

  FARMS START EMPTY, WITH NO STARTUP SWEEP. Patrick: 'currently all the farms
  are already full but they shouldn't be'. A plot's state lives on the plot, as
  a custom property on the reference, and a reference nobody has ever sown has
  no such property at all. readPlot answers null for it, activate() says the
  plot is empty, and that is every crop in Skyrim on the first press. There is
  no boot pass here because there is nothing to sweep: emptiness is the absence
  of a record rather than a record saying empty, which is also why a world save
  restored from before this existed comes back empty rather than wrong.

  A CLAIM IS A CIRCLE OF GROUND AROUND A PLOT, NOT A LIST OF PLOTS AND NOT A
  GRID SQUARE. There is no farm object in Skyrim to claim. A farm is a fence,
  some dirt and thirty separate references, and no record anywhere says which
  thirty belong together. So the ground is the farm: /claim asks for the nearest
  plot within reach, writes down the cell and the position of THAT PLOT, and
  every crop within TUNING.farming.claimRadius of it in the same cell belongs to
  whoever holds it. One claim per person, keyed by their profile id so that one
  per person is the shape of the record rather than a loop that deletes the
  others, and it lapses after TUNING.farming.claimLapseDays with nothing done on
  it.

  IT WAS A GRID SQUARE UNTIL 20 SEPTEMBER AND THAT IS WHAT WENT WRONG. The claim
  was keyed by the 4096 unit square the CLAIMER was standing in, while /plant,
  /plot and every press asked about the square the PLOT was standing in. The two
  disagree for any plot within reach of a line at a multiple of 4096, which,
  since a Skyrim farm is 1500 to 3000 units across, is most farms. Measured
  against the block with a stubbed mp: stand at x=4000 and claim, and the claim
  is written under square 0; the cabbage at x=4150 is 150 units away, inside the
  200 unit reach, and stands in square 1. /plot on it answered 'Nobody holds this
  ground', anybody could sow it and anybody could bring it in, and the holder's
  own work on it never refreshed the claim, so a farm worked every day still
  lapsed on the fourteenth. Nothing anywhere told a person where the line was.

  A circle around a plot has no lines in it. It also stops one word taking every
  crop in 4096 by 4096 units of ground with no plot anywhere near the claimer,
  which is what /claim did before: it never once looked for a crop.

  A CLAIM THAT CANNOT BE READ IS NOT GROUND NOBODY HOLDS. Every place that asks
  who holds a plot reads the plot's own cell and position first, and a read that
  fails is a refusal, not an open plot. The old code let a failed read fall
  through to 'nobody holds this', which paid the crop out to whoever pressed it;
  the fork's own reads throw whenever a cell has been unloaded and rebuilt, which
  readPlot below calls the normal case rather than the strange one.

  The claims live in their own small file beside the other things this server
  publishes, rather than on a reference, because a claim belongs to a patch of
  ground and there is no reference at the middle of a patch to hang it on.
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var P = g.__thornswoodProgression;
  if (!P) { console.log('[thornswood farming] the rules block is missing, nothing registered'); return; }

  var PLOT_PROPERTY = 'thornswoodPlot';
  var RANK_STEPS = ['novice', 'advanced', 'expert', 'master'];

  function flog() {
    var a = Array.prototype.slice.call(arguments);
    console.log('[thornswood farming] ' + a.join(' '));
  }

  /** The invented numbers, read fresh so an edit to TUNING needs no edit here. */
  function tuning() { return P.TABLE.tuning.farming; }

  /*
    WHERE A PLOT'S STATE LIVES: on the plot.

    Not in a map in this process, which a restart empties and which would hand
    everybody's half grown crops back as unsown ground. Not on the person, which
    could not answer 'what is sown in the plot in front of me' without walking
    every plot they had ever touched. On the reference, through mp.makeProperty,
    which the world save carries across a restart. It is the only one of the
    three where the question and the answer are in the same place.

    Invisible to everybody. A plot's state is not something a client needs to
    draw, because the client cannot draw it anyway (see the note above about the
    look), and there is no update script for the same reason: a property with no
    reader does not need a channel to reach it.
  */
  try {
    mp.makeProperty(PLOT_PROPERTY, {
      isVisibleByOwner: false,
      isVisibleByNeighbors: false,
      updateOwner: '',
      updateNeighbor: ''
    });
    flog('plot property registered');
  } catch (e) {
    // Already made by a previous load. The same as the character property:
    // a hot reload re-runs this file and the second make throws.
  }

  /*
    THE LINE AT A PLOT (#1636). Patrick, 4 October: no chat commands for
    anything people do. With a crop under the crosshair, a line says what is
    in the ground and whose farm it is, and names the two things to do
    there: E sows it, the press that has sown since 21 September, and the
    lock key claims the farm around it. The client can read neither the plot
    (the property above is nobody's to see) nor the claims, so it asks: a
    crop under the crosshair sends /plot and that crop's id, and the answer
    is written here to that person alone, for their client to draw. It is
    an answer to a look, so it is written only when asked and never on a
    timer.
  */
  var PLOT_LINE_PROPERTY = 'thornswoodPlotLine';
  try {
    mp.makeProperty(PLOT_LINE_PROPERTY, {
      isVisibleByOwner: true,
      isVisibleByNeighbors: false,
      updateOwner: plotLineScript(),
      updateNeighbor: ''
    });
  } catch (e) { }

  /*
    What is sown here, or null for an empty plot. Who sowed it, what was sown,
    when, how long it takes and what it pays.

    THE WAIT AND THE YIELD ARE FACTS ABOUT THE PLOT, and they are written into it
    at sowing. They used to be worked out at read time from the rank of whoever
    happened to be standing there, on the reading that this rewards a Farmer who
    ranks up while a field is growing. Measured, that reading hands somebody
    else's crop to a higher rank before the owner's own timer has run: a Novice
    sows Wheat at 45 minutes, a Master presses the same plot at 25 minutes and
    growByRank[3] makes it 24.75, so it is ripe for the Master and the owner's
    own /plot still says 20 minutes to go. The plot's state is not allowed to
    depend on who is looking at it, and the profitable play must not be to let
    other people sow and then walk their rows. So the multiplier is applied once,
    at sowing, by the person who sowed it.

      ms    the whole wait chosen at sowing, in milliseconds.
      step  the rank step of whoever sowed it, which is what the yield is sized
            by. A plot pays what the person who put the seed in the ground has
            earned, wherever the person pressing it stands on the ladder.

    A record written before those two existed has neither, and both fall back to
    the novice reading, which is the longest wait and the smallest yield. A
    fallback that guessed the other way would pay out early on every plot in the
    world the moment this release went out.

    Every read is wrapped. mp.get throws for a reference that is gone, and a
    reference goes when a cell is unloaded and rebuilt, so this is the normal
    case rather than the strange one. A throw means empty, which is the answer
    that gives nothing away.

    The crop is checked against CROPS by own property before it is believed. It
    comes back out of the world save, which is a file on the VPS, and a saved
    string of '__proto__' finding something on Object.prototype is the same hole
    the progression block's own() was written for.
  */
  function orchardRef(refrId) {
    if(!g.__thornswoodQuestOrchardRefs && mp.get(refrId,'baseDesc')==="141081:JK's Whiterun's Outskirts.esp")throw Error('Orchard references are unavailable');
    return g.__thornswoodQuestOrchardRefs && g.__thornswoodQuestOrchardRefs[refrId];
  }
  function plotValue(refrId) {
    var ref=orchardRef(refrId);
    if(ref) {
      if(!g.__thornswoodOrchardPlots)throw Error('Orchard plots are unavailable');
      return g.__thornswoodOrchardPlots.read(ref);
    }
    return mp.get(refrId,PLOT_PROPERTY);
  }
  function setPlotValue(refrId,value) {
    var ref=orchardRef(refrId);
    if(ref) {
      if(!g.__thornswoodOrchardPlots || !(value.crop ? g.__thornswoodOrchardPlots.sow(ref,value) : g.__thornswoodOrchardPlots.write(ref,value)))throw Error('Orchard plot was not written');
    } else mp.set(refrId,PLOT_PROPERTY,value);
  }
  function readPlot(refrId,raw) {
    var v = null;
    try { v = arguments.length>1 ? raw : plotValue(refrId); } catch (e) { return null; }
    if (!v || typeof v !== 'object') { return null; }
    if (typeof v.crop !== 'string' || !P.has(CROPS, v.crop)) { return null; }
    var at = Number(v.at) || 0;
    if (at <= 0) { return null; }
    var ms = Number(v.ms) || 0;
    if (ms <= 0) { ms = growMs(v.crop, 0); }
    var step = Number(v.step) || 0;
    if (step < 0 || step > RANK_STEPS.length - 1) { step = 0; }
    return { by: Number(v.by) || 0, crop: v.crop, at: at, ms: ms, step: step,
             fed: v.fed === 1 ? 1 : 0 };
  }

  /*
    HAS THE SERVER EVER WRITTEN TO THIS PLOT AT ALL.

    readPlot answers null for two completely different plots: one the server has
    never touched, and one it emptied a minute ago. clearPlot writes the empty
    shape rather than removing the property precisely so that a plot which has
    been worked still carries a mark, and this is the read that uses that mark.

    PATRICK, 20 September: 'they cant get the crops from anwyhere so like how
    would do that'. This is the answer, and it is the same answer as to 'all the
    farms are already full but they shouldnt be'. Every farm in Skyrim is
    standing there full right now, because Bethesda put a cabbage in every row.
    A plot nobody has ever worked is holding the crop the world put there, and
    the first bring-in off it is real and is yours. That is where the first
    cabbage comes from, and the first wheat, and the first apple: you go and
    find the field. After that the plot carries the mark, it is empty, and only
    sowing fills it again.

    So a farm is full exactly once, which is what an abandoned farm should be,
    and the seed problem solves itself without a merchant, a levelled list or a
    single new record. It is not infinite: one plot gives one free crop in the
    life of the world, and the rank gate still decides whether you may take it,
    so a Novice standing under an apple tree is told to come back an Expert.

    A read that throws counts as never written, because a reference the property
    binding cannot be read from is one it cannot be written to either, and the
    clearing below refuses to pay out when the write fails. So the worst a
    throwing reference can do is answer 'try again in a moment', not pay twice.
  */
  function neverWorked(refrId) {
    var v = null;
    try { v = plotValue(refrId); } catch (e) { return true; }
    return !v || typeof v !== 'object';
  }

  function writePlot(refrId, by, crop, ms, step) {
    try {
      setPlotValue(refrId,
             { by: by, crop: crop, at: Date.now(), ms: ms, step: step });
      return true;
    } catch (e) {
      flog('could not sow', refrId.toString(16) + ':', e);
      return false;
    }
  }

  /*
    Emptied by writing the empty shape rather than by removing the property.

    A removal the binding refused, or a null the binding would not take, would
    leave a ripe plot ripe for ever, and a ripe plot that can be pressed again
    and again is precisely the free infinite farming this whole block exists to
    stop. Writing { by: 0, crop: '', at: 0 } goes down the same code path a
    sowing does, so if a sowing can be written then a clearing can be, and
    readPlot answers null for it because '' is not a crop.

    The caller checks the answer and refuses to hand anything over when it is
    false, so a plot that could not be cleared is a plot nobody was paid for.
  */
  function clearPlot(refrId,expected) {
    try {
      var ref=orchardRef(refrId);
      if(ref)return !!g.__thornswoodOrchardPlots && g.__thornswoodOrchardPlots.compareWrite(ref,expected,{by:0,crop:'',at:0,ms:0,step:0});
      setPlotValue(refrId, { by: 0, crop: '', at: 0, ms: 0, step: 0 });
      return true;
    } catch (e) {
      flog('could not clear', refrId.toString(16) + ':', e);
      return false;
    }
  }

  // --------------------------------------------------------- rank and time --

  function rankPhrase(rank) {
    var n = String(rank || '').charAt(0).toUpperCase() + String(rank || '').slice(1);
    return (/^[aeiou]/i.test(n) ? 'an ' : 'a ') + n;
  }

  function stepOf(rank) {
    var at = RANK_STEPS.indexOf(rank);
    return at < 0 ? 0 : at;
  }

  /*
    The rank this crop asks for, which is the one in CROP_RULES and nothing else.

    It was clamped to TUNING.farming.demandAtMost until 20 September, and that
    knob is gone with the reason for it. CROPS carried the rank harvests.json
    gives a base, which is the gold value of the produce, and ten of the eleven
    came out Advanced, which would have left a new Farmer with nothing they could
    sow. So every crop was clamped down to novice instead, and the clamp was
    total: rankOk became step >= 0, which is true for everybody, so the whole
    gate was dead and its two refusals could not be printed. classes.md publishes
    a ladder now, CROP_RULES puts each crop on a rung of it, and the gate is
    live: a Novice is refused the orchard and told so.
  */
  function demanded(crop) {
    return CROPS[crop].rank;
  }

  function rankOk(step, crop) {
    return step >= stepOf(demanded(crop));
  }

  /*
    How long this crop takes for somebody at this rank, in milliseconds.

    Called once per sowing, by plant(), and the answer is written onto the plot.
    See readPlot for why it is not worked out again at every read. The floor of
    one minute is there so a multiplier edited to nothing cannot make a crop ripe
    the instant it is sown.
  */
  function growMs(crop, step) {
    var by = tuning().growByRank;
    var mult = by[Math.max(0, Math.min(by.length - 1, step))];
    return Math.max(60000, Math.round(CROPS[crop].growMinutes * 60000 * mult));
  }

  /*
    Milliseconds the crop clock has actually run since sowing.

    Winter adds nothing, even on a warm day. Autumn adds nothing for an
    expert or a master. The plot is not cleared. Time before the first
    season count is spring. If the season block is not loaded, this is
    wall-clock time, which is what the older harness measures.
  */
  function grownSoFar(plot,strict) {
    var S = g.__thornswoodSeason;
    var rank = (CROPS[plot.crop] && CROPS[plot.crop].rank) || 'novice';
    if (!S || !S.grownMs) { if(strict)throw Error('Season is unavailable');return Date.now() - plot.at; }
    try { var elapsed=S.grownMs(plot.at, Date.now(), rank);if(strict && (!Number.isFinite(elapsed)||elapsed<0))throw Error('Season growth cannot be verified');return elapsed; }
    catch (e) { if(strict)throw e;return Date.now() - plot.at; }
  }

  /*
    Whole minutes still to wait, rounded up, and 0 when it is ready.

    The crop clock is real time only while the season on the farmer page
    lets this rank grow. Winter adds nothing, even on a warm day. Autumn
    adds nothing for an expert crop. The plot is not cleared: it stays
    sown, and the minutes left are the wait minus the time the clock ran.
  */
  function minutesLeft(plot,strict) {
    var left = plot.ms - grownSoFar(plot,strict);
    return left > 0 ? Math.ceil(left / 60000) : 0;
  }

  function minutes(n) { return n + ' minute' + (n === 1 ? '' : 's'); }

  function yieldAt(step) {
    var by = tuning().yieldByRank;
    return by[Math.max(0, Math.min(by.length - 1, step))];
  }

  /*
    COMPOST (#3526). Patrick, 26 October 2026, on his report page: food
    that runs out of days stays as spoiled food, and a Farmer can work it
    into a plot as compost (#3163, C). What it does there he answered
    "A+B": the crop needs a quarter less time to ripen, and the plot gives
    one more when it is brought in (compostGrow and compostExtra).

    The press is the plot's own. A Farmer presses a plot they sowed while
    it is still growing, with spoiled food in the pack, and one piece goes
    into the ground; the line at the plot names that press first. Nothing
    is typed. Once per sowing: the plot carries fed: 1 until it is brought
    in, and clearPlot's empty shape has no fed.

    Only on ordinary plots. The ten orchard trees are the orchard work's
    (createCustomQuests), which counts what it hands over against the
    work's own hold, so a plot there that gave one more would be refused
    at the bring-in.

    Spoiled food is one record of the content plugin, each piece named
    for its food (the spoilage block), so the record is the whole test
    and the name is only what the sentence says.
  */
  var compostKept = -1;
  function compostId() {
    if (compostKept < 0) {
      var sp = (typeof FOOD_GROUPS !== 'undefined' && FOOD_GROUPS && FOOD_GROUPS.spoil) || null;
      compostKept = 0;
      try { compostKept = (sp && sp.spoiled) ? (idOf(sp.spoiled) || 0) : 0; } catch (e) { compostKept = 0; }
      if (!compostKept) { flog('no spoiled food record in this load order, so no plot takes compost'); }
    }
    return compostKept;
  }

  /*
    The spoiled food this press would work into this plot, as the pack
    and which line of it, or null when the press is not compost: not the
    presser's own sowing, already fed, an orchard tree, or nothing spoiled
    in the pack.
  */
  function compostFor(actorId, refrId, plot) {
    if (!plot || plot.fed || orchardRef(refrId)) { return null; }
    var mine = profileOf(actorId);
    if (!mine || plot.by !== mine) { return null; }
    var id = compostId();
    if (!id) { return null; }
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { return null; }
    var entries = (inv && inv.entries) || [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e && e.baseId === id && e.count > 0 && !mintedEntry(e)) { return { entries: entries, at: i }; }
    }
    return null;
  }

  /*
    One piece out of the pack, then the plot written with the shorter wait
    and fed. The pack goes first and is put back as it was when the plot
    will not take the write, the way sowAt hands the seed back: a plot fed
    for nothing is the free yield this block exists to stop, and food lost
    to a failed write is a person's food gone.
  */
  function compost(actorId, refrId, plot, carried) {
    var before = JSON.parse(JSON.stringify(carried.entries));
    var after = JSON.parse(JSON.stringify(carried.entries));
    var piece = after[carried.at];
    var name = String(piece.name || '') || 'spoiled food';
    piece.count -= 1;
    if (piece.count <= 0) { after.splice(carried.at, 1); }
    try { mp.set(actorId, 'inventory', { entries: after }); } catch (e) {
      flog('could not take compost from', actorId.toString(16) + ':', e);
      return 'The server cannot get at your pack right now. Press it again in a moment.';
    }
    var fed = { by: plot.by, crop: plot.crop, at: plot.at,
                ms: Math.max(60000, Math.round(plot.ms * tuning().compostGrow)),
                step: plot.step, fed: 1 };
    try { setPlotValue(refrId, fed); } catch (e) {
      flog('could not feed', refrId.toString(16) + ':', e);
      try { mp.set(actorId, 'inventory', { entries: before }); } catch (e2) {
        flog('could not put the compost back for', actorId.toString(16) + ':', e2);
      }
      return 'The ground would not take it. Nothing was worked in and the ' + name +
             ' is back in your pack.';
    }
    var crop = CROPS[plot.crop];
    flog(actorId.toString(16), 'worked', name, 'into', crop.name, 'at', refrId.toString(16));
    return 'You work the ' + name + ' into the ground. The ' + crop.name + ' is ready in ' +
           minutes(minutesLeft(fed)) + ' now, and gives one more when you bring it in.';
  }

  // -------------------------------------------------------------- the land --

  function profileOf(actorId) {
    try { return Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { return 0; }
  }

  function nameOfActor(actorId) {
    try {
      var ap = mp.get(actorId, 'appearance');
      var n = String((ap && ap.name) || '');
      if (n) { return n; }
    } catch (e) { }
    return 'somebody';
  }

  function where(actorId) {
    try {
      var cell = String(mp.get(actorId, 'worldOrCellDesc') || '');
      var pos = mp.get(actorId, 'pos');
      if (!cell || !pos) { return null; }
      return { cell: cell, pos: pos };
    } catch (e) { return null; }
  }

  /*
    The ground a plot stands on: its cell and its position, or null.

    Null is 'the server could not read this plot', which is a different fact from
    'nobody holds this ground' and every caller treats it as one. mp.get throws
    for a reference whose cell has been unloaded and rebuilt, which readPlot
    above calls the normal case, and the old code turned that throw into an
    unclaimed plot and paid the crop out.
  */
  function groundOf(refrId) {
    try {
      var cell = String(mp.get(refrId, 'worldOrCellDesc') || '');
      var pos = mp.get(refrId, 'pos');
      if (!cell || !pos) { return null; }
      return { cell: cell, pos: pos };
    } catch (e) { return null; }
  }

  /** Flat distance, because a farm on a slope is still one patch of ground. */
  function flatDistance2(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1];
    return dx * dx + dy * dy;
  }

  /*
    The nearest crop reference within reach, or null.

    mp.getNeighborsByPosition hands back everything in the 4096 unit grid square
    around a position, which is a lot of doors and rocks, so it is filtered down
    to bases that are crops and then to the nearest one inside
    TUNING.farming.reach.

    WANTEMPTY IS WHAT /PLANT ASKS FOR, and it is not a nicety. Nearest-of-all
    meant standing between a sown plot at 50 units and an empty one at 120, both
    within reach, answered 'Something is already sown here. Find an empty plot'
    until the person physically walked far enough for the other one to win. That
    is the interaction the class spends its first hours in. The empty one is
    preferred when there is one and the nearest of all is still the answer when
    there is not, so 'already sown here' is still said when everything in reach
    really is sown.

    WORTH KNOWING: it returns one square and not nine. Standing right on a grid
    line, a plot one step away in the next square is not in the list at all, and
    the honest answer to that is the one the refusal gives, which is to stand
    closer. Widening it to the nine surrounding squares would mean nine calls
    and a lot more references to walk on every /plant, for a case that a single
    step fixes. A claim does not have this problem: it is read by distance from
    the plot it was made at rather than out of a neighbour list.
  */
  function nearestPlot(actorId, wantEmpty) {
    var at = where(actorId);
    if (!at) { return null; }
    var near = [];
    try { near = mp.getNeighborsByPosition(at.cell, at.pos) || []; } catch (e) { return null; }

    var reach = tuning().reach;
    var best = null, bestD = reach * reach;
    var bestEmpty = null, bestEmptyD = reach * reach;
    for (var i = 0; i < near.length; i++) {
      var id = near[i];
      var base = '';
      try { base = String(mp.get(id, 'baseDesc') || ''); } catch (e) { continue; }
      if (!P.has(CROPS, base)) { continue; }
      var p = null;
      try { p = mp.get(id, 'pos'); } catch (e) { continue; }
      if (!p) { continue; }
      var dz = p[2] - at.pos[2];
      var d = flatDistance2(p, at.pos) + dz * dz;
      if (d <= bestD) { bestD = d; best = { refrId: id, base: base }; }
      if (wantEmpty && d <= bestEmptyD && !readPlot(id)) {
        bestEmptyD = d; bestEmpty = { refrId: id, base: base };
      }
    }
    return bestEmpty || best;
  }

  // ------------------------------------------------------------- the claims --

  function claimsPath() {
    // In the private folder, not data. Issue #541, 25 September: the
    // resources server hands anything under data to anybody who asks, and
    // every record here carries the profile id of the person it belongs to,
    // which is what the door checks. Measured the same day: the live
    // farm-claims.json answered 200 on port 3000. The door list moved for the
    // same reason (privDir, above). Nothing is read from data: the alpha
    // carries no data over a change (#3094).
    var privDir = 'private';
    try {
      var cfg = JSON.parse(require('fs').readFileSync('server-settings.json', 'utf8'));
      if (cfg && cfg.privDir) { privDir = String(cfg.privDir); }
    } catch (e) { }
    return require('path').join(privDir, 'farm-claims.json');
  }

  /*
    The record off disk, rebuilt field by field rather than trusted whole.

    Nothing from the file reaches the record as it was written. Every key is
    checked, every value is rebuilt out of a Number and a String, and anything
    that does not answer is dropped. That is not caution about the file, which
    only this block writes: it is that a record which goes back out through
    JSON.stringify must not be able to carry a function, a prototype member or
    anything else that was never a claim.

    '__proto__' is skipped by name. Assigning to it on a plain object sets the
    prototype rather than a key, which would put every later lookup on an object
    somebody else chose. Every read below goes through P.has as well.

    A CLAIM IS KEYED BY THE PROFILE THAT HOLDS IT. One claim per person is the
    rule, so it is the shape of the record: writing a second claim for somebody
    replaces the first by itself, rather than a loop walking every claim in the
    file deleting the ones that match.

    CLAIMS IN THE OLD SHAPE ARE DROPPED, and the log says how many. They were
    keyed by a grid square and carried no position, and there is no honest way to
    turn a square into the plot somebody was standing at: the middle of the
    square is a guess, and the guess would be wrong by up to 2896 units, which is
    a farm and a half. So they go, and the holder says /claim again, standing in
    the farm. This is a dev server in closed playtest and the file has a handful
    of rows in it.
  */
  function loadClaims() {
    var out = {};
    var raw = null;
    try { raw = JSON.parse(require('fs').readFileSync(claimsPath(), 'utf8')); } catch (e) { return out; }
    var held = (raw && typeof raw === 'object' && raw.claims && typeof raw.claims === 'object')
      ? raw.claims : {};
    var kept = 0, old = 0;
    for (var k in held) {
      if (!Object.prototype.hasOwnProperty.call(held, k)) { continue; }
      if (k === '__proto__') { continue; }
      var c = held[k];
      if (!c || typeof c !== 'object') { continue; }
      var by = Number(c.by) || 0;
      var at = Number(c.at) || 0;
      if (!by || !at) { continue; }
      var cell = String(c.cell || '');
      var x = Number(c.x), y = Number(c.y);
      if (!cell || !isFinite(x) || !isFinite(y)) { old++; continue; }
      out[String(by)] = { by: by, name: String(c.name || 'somebody'), at: at,
                          cell: cell, x: x, y: y };
      kept++;
    }
    flog('read', kept, 'farm claims from', claimsPath(),
         old ? '(' + old + ' in the old grid shape were dropped, and whoever held one says /claim again)' : '');
    return out;
  }

  /*
    When each profile was last handed seed. See offerSeed.

    It lives in the same file as the claims because it is the same kind of fact,
    a thing this block remembers about a person across a restart, and a second
    file for one timestamp each is a second thing to deploy and back up.
  */
  function loadSeeded() {
    var out = {};
    var raw = null;
    try { raw = JSON.parse(require('fs').readFileSync(claimsPath(), 'utf8')); } catch (e) { return out; }
    var was = (raw && typeof raw === 'object' && raw.seeded && typeof raw.seeded === 'object')
      ? raw.seeded : {};
    for (var k in was) {
      if (!Object.prototype.hasOwnProperty.call(was, k)) { continue; }
      if (k === '__proto__') { continue; }
      var at = Number(was[k]) || 0;
      if (at > 0) { out[String(k)] = at; }
    }
    return out;
  }

  // On globalThis so a hot reload does not drop everybody's farm and read the
  // file again in the middle of a session. The file is the record across a
  // restart; this is the record across a reload.
  if (!g.__thornswoodFarmClaims) { g.__thornswoodFarmClaims = loadClaims(); }
  var claims = g.__thornswoodFarmClaims;
  if (!g.__thornswoodFarmSeeded) { g.__thornswoodFarmSeeded = loadSeeded(); }
  var seeded = g.__thornswoodFarmSeeded;

  function saveClaims() {
    try {
      require('fs').mkdirSync(require('path').dirname(claimsPath()), { recursive: true });
      require('fs').writeFileSync(claimsPath(),
                                  JSON.stringify({ at: Date.now(), claims: claims, seeded: seeded }));
      return true;
    } catch (e) {
      flog('could not write the claims file, so these claims last until the next restart:', e);
      return false;
    }
  }

  /*
    Has this claim been left long enough to lapse, and if so, drop it.

    Done at the moment somebody asks rather than by a timer: there is no tick
    that would notice sooner and nothing in the world changes when a claim lapses
    except the answer to the question.
  */
  function lapsed(key) {
    var c = claims[key];
    var days = tuning().claimLapseDays;
    if (days > 0 && (Date.now() - c.at) > days * 86400000) {
      delete claims[key];
      saveClaims();
      flog('the claim', c.name, 'held in', c.cell, 'lapsed after', days,
           'days with nothing done on it');
      return true;
    }
    return false;
  }

  /*
    Who holds this patch of ground, or null for ground nobody holds.

    ground is what groundOf answers, so a caller that could not read the plot has
    already refused before it gets here and null never means 'the read failed'.

    Every claim is walked rather than a key looked up. There is one claim per
    person and this is a closed playtest, so the list is short, and walking it is
    what makes a claim a circle around a plot instead of a square with lines
    through the farm.
  */
  function claimCovering(ground,strict) {
    if (!ground) { return null; }
    /*
      A HOME AND ITS FARM ARE ONE CLAIM, and the home is asked first.

      Patrick settled that on 21 September and then said plainly that he meant
      it in the code and not only in the rules: "I was meaning the farm and
      property being one property in the code and not just the claim".

      So the property block is asked before this block looks at its own claims
      at all. Ground outside somebody's front door belongs to the house, and
      claiming the house is what claimed it: there is no second /claim to say
      and no second record to keep. What is left here is ground with no building
      on it, which is what a farm claim was always for.

      The answer is shaped like one of this block's own claims, so every caller
      below reads it without knowing which half of the system answered.
    */
    var W = g.__thornswoodProperty;
    if(strict && (!W || typeof W.coversGround!=='function'))throw Error('Property claims are unavailable');
    if (W && W.coversGround) {
      try {
        var house = W.coversGround(ground);
        if (house) { return house; }
      } catch (e) {
        if(strict)throw e;
        flog('the property block threw about ground, so only farm claims count:', e);
      }
    }
    var radius = tuning().claimRadius;
    var within = radius * radius;
    var keys = Object.keys(claims);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!P.has(claims, k)) { continue; }
      var c = claims[k];
      if (c.cell !== ground.cell) { continue; }
      if (flatDistance2([c.x, c.y], ground.pos) > within) { continue; }
      if (lapsed(k)) { continue; }
      return c;
    }
    return null;
  }

  /*
    The claim that would be run into by claiming here, or null.

    Two claims of the same radius overlap when their middles are closer than two
    radii, and an overlap would put one plot inside two farms with no way to say
    whose it is. So they are kept apart, and the person is told whose ground they
    are standing next to.
  */
  function claimTooClose(ground, mine) {
    var reachOfTwo = tuning().claimRadius * 2;
    var within = reachOfTwo * reachOfTwo;
    var keys = Object.keys(claims);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!P.has(claims, k)) { continue; }
      var c = claims[k];
      if (c.by === mine) { continue; }
      if (c.cell !== ground.cell) { continue; }
      if (flatDistance2([c.x, c.y], ground.pos) > within) { continue; }
      if (lapsed(k)) { continue; }
      return c;
    }
    return null;
  }

  /*
    Work done on a farm is a visit, so the lapse counts neglect and not age.

    It takes the ground the plot stands on, which is the same ground the
    ownership was read from a few lines earlier in every caller. It used to take
    the grid key of the square the plot was in while the claim was filed under
    the square the claimer had been standing in, so on a farm that straddled a
    line the refresh silently found nothing and the claim lapsed under somebody
    who had worked it every day.
  */
  function touchClaim(ground, profileId) {
    var c = claimCovering(ground);
    if (!c || c.by !== profileId) { return; }
    c.at = Date.now();
    saveClaims();
  }

  // ------------------------------------------------------------ the pressing --

  /*
    Somebody pressed E on a crop. The order of the answers is the design, and
    each one is a plain sentence saying what to do next.

      not a farmer            the class refusal the other four verbs use
      nothing sown            an empty plot, whatever the model looks like
      sown and still growing  how long is left, in whole minutes, rounded up,
                              and the same number for everybody
      cannot tell who         the profile did not read, so nothing is handed over
      cannot tell where       the plot's own ground did not read, so nothing is
                              handed over: it is not the same fact as ground
                              nobody holds
      somebody else's         sown by another person on a farm another person
                              holds, so the holder is named
      rank too low            the rank the crop wants, named
      ripe and yours          the produce, the work counted, the plot emptied

    The class comes first, before anything about this particular plot, so that
    somebody who is not a farmer gets the same answer at every crop in Skyrim
    rather than 'still growing' at one and a refusal at the next. That is the
    same ordering harvest() above settled on and for the same reason.

    The panel is not rebuilt here. The work goes through creditWork, which goes
    through the character block's credit(), which writes the state and only
    sends the panel when the drawn signature actually changed. So a row of
    cabbages is a row of counter writes and not a row of browser updates.
  */
  /*
    THE ONE FREE CROP OFF A FIELD NOBODY HAS WORKED.

    Called only from activate, and only for a plot neverWorked says the server
    has never written to. Every gate a sown plot gets, this gets: the class is
    already checked by the caller, and the claim and the rank are checked here
    in the same order and with the same sentences, so walking onto a stranger's
    farm is refused whether the row was sown by them or by Bethesda.

    The plot is marked BEFORE the crop is handed over, for the same reason the
    sown path empties before it pays: a mark that failed to write and a crop
    that did would be a plot that pays out on every press, which is the free
    farming this block exists to stop.

    It counts as farming work, because it is. Walking a field and bringing in
    what is standing is how a new Farmer earns the rank that opens the next
    rung, and it is the only work available to somebody who owns no seed at all.
  */
  function awardQuestCrop(actorId,refrId,baseDesc,crop,n,original,plot,grant) {
    var mine=profileOf(actorId),ground=groundOf(refrId),store=g.__thornswoodOrchardPlots;
    var ref=orchardRef(refrId);
    function eligible() {
      try {
        if(!mine || !ground || !grant.current() || classGate(actorId,'farm') || toolGate(actorId,'farmer') ||
           profileOf(actorId)!==mine || !rankOk(rankStep(actorId,'farmer'),baseDesc))return false;
        if(plot && (plot.crop!==baseDesc || minutesLeft(plot,true)>0))return false;
        var nowGround=groundOf(refrId);
        if(!nowGround || JSON.stringify(nowGround)!==JSON.stringify(ground))return false;
        var held=claimCovering(nowGround,true);
        return !(held && held.by!==mine && (!plot || plot.by!==mine));
      } catch(error){return false;}
    }
    return !!store && !!ref && store.harvest(ref,original,eligible,function(fence){return grant(crop.produce,n,fence);});
  }

  function standing(actorId, refrId, baseDesc, crop, grant, original) {
    var step = rankStep(actorId, 'farmer');

    var mine = profileOf(actorId);
    if (!mine) {
      return 'The server cannot tell who you are right now. Give it a moment and press it again.';
    }
    var ground = groundOf(refrId);
    if (!ground) {
      return 'The server cannot tell which ground this plot stands on, so it will ' +
             'not hand you the crop. Try it again in a moment.';
    }
    var held = claimCovering(ground);
    if (held && held.by !== mine) {
      return 'This farm is held by ' + held.name + '. Ask them for what you ' +
             'need, or claim ground nobody holds.';
    }

    if (!rankOk(step, baseDesc)) {
      return 'Bringing in ' + crop.name + ' needs ' + rankPhrase(demanded(baseDesc)) +
             ' Farmer. Work the crops you can until you are one.';
    }

    if (!idOf(crop.produce)) {
      return 'The ' + crop.name + ' comes up and there is nothing in this load ' +
             'order to put in your hands. Say so in the dev channel.';
    }
    if (grant ? !awardQuestCrop(actorId,refrId,baseDesc,crop,1,original,null,grant) : !clearPlot(refrId,original)) {
      return 'The ' + crop.name + ' will not come out of the ground. Try it again in a moment.';
    }

    /*
      One, whatever the rank. The rank multiplier is what a farmer earns on a
      plot they sowed themselves; a row somebody else planted and walked away
      from pays what is on it and no more.
    */
    if(!grant && addItem(actorId, crop.produce, 1))economyGathered(actorId, crop.produce, 1);
    if(grant && !grant.current())return "The orchard work has changed.";
    touchClaim(ground, mine);
    if(grant && !grant.current())return 'The orchard work has changed.';
    var rank = creditWork(actorId, 'farm');
    flog(actorId.toString(16), 'brought in the standing', crop.name, 'at',
         refrId.toString(16) + ', a plot nobody had worked');
    return 'You bring in the ' + crop.name + ' that was standing here. The plot ' +
           'is empty now, and only sowing will fill it again.' + (rank ? ' ' + rank : '');
  }

  /*
    Sow one named plot, and answer with the sentence to say.

    This is the body of /plant from the moment the plot is known, so the command
    and the press cannot drift into saying different things or enforcing
    different rules. /plant finds a plot and calls this; a press already has one.
  */
  function sowAt(actorId, refrId, baseDesc, grant) {
    if(orchardRef(refrId) && !grant) {
      var quests=g.__thornswoodQuests;
      return quests && quests.sowOrchard ? quests.sowOrchard(actorId,refrId,baseDesc).text : 'The orchard is unavailable for now.';
    }
    var crop = CROPS[baseDesc];
    if (!crop) { return null; }

    var mine = profileOf(actorId);
    if (!mine) {
      return 'The server cannot tell who you are right now. Give it a moment and ' +
             'press it again.';
    }

    var step = rankStep(actorId, 'farmer');
    if (!rankOk(step, baseDesc)) {
      return 'Sowing ' + crop.name + ' needs ' + rankPhrase(demanded(baseDesc)) +
             ' Farmer. Work the crops you can until you are one.';
    }

    var ground = groundOf(refrId);
    if (!ground) {
      return 'The server cannot tell which ground that plot stands on. Move a step ' +
             'and press it again.';
    }
    var held = claimCovering(ground);
    if (held && held.by !== mine) {
      return 'This farm is held by ' + held.name + '. Ask before you sow here, or ' +
             'claim ground nobody holds.';
    }

    if(orchardRef(refrId)) {
      var store=g.__thornswoodOrchardPlots,ref=orchardRef(refrId),original;
      try {original=store.read(ref);}catch(error){return 'The orchard is unavailable for now.';}
      var ms=growMs(baseDesc,step),next={by:mine,crop:baseDesc,at:Date.now(),ms:ms,step:step};
      function eligible() {
        try {
          if(!grant || !grant.current() || classGate(actorId,'farm') || toolGate(actorId,'farmer') ||
             profileOf(actorId)!==mine || !rankOk(rankStep(actorId,'farmer'),baseDesc))return false;
          var now=groundOf(refrId);
          if(!now || JSON.stringify(now)!==JSON.stringify(ground))return false;
          var held=claimCovering(now,true);return (!held || held.by===mine) && grant.current();
        }catch(error){return false;}
      }
      if(!store.sowWithSeed(ref,original,next,eligible,function(fence){return grant.seed(crop.produce,fence);})) {
        if(store.available() && eligible() && grant.sourceCurrent() && !carriesSeed(actorId,baseDesc) && grant.current()) {
          var handout=offerSeed(actorId,mine);
          if(handout)return handout;
        }
        return 'Sowing did not complete. Check your pack and this plot.';
      }
      if(grant.current())touchClaim(ground,mine);
      return 'You sow the '+crop.name+'. It will be ready in '+minutes(Math.ceil(ms/60000))+'.';
    }
    if (!takeItem(actorId, crop.produce, 1)) {
      var handout = offerSeed(actorId, mine);
      if (handout) { return handout; }
      return 'You have no ' + crop.name + ' to sow. Bring one and press it again.';
    }

    var ms = growMs(baseDesc, step);
    if (!writePlot(refrId, mine, baseDesc, ms, step)) {
      addItem(actorId, crop.produce, 1);
      return 'The ground would not take it. Nothing was sown and the ' + crop.name +
             ' is back in your pack.';
    }

    touchClaim(ground, mine);
    var mins = Math.ceil(ms / 60000);
    flog(actorId.toString(16), 'sowed', crop.name, 'at', refrId.toString(16),
         'for', mins, 'minutes');
    return 'You sow the ' + crop.name + '. It will be ready in ' + minutes(mins) + '.';
  }

  function activate(actorId, refrId, baseDesc, grant) {
    if (!P.has(CROPS, baseDesc)) { return null; }
    var here = CROPS[baseDesc];

    var refused = classGate(actorId, 'farm');
    if (refused) { return refused; }

    /*
      The shovel, and it stands where the class gate stands: before anything
      about this particular plot, so a Farmer with no shovel gets the same
      answer at every crop in Skyrim rather than 'still growing' at one and a
      refusal at the next. Skyrim has no hoe; see TOOLS.
    */
    var noTool = toolGate(actorId, 'farmer');
    if (noTool) { return noTool; }

    var original;
    var captured=!!grant || !!orchardRef(refrId);
    if(captured) {try {original=plotValue(refrId);}catch(error){return 'The orchard is unavailable for now.';}}
    var plot = captured ? readPlot(refrId,original) : readPlot(refrId);
    if (!plot) {
      /*
        NOTHING THE SERVER SOWED. Which of the two it is decides everything.

        A plot the server has written to before is empty and says so. A plot it
        has never written to is still holding what the world put there, and that
        first bring-in is the whole seed supply of this server. See neverWorked
        above for why, and for why it cannot run away.
      */
      if (captured ? original && typeof original==='object' : !neverWorked(refrId)) {
        /*
          PRESSING EMPTY GROUND SOWS IT.

          Patrick, 21 September, after playing it: "With Farming I don't want to
          type /plant I want to click e on the ground in that spot."

          It used to answer "Nothing is sown here. Stand close and say /plant",
          which is a server telling somebody to go and use a chat box while they
          are standing on the thing with a shovel in their hand. Every other
          verb in this file is a press: the seam, the block, the kiln, the
          plant. This one asked for typing because it was written as a command
          first and never grew a press.

          THIS PLOT, NOT THE NEAREST ONE. /plant has to go looking, because a
          word carries no reference with it and nearestPlot is how it guesses.
          A press already knows exactly which patch of ground was pressed, so
          there is nothing to guess.
        */
        return sowAt(actorId, refrId, baseDesc,grant);
      }
      return standing(actorId, refrId, baseDesc, here,grant,original);
    }

    var crop = CROPS[plot.crop];
    var step = rankStep(actorId, 'farmer');

    var left = minutesLeft(plot);
    if (left > 0) {
      var carried = grant ? null : compostFor(actorId, refrId, plot);
      if (carried) { return compost(actorId, refrId, plot, carried); }
      return 'The ' + crop.name + ' is still growing. ' + minutes(left) + ' to go.';
    }

    /*
      Somebody else's crop, on somebody else's farm.

      Both halves have to be true. A ripe crop on ground nobody has claimed is
      open to whoever finds it, which is what makes claiming worth doing, and a
      crop sown by a visitor on your own claimed farm is yours to bring in,
      which is what stops a claim being worked around by sowing on it.

      THE TWO READS BEFORE IT REFUSE RATHER THAN PAY OUT, and that is the whole
      of the correction here. Not knowing who is pressing, and not knowing which
      ground the plot stands on, are both 'the server cannot tell', and the old
      code turned each of them into 'nobody holds this ground' and handed the
      crop over. Measured with a stubbed mp: with mp.get(plot, 'pos') throwing,
      a thief pressing a holder's sown plot got 'You bring in 1 Cabbage' where
      one line earlier they had been refused by name. A profile of 0 was worse,
      because 0 is also what plot.by falls back to, so every unreadable plot read
      as the presser's own. Everything else in this block refuses when a read
      fails, and so does this now.
    */
    var mine = profileOf(actorId);
    if (!mine) {
      return 'The server cannot tell who you are right now. Give it a moment and press it again.';
    }
    var ground = groundOf(refrId);
    if (!ground) {
      return 'The server cannot tell which ground this plot stands on, so it will ' +
             'not hand you the crop. Try it again in a moment.';
    }
    var held = claimCovering(ground);
    if (held && held.by !== mine && plot.by !== mine) {
      return 'This farm is held by ' + held.name + '. Ask them for what you ' +
             'need, or claim ground nobody holds.';
    }

    if (!rankOk(step, plot.crop)) {
      return 'Bringing in ' + crop.name + ' needs ' + rankPhrase(demanded(plot.crop)) +
             ' Farmer. Work the crops you can until you are one.';
    }

    /*
      The produce is resolved before the plot is emptied, and the plot is
      emptied before anything is handed over. Either order the other way round
      loses: clearing first and failing to hand over costs somebody a crop,
      handing over first and failing to clear leaves a ripe plot that pays out
      on every press, which is the free farming back.
    */
    if (!idOf(crop.produce)) {
      return 'The ' + crop.name + ' comes up and there is nothing in this load ' +
             'order to put in your hands. Say so in the dev channel.';
    }
    /*
      The sower's yield, then the season's share of it (#3144): a quarter more
      in summer and a quarter less in winter, on average, at the bring-in.
      The least a rank brings in is 2, so a winter plot still gives 1.
      Compost's one more (#3526) comes on top, whatever the season.
    */
    var S = g.__thornswoodSeason;
    var n = yieldAt(plot.step);
    if (S && S.seasonYield) { n = S.seasonYield(n); }
    n = n + (plot.fed ? tuning().compostExtra : 0);
    var word = (S && S.yieldWord) ? S.yieldWord() : '';
    if (grant ? !awardQuestCrop(actorId,refrId,baseDesc,crop,n,original,plot,grant) : !clearPlot(refrId,original)) {
      return 'The ' + crop.name + ' will not come out of the ground. Try it again in a moment.';
    }

    /*
      The yield is the sower's, not the presser's. A plot pays what the person
      who put the seed in the ground had earned, which is the other half of
      keeping the plot's state off whoever is looking at it: a Master walking a
      Novice's row brings in a Novice's crop.
    */
    if(!grant && addItem(actorId, crop.produce, n))economyGathered(actorId, crop.produce, n);
    if(grant && !grant.current())return 'The orchard work has changed.';
    touchClaim(ground, mine);
    if(grant && !grant.current())return 'The orchard work has changed.';
    var rank = creditWork(actorId, 'farm');
    /*
      The shovel wears here and NOT in plant(), even though turning the ground
      is plainly shovel work too.

      One use per credited yield, everywhere. A crop is one sowing and one
      bringing in, so counting both would wear a farmer's shovel twice as fast
      as a miner's pickaxe for the same hours at the same ladder, and the
      farmer would be buying two shovels to the miner's one pickaxe for no
      reason anybody could name. Wear sits next to creditWork for that reason:
      the two count the same thing.
    */
    if(grant && !grant.current())return 'The orchard work has changed.';
    var worn = wearTool(actorId, 'farmer');
    flog(actorId.toString(16), 'brought in', n, crop.name, 'at', refrId.toString(16));
    return 'You bring in ' + n + ' ' + crop.name + '.' + (word ? ' ' + word : '') +
           (rank ? ' ' + rank : '') + (worn ? ' ' + worn : '');
  }

  // ----------------------------------------------------------- the commands --

  /*
    /plant takes no argument, and that is not a shortcut.

    A reference's base cannot be changed by the server, so a cabbage plot is a
    cabbage plot for ever and sowing anything else in it would mean a plot that
    looks like cabbages and gives potatoes. What is sown is therefore whatever
    the plot in front of you already is, and the seed is the produce itself: you
    sow a cabbage to grow cabbages. That also means no crop name ever arrives
    off the wire for this command, so there is no name here to be careful with.
  */
  function plant(actorId, profileId, toProfile) {
    var refused = classGate(actorId, 'farm');
    if (refused) { toProfile(profileId, refused); return; }

    // The shovel, before the plot is looked for, for the same reason the class
    // gate is: the answer is the same wherever they are standing.
    var noTool = toolGate(actorId, 'farmer');
    if (noTool) { toProfile(profileId, noTool); return; }

    var mine = profileOf(actorId);
    if (!mine) {
      toProfile(profileId, 'The server cannot tell who you are right now. ' +
                           'Give it a moment and try again.');
      return;
    }

    // The empty plot in reach is preferred over the nearest one. See nearestPlot.
    var found = nearestPlot(actorId, true);
    if (!found) {
      toProfile(profileId, 'No plot within reach. Stand next to the ground you ' +
                           'mean to sow.');
      return;
    }
    if(orchardRef(found.refrId)) {
      toProfile(profileId,sowAt(actorId,found.refrId,found.base));return;
    }
    var crop = CROPS[found.base];
    var step = rankStep(actorId, 'farmer');

    var plot = readPlot(found.refrId);
    if (plot) {
      var left = minutesLeft(plot);
      if (left > 0) {
        toProfile(profileId, 'Something is already sown here, with ' + minutes(left) +
                             ' to go. Find an empty plot.');
      } else {
        toProfile(profileId, 'Something is already sown here and it is ready. ' +
                             'Bring it in first.');
      }
      return;
    }

    if (!rankOk(step, found.base)) {
      toProfile(profileId, 'Sowing ' + crop.name + ' needs ' + rankPhrase(demanded(found.base)) +
                           ' Farmer. Work the crops you can until you are one.');
      return;
    }

    var ground = groundOf(found.refrId);
    if (!ground) {
      toProfile(profileId, 'The server cannot tell which ground that plot stands on. ' +
                           'Move a step and try again.');
      return;
    }
    var held = claimCovering(ground);
    // Refused rather than allowed, although the brief for the command did not
    // ask for it: sowing on ground somebody else holds would put a crop in
    // that the sower is then refused when they come back for it, which is a
    // trap rather than a rule.
    if (held && held.by !== mine) {
      toProfile(profileId, 'This farm is held by ' + held.name + '. Ask before you ' +
                           'sow here, or claim ground nobody holds.');
      return;
    }

    if (!takeItem(actorId, crop.produce, 1)) {
      // An empty pack is where a Farmer's whole class used to end. See offerSeed.
      var handout = offerSeed(actorId, mine);
      if (handout) { toProfile(profileId, handout); return; }
      toProfile(profileId, 'You have no ' + crop.name + ' to sow. Bring one and stand here again.');
      return;
    }
    var ms = growMs(found.base, step);
    if (!writePlot(found.refrId, mine, found.base, ms, step)) {
      // The seed came out of the pack a line ago and nothing was sown with it.
      addItem(actorId, crop.produce, 1);
      toProfile(profileId, 'The ground would not take it. Nothing was sown and the ' +
                           crop.name + ' is back in your pack.');
      return;
    }

    touchClaim(ground, mine);
    var mins = Math.ceil(ms / 60000);
    toProfile(profileId, 'You sow the ' + crop.name + '. It will be ready in ' + minutes(mins) + '.');
    flog(actorId.toString(16), 'sowed', crop.name, 'at', found.refrId.toString(16),
         'for', mins, 'minutes');
  }

  /*
    The farm around the plot in front of you, claimed. One per person.

    IT ASKS FOR A PLOT, and that is the change of 20 September. The command used
    to take the 4096 unit grid square the person was standing in and never look
    for a crop at all, so one word anywhere in a cell took every crop reference
    in 4096 by 4096 units of ground, neighbouring farms included, and the first
    few testers to say it near Whiterun would have held the farm cells for a
    fortnight. Now the claim is the ground around a plot, so claiming means
    standing in a farm, and what is claimed is a farm rather than a district.

    The boundary is a circle with nothing drawn on it, which is why the answer
    says how to find it: the line at any plot says whether that plot is inside.

    THE PLOT IS THE ONE LOOKED AT (#1636). The lock key at a plot sends /claim
    and that plot's id, and plotAt checks it; with no id it is the nearest
    plot in reach, as it always was.
  */
  function claim(actorId, profileId, toProfile, parts) {
    var refused = classGate(actorId, 'farm');
    if (refused) { toProfile(profileId, refused); return; }

    var mine = profileOf(actorId);
    if (!mine) {
      toProfile(profileId, 'The server cannot tell who you are right now. ' +
                           'Give it a moment and try again.');
      return;
    }

    var named = !!(parts && parts[1]);
    var found = named ? plotAt(parts, actorId) : nearestPlot(actorId);
    if (!found) {
      toProfile(profileId, 'No plot within reach, and a claim is the ground around a ' +
                           'plot. Stand in the farm you mean to take, next to one of ' +
                           'its crops, and look at it.');
      return;
    }
    var ground = groundOf(found.refrId);
    if (!ground) {
      toProfile(profileId, 'The server cannot tell which ground that plot stands on. ' +
                           'Move a step and try again.');
      return;
    }

    var held = claimCovering(ground);
    if (held && held.by !== mine) {
      toProfile(profileId, 'This ground is already held by ' + held.name + '. ' +
                           'Find a farm nobody has claimed.');
      return;
    }
    if (held) {
      toProfile(profileId, 'You already hold this ground.');
      return;
    }
    var near = claimTooClose(ground, mine);
    if (near) {
      toProfile(profileId, 'That would run into the farm ' + near.name + ' holds. ' +
                           'Farms do not overlap, so take ground further from theirs.');
      return;
    }

    // One per person, and the record is keyed by the person, so the claim they
    // held before is replaced by this one. They are told which farm they just
    // let go, because somebody who is not told will walk back to it and find
    // another person standing in it.
    var mineKey = String(mine);
    var released = P.has(claims, mineKey) ? claims[mineKey] : null;

    claims[mineKey] = { by: mine, name: nameOfActor(actorId), at: Date.now(),
                        cell: ground.cell, x: ground.pos[0], y: ground.pos[1] };
    saveClaims();
    flog(actorId.toString(16), 'claimed the ground around', found.refrId.toString(16),
         'in', ground.cell, released ? '(released the farm they held in ' + released.cell + ')' : '');

    toProfile(profileId, 'You claim this farm, the ground around that plot' +
              (released ? ', and the farm you held before is let go' : '') +
              '. The line at a plot says whether it is inside. It is yours while ' +
              'you work it, and it lapses after ' + tuning().claimLapseDays +
              ' days with nothing done on it.');
  }

  /*
    What is under your feet. Open to everybody rather than to farmers, because
    it reports and gives nothing: somebody deciding whether to become a farmer,
    or looking for ground nobody has taken, should be able to look.
  */
  function report(actorId, profileId, toProfile) {
    var found = nearestPlot(actorId);
    if (!found) {
      toProfile(profileId, 'No plot within reach. Stand on the ground you mean ' +
                           'to look at.');
      return;
    }
    toProfile(profileId, plotWords(actorId, found));
  }

  /*
    What is in the ground at this plot and whose it is, as one sentence: the
    typed /plot's answer, and the line at a plot (#1636).

    Whose it is, said in three ways and never guessed. A claim that cannot be
    read is its own sentence rather than 'nobody holds this ground', because
    this is how a person finds the edge of a farm and an answer that says
    nobody holds ground that somebody holds is how a tester walks off with
    another person's crop in good faith.
  */
  function plotWords(actorId, found) {
    var ground = groundOf(found.refrId);
    var whose;
    if (!ground) {
      whose = 'The server cannot tell which ground it stands on, so it cannot say whose it is.';
    } else {
      var held = claimCovering(ground);
      var mine = profileOf(actorId);
      if (held && mine && held.by === mine) { whose = 'This ground is yours.'; }
      else if (held) { whose = 'This ground is held by ' + held.name + '.'; }
      else { whose = 'Nobody holds this ground.'; }
    }
    var plot = readPlot(found.refrId);
    if (!plot) {
      // A plot nobody ever worked still holds what the world put there, and
      // the first press brings it in (see neverWorked).
      var named = aOrAn(CROPS[found.base].name);
      if (neverWorked(found.refrId)) {
        return named.charAt(0).toUpperCase() + named.slice(1) +
               ' standing from before anybody farmed here. ' + whose;
      }
      return named.charAt(0).toUpperCase() + named.slice(1) + ' plot, and nothing sown in it. ' + whose;
    }
    var left = minutesLeft(plot);
    if (left > 0) {
      return CROPS[plot.crop].name + ' growing' + (plot.fed ? ', composted' : '') + ', ' +
             minutes(left) + ' to go. ' + whose;
    }
    return CROPS[plot.crop].name + ' ready to bring in. ' + whose;
  }

  /*
    THE PLOT THE LINE OR THE KEY NAMES (#1636), by the id the client sends
    after /plot or /claim, the way the mold key sends a door's. The id is a
    hint and this is the gate: a reference whose base is a crop, in the same
    cell as the person and within LOOK_REACH of them by the server's own
    reckoning. 400 for the reasons MOLD_REACH in the property block gives:
    the crosshair reaches from a camera behind the character, a plot's
    position is its own origin, and the server's position is a moment behind.
    Null for anything else.
  */
  var LOOK_REACH = 400;

  function plotAt(parts, actorId) {
    var raw = String((parts && parts[1]) || '');
    if (!/^[0-9a-f]{1,8}$/i.test(raw)) { return null; }
    var refrId = parseInt(raw, 16);
    var base = '';
    try { base = String(mp.get(refrId, 'baseDesc') || ''); } catch (e) { return null; }
    if (!P.has(CROPS, base)) { return null; }
    var at = where(actorId);
    var ground = groundOf(refrId);
    if (!at || !ground || at.cell !== ground.cell) { return null; }
    var dz = ground.pos[2] - at.pos[2];
    if (flatDistance2(ground.pos, at.pos) + dz * dz > LOOK_REACH * LOOK_REACH) { return null; }
    return { refrId: refrId, base: base };
  }

  /** 'a Cabbage', 'an Ash Yam'. */
  function aOrAn(name) { return (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name; }

  /** Does this pack hold the crop this plot is sown with, its own seed. */
  function carriesSeed(actorId, base) {
    var id = idOf(CROPS[base].produce);
    if (!id) { return false; }
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { return false; }
    var entries = (inv && inv.entries) || [];
    for (var i = 0; i < entries.length; i++) {
      if (entries[i] && entries[i].baseId === id && entries[i].count > 0) { return true; }
    }
    return false;
  }

  /*
    The line at a plot, written to the person looking at it (#1636).

      hex  the plot it is for, so a line never shows at another
      t    what is in the ground and whose farm it is, plotWords
      e    'Sow a Cabbage' when pressing it would sow it: empty, worked
           before, and this person a farmer with the shovel, the rank and
           the crop in the pack, on ground nobody else holds; 'Work in
           spoiled food' when it would compost it (#3526): their own
           sowing, still growing, not fed yet, spoiled food in the pack;
           else ''
      x    'Claim this farm' when the lock key would claim it: a farmer, on
           ground nobody holds and that runs into nobody's farm; with 'and
           let your other one go' when they hold one already; else ''

    The rules stay in sowAt and claim, which the press and the key reach.
    This only says which of them would go through, so nothing is offered
    that would be refused. A plot that is not one or is out of reach writes
    a line with no words, which takes it down.
  */
  var plotLineStamp = 0;

  function plotLine(actorId, profileId, parts, current) {
    var found = plotAt(parts, actorId);
    plotLineStamp = Math.max(plotLineStamp + 1, Date.now());
    var line = { at: plotLineStamp, hex: String((parts && parts[1]) || '').toLowerCase(),
                 t: '', e: '', x: '' };
    if (found) {
      line.t = plotWords(actorId, found);
      var mine = profileOf(actorId);
      var ground = groundOf(found.refrId);
      var held = ground ? claimCovering(ground) : null;
      var farmer = !classGate(actorId, 'farm');
      if (farmer && mine && ground && !toolGate(actorId, 'farmer') && !readPlot(found.refrId) &&
          !neverWorked(found.refrId) && (!held || held.by === mine) &&
          rankOk(rankStep(actorId, 'farmer'), found.base) && carriesSeed(actorId, found.base)) {
        line.e = 'Sow ' + aOrAn(CROPS[found.base].name);
      }
      var sown = readPlot(found.refrId);
      if (farmer && sown && !toolGate(actorId, 'farmer') && minutesLeft(sown) > 0 &&
          compostFor(actorId, found.refrId, sown)) {
        line.e = 'Work in spoiled food';
      }
      if (farmer && mine && ground && !held && !claimTooClose(ground, mine)) {
        line.x = P.has(claims, String(mine)) ? 'Claim this farm and let your other one go'
                                             : 'Claim this farm';
      }
    }
    try {
      if(current && !current())return;
      mp.set(actorId, PLOT_LINE_PROPERTY, line);
    } catch (e) {
      flog('could not write the plot line for', actorId.toString(16) + ':', e);
    }
  }

  /*
    The client half: the line where the front plugin reads it (lockKeyNow
    there), on the client's own clock from when a new stamp arrives.
  */
  function plotLineScript() {
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    if (!v || typeof v !== "object") { return; }',
      '    var was = globalThis.thornswoodPlotLine;',
      '    if (was && was.stamp === v.at) { return; }',
      '    globalThis.thornswoodPlotLine = { stamp: v.at, seen: Date.now(),',
      '      hex: String(v.hex || ""), t: String(v.t || ""), e: String(v.e || ""),',
      '      x: String(v.x || "") };',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  function listOf(items) {
    if (items.length === 1) { return items[0]; }
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  /*
    Seed, handed over and written down.

    The sixteen starter kits went on 20 September (see PASSAGES) and nothing
    else in the game hands anybody anything, so without this a Farmer stands in a
    field holding nothing they can sow. The only way to get a cabbage is to bring
    one in off a plot, and the only way to bring one in is to have sown one,
    which is a circle with nobody in it.

    A crop whose plugin is not in this load order is simply skipped: addItem
    answers false for it and the sentence names what was actually given. The
    moment it happened is kept against the profile so that offerSeed can hold the
    next one off, and it is kept in the claims file rather than in this process,
    because a restart must not be a way to ask again.
  */
  function giveSeeds(actorId) {
    var t = tuning();
    var given = [];
    for (var i = 0; i < t.startingCrops.length; i++) {
      var d = t.startingCrops[i];
      if (!P.has(CROPS, d)) { continue; }
      if (addItem(actorId, CROPS[d].produce, t.startingSeeds)) {
        given.push(t.startingSeeds + ' ' + CROPS[d].name);
      }
    }
    if (!given.length) {
      flog('no starting seed for', actorId.toString(16) +
           ': none of the starting crops resolved in this load order');
      return null;
    }
    var who = profileOf(actorId);
    if (who) { seeded[String(who)] = Date.now(); saveClaims(); }
    flog(actorId.toString(16), 'was handed', given.join(', '));
    return 'You start with ' + listOf(given) + ' to sow. Look at an empty plot of one of them and press it.';
  }

  /** Does this pack hold anything at all that could be sown? */
  function holdsAnySeed(actorId) {
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { return true; }
    var entries = (inv && inv.entries) || [];
    var wanted = {};
    for (var d in CROPS) {
      if (!P.has(CROPS, d)) { continue; }
      var id = idOf(CROPS[d].produce);
      if (id) { wanted[id] = true; }
    }
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || !e.count || e.count <= 0) { continue; }
      if (Object.prototype.hasOwnProperty.call(wanted, e.baseId)) { return true; }
    }
    return false;
  }

  /*
    THE WAY BACK, and the reason it has to exist at all.

    Seed used to be handed out at exactly one moment, the /pick class farmer that
    made somebody a Farmer, and pickClass refuses a second class for the life of
    the character. So a Farmer who lost their crops was a Farmer who could never
    farm again: /plant costs a produce, a bring-in needs a sown plot, and
    grepping the ten produce descriptors over this file finds them nowhere but
    the crop table, so no kit, no station and no other verb can hand one over.
    Worse, every Farmer who picked the class before this release is in that state
    already, because they have a character property so migrate() never runs for
    them and the pick they made is long past. This release blocks the engine's
    own free pick on every crop base in Skyrim, so without a way back it would
    have taken farming away from the people who already chose it.

    The way back is asked for rather than given: it happens at /plant, which is a
    person standing at a plot saying they want to sow, and never from a read.
    Two conditions, and the pack one is the real one:

      the pack holds no produce of any crop on this server at all, so this is
      somebody with nothing rather than somebody topping up, and

      it has been TUNING.farming.seedAgainHours since the last handout, so a
      person cannot stand there dropping crops and asking again.

    It cannot be worked for profit. It pays about nine gold and asks for an empty
    pack; one plot pays more than that in half an hour, and the person had to
    walk to a plot to ask.
  */
  function offerSeed(actorId, profileId) {
    if (holdsAnySeed(actorId)) { return null; }
    var hours = tuning().seedAgainHours;
    var last = P.has(seeded, String(profileId)) ? seeded[String(profileId)] : 0;
    if (last && hours > 0 && (Date.now() - last) < hours * 3600000) {
      var wait = Math.ceil((hours * 3600000 - (Date.now() - last)) / 3600000);
      return 'Your pack is empty and the last seed you were given was today. ' +
             'There is more in ' + wait + ' hour' + (wait === 1 ? '' : 's') + '.';
    }
    var line = giveSeeds(actorId);
    if (!line) { return null; }
    return 'Nothing in your pack to sow, so here is seed. ' + line;
  }

  /*
    The farm this person holds, for the property page on K (#1637), or null.
    days is the whole days left before it lapses with nothing done on it, and
    reach how far it runs out from the plot it was claimed at.
  */
  function farmOf(profileId) {
    var key = String(profileId || '');
    if (!key || key === '0' || !P.has(claims, key) || lapsed(key)) { return null; }
    var lapse = tuning().claimLapseDays;
    var left = lapse > 0 ? lapse * 86400000 - (Date.now() - claims[key].at) : 0;
    return { days: Math.max(0, Math.ceil(left / 86400000)), reach: tuning().claimRadius };
  }

  /*
    A press on a crop, and then the line at it drawn again for whoever
    pressed it (#1636): sowing or bringing in changes what is in the ground,
    so the line says so now rather than at the next ask. Only when the line
    they have is for this plot; nobody else's line moves.
  */
  function press(actorId, refrId, baseDesc, grant) {
    var said = activate(actorId, refrId, baseDesc,grant);
    if(grant && !grant.current())return said;
    var v = null;
    try { v = mp.get(actorId, PLOT_LINE_PROPERTY); } catch (e) { v = null; }
    var hex = (refrId >>> 0).toString(16);
    if (v && typeof v === 'object' && v.hex === hex && (!grant || grant.current())) {
      plotLine(actorId, profileOf(actorId), ['/plot', hex],grant && grant.current);
    }
    return said;
  }

  /*
    /claim and /plot with a plot's id after them are what the client sends at
    a plot (#1636): the lock key, and the look that asks for the line. Nobody
    is told to type any of the three. A claim draws the line again, so the
    key's word is the one that is true after it.
  */
  function command(word, parts, actorId, profileId, toProfile) {
    if (word === '/plant') { plant(actorId, profileId, toProfile); return; }
    if (word === '/claim') {
      claim(actorId, profileId, toProfile, parts);
      if (parts && parts[1]) { plotLine(actorId, profileId, parts); }
      return;
    }
    if (word === '/plot') {
      if (parts && parts[1]) { plotLine(actorId, profileId, parts); return; }
      report(actorId, profileId, toProfile);
      return;
    }
  }

  /*
    A DELETED CHARACTER'S FARM, LET GO (#2351). Asked once, as this block
    loads, through __thornswoodRelease (the release of deleted characters,
    above), with the list Delete-Person.ps1 wrote: the farm
    they claimed is free, as a lapsed claim is, and when they were last
    handed seed is forgotten. A crop they sowed is not here: it is on the
    plot (PLOT_PROPERTY) in the world save, which no call lists by property,
    and it gives their number, which nobody holds any more, the right to
    bring it in; whoever brings it in empties it (clearPlot), and a wipe
    takes it. Answers the counts and whether the write took.
  */
  function release(who) {
    var c = { farms: 0, seed: 0 };
    for (var k in claims) {
      if (!Object.prototype.hasOwnProperty.call(claims, k)) { continue; }
      if (who.profile(Number(k)) || who.profile(Number(claims[k] && claims[k].by))) { delete claims[k]; c.farms++; }
    }
    for (var s in seeded) {
      if (Object.prototype.hasOwnProperty.call(seeded, s) && who.profile(Number(s))) { delete seeded[s]; c.seed++; }
    }
    return { counts: c, saved: (c.farms || c.seed) ? saveClaims() : true };
  }
  if (typeof g.__thornswoodRelease === 'function') { g.__thornswoodRelease('farms', release); }

  g.__thornswoodFarming = {
    PROPERTY: PLOT_PROPERTY, release: release,
    activate: press, harvestQuest:press, sowQuest:sowAt, command: command, giveSeeds: giveSeeds,
    readPlot: readPlot, claimCovering: claimCovering, groundOf: groundOf,
    farmOf: farmOf,
    // For the property block's /claim (#2250): is this id a crop plot, and is
    // there one in reach, so a word that is not about a field stays with it.
    isPlotId: function (raw) {
      raw = String(raw || '');
      if (!/^[0-9a-f]{1,8}$/i.test(raw)) { return false; }
      var base = '';
      try { base = String(mp.get(parseInt(raw, 16), 'baseDesc') || ''); } catch (e) { return false; }
      return P.has(CROPS, base);
    },
    plotNear: function (actorId) { return !!nearestPlot(actorId); }
  };
  flog('ready,', Object.keys(CROPS).length, 'crops and', Object.keys(claims).length, 'claims');
})();
// ==== end thornswood farming ====

