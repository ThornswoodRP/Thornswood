// ==== thornswood carriages ====
/*
  CARRIAGES AND FERRIES: THE ROUTE LIST, THE FARE, AND THE ONE MOVE (#1394).

  docs/systems/carriages.md is the design and every number here is from it.
  You stand within 400 of the driver and press E on him, and a panel of his
  stops and fares opens. A ferry is 10 gold, Solstheim's own ferry included.
  A carriage is 10 to a stop in the same hold and 20 to another hold. 40 is
  only the crossing between the mainland and Solstheim, the Northern Maiden
  between Windhelm and Raven Rock (Patrick, 4 Oct, on #1394). The fare
  goes into the drop box of the hold the stop you leave from is in, as real
  gold, by itself (Patrick, 12 Oct, #2298: boxFare, in the property block);
  until then it was only counted on that hold's ledger. A pack that is
  short does not move and loses nothing. Fast travel stays off: nothing here
  offers the map, and there is no word that skips the driver.

  THE PANEL, NOT A COMMAND (#1635; Patrick, 4 Oct: no chat commands for
  what people do). E on a driver sends /ride e <id> from the front plugin.
  The server answers by publishing that driver's stops and fares on
  PANEL_PROPERTY, which game/ui/thornswood-ride.js draws, and each stop's
  Ride button sends /ride and the stop. Nobody is told to type either line,
  and no help names /ride. A refusal is said in the chat and drawn on the
  panel, which stays up. A ride that goes closes it.

  THE MOD'S OWN RIDE DOES NOT LAND, READ IN THE FORK. MovementValidation
  in skymp5-server refuses any move a client reports that changes the cell or
  the world, or covers 4096 units or more, and sends the person back to where
  the server had them. The carriage mod's fade moves the person on their own
  machine and nowhere else, so on this server its ride ends where it began.
  So the move is the server's: one locationalData set, the call /tp and
  arriving from creation make. That is the one position change the page asks
  for, and nothing moves anybody a second time on top of it.

  WHERE THE STOPS COME FROM. The driver at every stop is a placed person in
  game/data/npc-population.json with the role transport: the collection's own
  carriage and ferry workers, read out of the plugins by
  scripts/dev/Build-NpcPopulation.py. Each row below is one of those, with its
  reference, base, world, spot and hold copied across, and
  tests/test-1394-fares.js fails when the two drift apart. You land on the
  driver's own spot at the other end, the way MoveTo onto an actor lands.
  Which water a ferryman works is the mod's: KmodFerryRoute1 to 4 in
  cast.json, which the mod's own page calls the North Coast, Lake Honrich,
  Lake Ilinalta and Solstheim, and a ferryman there goes to any stop on his
  water. Gjalund Salt-Sage is Dragonborn's ship between Windhelm and Raven
  Rock, the Northern Maiden.

  THORS AND ROLF, READ IN THE PLUGIN (11 Oct). They were placed from the
  mod fix's description, so their factions were read out of CFTO.esp to
  check it. Thors (KmodCarriageDriverWinterhold, 1be45a) is in
  CrimeFactionWinterhold and in no ferry route, as every carriage driver is.
  Rolf (KmodFerrymanDragonBridge, 2d4c09) is in KmodFerryRoute1Faction, the
  North Coast, and CrimeFactionHaafingar. Both rows below already said so.

  THE STOPS NOBODY DRIVES FROM (11 Oct). The mod puts people down at
  villages, the Hearthfire homes, the Thalmor Embassy and the small ferry
  landings, where no driver stands. Each lands on the mod's own marker, read
  out of CFTO.esp: a carriage destination topic sets KmodCarriageDestination
  and lands on KmodCarriage<place>Marker, and a ferry topic's script names
  its DestinationMarker. The hold of a carriage stop is the mod's own: its
  topics group the villages under the hold whose driver lists them as near
  (KmodFastTravelCarriageReach and the rest), so a ride from that hold's
  carriage to one is the 10 for a stop in the same hold. The water of a
  ferry landing is the topic it sits under (KmodFastTravelFerryTopic to
  Topic04). Icewater Jetty is not here: the mod sends a ferry there only by a
  persuasion line to Castle Volkihar. Nobody rides from these stops, because
  no driver stands at them; a ride back starts at a driver.

  THE HOLD IS THE STOP'S, written on the row. It is never worked out from
  where the person came from, so Solitude's carriage is Solitude's whoever
  walks up to it, a ride that started at the embassy included: the embassy
  is not a hold and has no ledger (docs/systems/embassy.md).
*/
(function () {
  'use strict';
  var g = globalThis;
  function plog() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift('[carriages]');
    console.log(a.join(' '));
  }

  /*
    The fares, Patrick's answers on #1394 (4 Oct). A ferry is 10, Solstheim's
    own ferry between Raven Rock, Skaal Village and Tel Mithryn included. A
    carriage is 10 to a stop in the same hold and 20 to another hold. 40 is
    only the crossing between the mainland and Solstheim.
  */
  var FARE_FERRY = 10;
  var FARE_CARRIAGE_IN_HOLD = 10;
  var FARE_CARRIAGE = 20;
  var FARE_CROSSING = 40;
  /* Solstheim's world. A ride with one end in it and the other not is the crossing. */
  var SOLSTHEIM = '800:Dragonborn.esm';

  /* The same reach as a notice board. */
  var RIDE_REACH = 400;

  var RIDE_LINES = {
    carriage: { kind: 'carriage', what: 'the carriage' },
    coast: { kind: 'ferry', what: 'the North Coast ferry' },
    honrich: { kind: 'ferry', what: 'the Lake Honrich ferry' },
    ilinalta: { kind: 'ferry', what: 'the Lake Ilinalta ferry' },
    solstheim: { kind: 'ferry', what: 'the Solstheim ferry' },
    maiden: { kind: 'ferry', what: 'the Northern Maiden' }
  };

  var RIDE_STOPS = [
    // The carriage, one in every hold.
    { key: 'carriage:whiterun', line: 'carriage', name: 'Whiterun', hold: 'whiterun', driver: 'Bjorlam',
      ref: 'bbf6d:CFTO.esp', base: '6ae98:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [17527.8, -12395.6, -4753.2], rot: 108.9 },
    { key: 'carriage:solitude', line: 'carriage', name: 'Solitude', hold: 'solitude', driver: 'Thaer',
      ref: 'bbf76:CFTO.esp', base: '6ae97:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-73260.4, 99388.7, -10910], rot: 60 },
    { key: 'carriage:windhelm', line: 'carriage', name: 'Windhelm', hold: 'windhelm', driver: 'Alfarinn',
      ref: 'bbf6e:CFTO.esp', base: '6ae99:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [136396.2, 25084.2, -12805.3], rot: 199.6 },
    { key: 'carriage:riften', line: 'carriage', name: 'Riften', hold: 'riften', driver: 'Sigaar',
      ref: 'bbf7f:CFTO.esp', base: '6ae96:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [173633.8, -91556.8, 11131.7], rot: 319.9 },
    { key: 'carriage:markarth', line: 'carriage', name: 'Markarth', hold: 'markarth', driver: 'Kibell',
      ref: '9d8bf:CFTO.esp', base: '6ae95:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-169393.6, 4767.4, -4098.1], rot: 0 },
    { key: 'carriage:falkreath', line: 'carriage', name: 'Falkreath', hold: 'falkreath', driver: 'Tulinn',
      ref: 'bbf90:CFTO.esp', base: 'bbf8f:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-34633, -90053, -2987.1], rot: 177.6 },
    { key: 'carriage:morthal', line: 'carriage', name: 'Morthal', hold: 'morthal', driver: 'Wilhod',
      ref: 'bbf8e:CFTO.esp', base: 'bbf8c:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-39903.4, 71131.3, -13872], rot: 0 },
    { key: 'carriage:dawnstar', line: 'carriage', name: 'Dawnstar', hold: 'dawnstar', driver: 'Berud',
      ref: 'bbf91:CFTO.esp', base: 'bbf8d:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [26606.7, 100962.1, -13255.7], rot: 97.4 },
    { key: 'carriage:winterhold', line: 'carriage', name: 'Winterhold', hold: 'winterhold', driver: 'Thors',
      ref: '1c355d:CFTO.esp', base: '1be45a:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [110568, 99564.5, -9024], rot: 54.4 },
    // The North Coast ferry. Dragon Bridge is the fix's ferryman on the Karth.
    { key: 'coast:solitudelighthouse', line: 'coast', name: 'Solitude Lighthouse', hold: 'solitude', driver: 'Perius',
      ref: '14c5b:CFTO.esp', base: '14c5a:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-48717.7, 126815.7, -13954.9], rot: 165.2 },
    { key: 'coast:solitude', line: 'coast', name: 'Solitude', hold: 'solitude', driver: 'Jolf',
      ref: 'fb18:CFTO.esp', base: 'aa08:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-63395.9, 94449.8, -13886], rot: 63 },
    { key: 'coast:dragonbridge', line: 'coast', name: 'Dragon Bridge', hold: 'solitude', driver: 'Rolf',
      ref: '2d4c0a:CFTO.esp', base: '2d4c09:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-98560.9, 79317.5, -13937.9], rot: 319.9 },
    { key: 'coast:morthal', line: 'coast', name: 'Morthal', hold: 'morthal', driver: 'Radding',
      ref: 'aa0c:CFTO.esp', base: 'aa0b:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-36995.1, 65794.9, -13940.7], rot: 189.1 },
    { key: 'coast:dawnstar', line: 'coast', name: 'Dawnstar', hold: 'dawnstar', driver: 'Harlaug',
      ref: '14ca2:CFTO.esp', base: 'aa07:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [31548.2, 105974.5, -13913.5], rot: 308.4 },
    { key: 'coast:winterhold', line: 'coast', name: 'Winterhold', hold: 'winterhold', driver: 'Jollsen',
      ref: '153f0c:CFTO.esp', base: '158ffc:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [102132.8, 113494, -13955], rot: 149 },
    { key: 'coast:windhelm', line: 'coast', name: 'Windhelm', hold: 'windhelm', driver: 'Gort',
      ref: 'fb1b:CFTO.esp', base: 'aa09:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [140249.9, 34021.2, -13934.7], rot: 225 },
    // The Lake Honrich ferry.
    { key: 'honrich:riften', line: 'honrich', name: 'Riften', hold: 'riften', driver: 'Heirmir',
      ref: 'fb29:CFTO.esp', base: 'fb28:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [167248.5, -96459.3, 10688], rot: 270 },
    { key: 'honrich:heartwoodmill', line: 'honrich', name: 'Heartwood Mill', hold: 'riften', driver: 'Thalldar',
      ref: 'fb25:CFTO.esp', base: 'fb24:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [134591.4, -95769.6, 10668.8], rot: 90 },
    { key: 'honrich:ivarstead', line: 'honrich', name: 'Ivarstead', hold: 'riften', driver: 'Haennr',
      ref: '14c53:CFTO.esp', base: '14c52:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [77503.8, -68732.0, 10655.9], rot: 256.9 },
    // The Lake Ilinalta ferry.
    { key: 'ilinalta:brittleshinpass', line: 'ilinalta', name: 'Brittleshin Pass', hold: 'falkreath', driver: 'Rinlen',
      ref: '2e1e7:CFTO.esp', base: '2e1e6:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-19319.6, -54007.7, 637.1], rot: 137.5 },
    { key: 'ilinalta:guardianstones', line: 'ilinalta', name: 'Guardian Stones', hold: 'falkreath', driver: 'Bryst',
      ref: '332f6:CFTO.esp', base: '332f5:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [124.1, -60292.9, 608], rot: 143.2 },
    { key: 'ilinalta:halfmoonmill', line: 'ilinalta', name: 'Half-Moon Mill', hold: 'falkreath', driver: 'Hisygg',
      ref: '332ef:CFTO.esp', base: '332ed:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-40803.1, -57902.2, 814.6], rot: 97.4 },
    // The Solstheim ferry.
    { key: 'solstheim:ravenrock', line: 'solstheim', name: 'Raven Rock', hold: 'ravenrock', driver: 'Maslyn',
      ref: '14c6f:CFTO.esp', base: '14c6e:CFTO.esp', world: '800:Dragonborn.esm',
      pos: [28344.6, 34630.7, 306.5], rot: 122.2 },
    { key: 'solstheim:telmithryn', line: 'solstheim', name: 'Tel Mithryn', hold: 'ravenrock', driver: 'Bildul',
      ref: '14c79:CFTO.esp', base: '14c78:CFTO.esp', world: '800:Dragonborn.esm',
      pos: [72037.3, 20210.9, 305.7], rot: 182.4 },
    { key: 'solstheim:skaalvillage', line: 'solstheim', name: 'Skaal Village', hold: 'ravenrock', driver: 'Gauldis',
      ref: '14c6d:CFTO.esp', base: '14c6c:CFTO.esp', world: '800:Dragonborn.esm',
      pos: [79945.4, 70832.3, 308], rot: 91.7 },
    // The Northern Maiden, Gjalund Salt-Sage's ship.
    { key: 'maiden:windhelm', line: 'maiden', name: 'Windhelm', hold: 'windhelm', driver: 'Gjalund Salt-Sage',
      ref: '182af:Dragonborn.esm', base: '182ae:Dragonborn.esm', world: '3c:Skyrim.esm',
      pos: [141310, 34083.7, -13995.5], rot: 353.4 },
    { key: 'maiden:ravenrock', line: 'maiden', name: 'Raven Rock', hold: 'ravenrock', driver: 'Gjalund Salt-Sage',
      ref: '2582c:Dragonborn.esm', base: '2582b:Dragonborn.esm', world: '800:Dragonborn.esm',
      pos: [28928.7, 33144.2, 309.9], rot: 73.1 },
    // Where the carriage puts you down and nobody drives from (#1394).
    { key: 'carriage:darkwatercrossing', line: 'carriage', name: 'Darkwater Crossing', hold: 'windhelm',
      marker: 'b6e4b:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [120550.3, -34049.0, -9731.4], rot: 108.9 },
    { key: 'carriage:kynesgrove', line: 'carriage', name: 'Kynesgrove', hold: 'windhelm',
      marker: 'b6e4c:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [134183.8, 11545.6, -12425.2], rot: 91.7 },
    { key: 'carriage:mixwatermill', line: 'carriage', name: 'Mixwater Mill', hold: 'windhelm',
      marker: 'b6e4d:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [107035.5, -6730.4, -12931.2], rot: 51.6 },
    { key: 'carriage:karthwasten', line: 'carriage', name: 'Karthwasten', hold: 'markarth',
      marker: 'b6e50:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-130993.1, 39383.7, -6394.7], rot: 268.3 },
    { key: 'carriage:oldhroldan', line: 'carriage', name: 'Old Hroldan', hold: 'markarth',
      marker: 'b6e52:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-109633.1, -13019.9, -5908.6], rot: 308.4 },
    { key: 'carriage:soljundssinkhole', line: 'carriage', name: "Soljund's Sinkhole", hold: 'markarth',
      marker: 'b6e51:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-115870.9, 5902.0, -5229.6], rot: 308.4 },
    { key: 'carriage:dragonbridge', line: 'carriage', name: 'Dragon Bridge', hold: 'solitude',
      marker: 'b6e53:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-100960.0, 81165.4, -12555.3], rot: 337.1 },
    { key: 'carriage:thalmorembassy', line: 'carriage', name: 'Thalmor Embassy', hold: 'solitude',
      marker: 'b6e54:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-78863.2, 110918.8, -2576.0], rot: 337.1 },
    { key: 'carriage:rorikstead', line: 'carriage', name: 'Rorikstead', hold: 'whiterun',
      marker: 'b6e55:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-82477.9, 5177.2, -4608.1], rot: 314.2 },
    { key: 'carriage:riverwood', line: 'carriage', name: 'Riverwood', hold: 'whiterun',
      marker: 'b6e4e:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [23877.3, -42735.3, -25.0], rot: 212.0 },
    { key: 'carriage:ivarstead', line: 'carriage', name: 'Ivarstead', hold: 'riften',
      marker: 'b6e56:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [75864.0, -60417.1, 10514.4], rot: 180.0 },
    { key: 'carriage:shorsstone', line: 'carriage', name: "Shor's Stone", hold: 'riften',
      marker: 'b6e57:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [163069.5, -62681.1, 7520.0], rot: 22.9 },
    { key: 'carriage:heartwoodmill', line: 'carriage', name: 'Heartwood Mill', hold: 'riften',
      marker: 'b6e58:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [130433.1, -95544.9, 10899.3], rot: 67.8 },
    { key: 'carriage:nightgateinn', line: 'carriage', name: 'Nightgate Inn', hold: 'dawnstar',
      marker: 'b6e59:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [72671.6, 49446.2, -6221.8], rot: 149.0 },
    { key: 'carriage:heljarchenhall', line: 'carriage', name: 'Heljarchen Hall', hold: 'dawnstar',
      marker: 'cb328:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [31136.9, 36138.5, -6951.1], rot: 0.0 },
    { key: 'carriage:stonehills', line: 'carriage', name: 'Stonehills', hold: 'morthal',
      marker: 'b6e5a:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-8570.0, 64733.7, -11604.0], rot: 114.6 },
    { key: 'carriage:windstadmanor', line: 'carriage', name: 'Windstad Manor', hold: 'morthal',
      marker: 'cb327:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-25235.4, 97694.7, -13407.7], rot: 34.4 },
    { key: 'carriage:halfmoonmill', line: 'carriage', name: 'Half-Moon Mill', hold: 'falkreath',
      marker: 'b6e4f:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-42393.2, -60582.3, 877.0], rot: 314.2 },
    { key: 'carriage:lakeviewmanor', line: 'carriage', name: 'Lakeview Manor', hold: 'falkreath',
      marker: 'cb326:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-9304.6, -71435.0, 2435.8], rot: 348.0 },
    // Where a ferry puts you down and nobody drives from (#1394).
    { key: 'coast:windstadmanor', line: 'coast', name: 'Windstad Manor', hold: 'morthal',
      marker: '14c86:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-28018.0, 101617.9, -13969.5], rot: 193.8 },
    { key: 'coast:frostflowlighthouse', line: 'coast', name: 'Frostflow Lighthouse', hold: 'winterhold',
      marker: '38411:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [56529.5, 102638.0, -13949.2], rot: 159.5 },
    { key: 'honrich:honeyside', line: 'honrich', name: 'Honeyside', hold: 'riften',
      marker: '14c8e:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [171196.3, -93246.3, 10688.0], rot: 97.4 },
    { key: 'ilinalta:lakeviewmanor', line: 'ilinalta', name: 'Lakeview Manor', hold: 'falkreath',
      marker: '14c7e:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-11349.3, -62756.7, 633.4], rot: 154.7 },
    { key: 'ilinalta:ilinaltasdeep', line: 'ilinalta', name: "Ilinalta's Deep", hold: 'falkreath',
      marker: '3840e:CFTO.esp', world: '3c:Skyrim.esm',
      pos: [-31504.5, -48740.8, 662.0], rot: 68.8 },
    { key: 'solstheim:bujoldsretreat', line: 'solstheim', name: "Bujold's Retreat", hold: 'ravenrock',
      marker: '3840d:CFTO.esp', world: '800:Dragonborn.esm',
      pos: [82535.0, 59126.0, 292.4], rot: 274.1 },
    { key: 'solstheim:northshorelanding', line: 'solstheim', name: 'Northshore Landing', hold: 'ravenrock',
      marker: '3840c:CFTO.esp', world: '800:Dragonborn.esm',
      pos: [21277.0, 91639.9, 305.2], rot: 114.6 }
  ];

  var HOLD_NAMES = {
    whiterun: 'Whiterun', solitude: 'Solitude', riften: 'Riften', markarth: 'Markarth',
    windhelm: 'Windhelm', falkreath: 'Falkreath', morthal: 'Morthal', dawnstar: 'Dawnstar',
    winterhold: 'Winterhold', ravenrock: 'Raven Rock'
  };

  function stopByKey(key) {
    for (var i = 0; i < RIDE_STOPS.length; i++) {
      if (RIDE_STOPS[i].key === key) { return RIDE_STOPS[i]; }
    }
    return null;
  }

  function stopByBase(base) {
    var want = String(base || '').toLowerCase();
    if (!want) { return null; }
    for (var i = 0; i < RIDE_STOPS.length; i++) {
      if (RIDE_STOPS[i].base && RIDE_STOPS[i].base.toLowerCase() === want) { return RIDE_STOPS[i]; }
    }
    return null;
  }

  /** The gold for a ride, or 0 when the list has no such ride. */
  function fare(from, to) {
    if (!from || !to || from === to || from.line !== to.line) { return 0; }
    // Nobody drives from a stop with no driver standing at it.
    if (!from.driver) { return 0; }
    var line = Object.prototype.hasOwnProperty.call(RIDE_LINES, from.line) ? RIDE_LINES[from.line] : null;
    if (!line) { return 0; }
    if ((from.world === SOLSTHEIM) !== (to.world === SOLSTHEIM)) { return FARE_CROSSING; }
    if (line.kind === 'ferry') { return FARE_FERRY; }
    return from.hold === to.hold ? FARE_CARRIAGE_IN_HOLD : FARE_CARRIAGE;
  }

  /** Every stop this one's driver goes to. */
  function destinations(from) {
    var out = [];
    for (var i = 0; i < RIDE_STOPS.length; i++) {
      if (fare(from, RIDE_STOPS[i]) > 0) { out.push(RIDE_STOPS[i]); }
    }
    return out;
  }

  /** Where something is: its cell or world and its point, or null. */
  function placeOf(id) {
    var cell = null, pos = null;
    try { cell = mp.get(id, 'worldOrCellDesc'); } catch (e) { return null; }
    try { pos = mp.get(id, 'pos'); } catch (e) { return null; }
    if (typeof cell !== 'string' || !cell || !pos || pos.length !== 3) { return null; }
    var p = [Number(pos[0]), Number(pos[1]), Number(pos[2])];
    if (!p.every(Number.isFinite)) { return null; }
    return { cell: cell, pos: p };
  }

  function apart(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /*
    Somebody pressed E on a driver, and the front plugin said which one.
    Believed only as far as the server can check it: the actor has to be one
    of the drivers on the list, by its base, and the person has to be within
    reach of where that actor is now. Null when it is not a driver at all.

    A press lasts for as long as that driver is within reach. The panel it
    opens stays up that long (the front plugin closes it when you walk off),
    so its Ride has to mean him for as long, even for a driver who has
    wandered off his spot. Out of his reach, or with him gone, it is
    forgotten.
  */
  var pressedBy = {};

  function pressDriver(actorId, driverId) {
    var base = '';
    try { base = String(mp.get(driverId, 'baseDesc') || ''); } catch (e) { base = ''; }
    var stop = stopByBase(base);
    if (!stop) { return null; }
    var me = placeOf(actorId), them = placeOf(driverId);
    if (!me || !them || me.cell !== them.cell || apart(me.pos, them.pos) > RIDE_REACH) {
      return { stop: stop, far: true };
    }
    pressedBy[actorId] = { stop: stop.key, driver: driverId, at: Date.now() };
    return { stop: stop, far: false };
  }

  /** The stop this person is standing at, or null. */
  function stopHere(actorId) {
    var me = placeOf(actorId);
    if (!me) { return null; }
    var p = Object.prototype.hasOwnProperty.call(pressedBy, actorId) ? pressedBy[actorId] : null;
    if (p) {
      var s = stopByKey(p.stop);
      var them = placeOf(p.driver);
      var base = '';
      try { base = String(mp.get(p.driver, 'baseDesc') || ''); } catch (e) { base = ''; }
      if (s && them && stopByBase(base) === s && them.cell === me.cell &&
          apart(me.pos, them.pos) <= RIDE_REACH) {
        return s;
      }
      delete pressedBy[actorId];
    }
    /*
      Otherwise the driver himself, or his spot. The population block keeps a
      kept driver on his own placed reference, so the server can read where he
      stands now; a driver it cannot read is measured from his spot.
    */
    var best = null, bestD = RIDE_REACH;
    for (var i = 0; i < RIDE_STOPS.length; i++) {
      var stop = RIDE_STOPS[i];
      if (!stop.driver || stop.world !== me.cell) { continue; }
      var d = apart(me.pos, stop.pos);
      var live = driverNow(stop);
      if (live && live.cell === me.cell) { d = Math.min(d, apart(me.pos, live.pos)); }
      if (d <= bestD) { bestD = d; best = stop; }
    }
    return best;
  }

  function driverNow(stop) {
    var id = 0;
    try { id = Number(mp.getIdFromDesc(stop.ref)) || 0; } catch (e) { id = 0; }
    return id > 0 ? placeOf(id) : null;
  }

  function simple(text) {
    return String(text || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  /* The stop they named, out of the ones this driver goes to: the whole name,
     or the start of exactly one. */
  function pick(list, wanted) {
    var w = simple(wanted);
    if (!w) { return null; }
    var i;
    for (i = 0; i < list.length; i++) {
      if (simple(list[i].name) === w) { return list[i]; }
    }
    var hits = [];
    for (i = 0; i < list.length; i++) {
      if (simple(list[i].name).indexOf(w) === 0) { hits.push(list[i]); }
    }
    return hits.length === 1 ? hits[0] : null;
  }

  /*
    THE PANEL'S VIEW, seen by its owner only, the way the repair and the
    merchant panels' are. The owner's script hands it to the page, and
    game/ui/thornswood-ride.js draws it. A view with open set asks for the
    panel (the front plugin opens it once the mod's own conversation has
    closed), and open false closes it. at moves on every send, so a second
    press draws it again even when nothing in it changed.
  */
  var PANEL_PROPERTY = 'thornswoodRideView';
  var panelScript = [
    '(function(){',
    '  try {',
    '    var v = ctx.value;',
    '    if (!v || typeof v !== "object") { return; }',
    '    var st = ctx.state;',
    '    if (!st) { return; }',
    '    if (st.thornswoodRideAt === v.at) { return; }',
    '    st.thornswoodRideAt = v.at;',
    '    var body = JSON.stringify(v);',
    '    var src = "(function(){try{" +',
    '      "var d=" + body + ";window.thornswoodRideView=d;" +',
    '      "if(window.thornswoodRide&&window.thornswoodRide.setData){window.thornswoodRide.setData(d);}" +',
    '      "}catch(e){}})();";',
    '    try { ctx.sp.browser.executeJavaScript(src); } catch (e) { }',
    '  } catch (e) { }',
    '})();'
  ].join('\n');
  try {
    mp.makeProperty(PANEL_PROPERTY, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: panelScript, updateNeighbor: ''
    });
  } catch (e) { /* made by an earlier load. harmless. */ }

  /** What the panel shows at this stop: the driver, his stops and their fares. */
  function panelView(from, note) {
    var list = destinations(from);
    var stops = [];
    for (var i = 0; i < list.length; i++) { stops.push({ name: list[i].name, fare: fare(from, list[i]) }); }
    return {
      open: true, driver: from.driver, what: RIDE_LINES[from.line].what, from: from.name,
      ledger: HOLD_NAMES[from.hold] || from.hold, stops: stops, note: note || ''
    };
  }

  var shownAt = 0;
  function show(actorId, view) {
    var payload = JSON.parse(JSON.stringify(view));
    shownAt = Math.max(Date.now(), shownAt + 1);
    payload.at = shownAt;
    try { mp.set(actorId, PANEL_PROPERTY, payload); } catch (e) {
      plog('could not send the ride panel to', Number(actorId).toString(16) + ':', e);
    }
  }

  /* Whether the pack can pay, by the same test takeGold makes: one stack of
     coin with the whole fare in it. Read only. */
  function canPay(actorId, amount) {
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { return false; }
    var entries = (inv && inv.entries) || [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e && e.baseId === 0x0000000F && (Number(e.count) || 0) >= amount) { return true; }
    }
    return false;
  }

  function moveTo(actorId, stop) {
    mp.set(actorId, 'locationalData', {
      cellOrWorldDesc: stop.world,
      pos: [stop.pos[0], stop.pos[1], stop.pos[2]],
      rot: [0, 0, stop.rot]
    });
  }

  function answer(line, from, went) {
    return { line: line, from: from, went: !!went };
  }

  /** A ride, and the move when it goes: the line to say back, the stop it was asked at, and whether it went. */
  function ride(actorId, profileId, wanted) {
    var from = stopHere(actorId);
    if (!from) { return answer('Walk up to a carriage or ferry driver first.', null); }
    if (!wanted) { return answer('', from); }
    var to = pick(destinations(from), wanted);
    if (!to) { return answer('No ride to ' + wanted + ' from here.', from); }
    var price = fare(from, to);
    // Never 0 or less: destinations() offers only rides with a fare, and an
    // amount below 1 would make takeGold add rather than take.
    if (!(price > 0)) { return answer('No ride to ' + wanted + ' from here.', from); }
    var prop = g.__thornswoodProperty;
    if (!prop || typeof prop.takeGold !== 'function' || typeof prop.boxFare !== 'function') {
      plog('a ride was asked for and the hold ledger is not loaded');
      return answer('The hold\'s ledger is not running on this server, so nobody rides. Say so in the dev channel.', from);
    }
    // A pack that is short keeps all of it and stays where it is.
    if (!canPay(actorId, price)) {
      return answer('The ride to ' + to.name + ' is ' + price + ' gold and you do not have it. Nothing was taken.', from);
    }
    /*
      THE MOVE, THEN THE FARE, so a move the server could not make costs
      nothing and no coin ever has to go back into a pack. The pack was read a
      line ago and nothing between here and there touches it, so takeGold
      finds what canPay found. If writing the pack fails all the same, there
      is no fare and so no ride: they go back to the stop they left.
    */
    try {
      moveTo(actorId, to);
    } catch (e) {
      plog('profile', profileId, 'could not be moved from', from.key, 'to', to.key + ':', e);
      return answer('The ride did not go, and nothing was taken. Say so in the dev channel.', from);
    }
    if (!prop.takeGold(actorId, price)) {
      try { moveTo(actorId, from); } catch (e2) { }
      plog('profile', profileId, 'rode from', from.key, 'to', to.key,
           'and the fare could not be taken, so they were put back');
      return answer('The fare could not be taken, so the ride did not go. Nothing was taken.', from);
    }
    delete pressedBy[actorId];
    var what = RIDE_LINES[from.line].what;
    if (!prop.boxFare(from.hold, price, from.name + ' to ' + to.name + ' by ' + what +
                      ', profile ' + profileId)) {
      plog('profile', profileId, 'paid', price, 'at', from.key, 'and', from.hold, 'has no drop box for it');
    }
    plog('profile', profileId, 'rode', what, 'from', from.name, 'to', to.name, 'for', price,
         'gold, into', from.hold + '\'s drop box');
    return answer('You pay the ' + price + ' gold fare and ride to ' + to.name + '.', from, true);
  }

  /*
    /ride e <id>          the front plugin, when somebody presses E on a
                          driver: his panel opens
    /ride <stop>          the panel's Ride button: pay and go
    /ride                 the panel of the driver you are at
    Nobody is told to type any of them (#1635).
  */
  function command(parts, actorId, profileId, toProfile) {
    if (!actorId) {
      toProfile(profileId, 'You are not in the world yet.');
      return true;
    }
    var first = String((parts && parts[1]) || '').toLowerCase();
    if (first === 'e' && parts.length === 3 && /^[0-9a-f]+$/i.test(String(parts[2]))) {
      var pressed = pressDriver(actorId, parseInt(parts[2], 16) >>> 0);
      // Not a driver: the press was for something else, so nothing to say.
      if (!pressed) { return true; }
      if (pressed.far) {
        toProfile(profileId, 'Walk up to ' + pressed.stop.driver + ' first.');
        return true;
      }
      show(actorId, panelView(pressed.stop, ''));
      return true;
    }
    var done = ride(actorId, profileId, (parts || []).slice(1).join(' ').trim());
    if (done.line) { toProfile(profileId, done.line); }
    // A ride that went, or no driver here, closes the panel. A refusal is
    // drawn on it, and it stays up.
    show(actorId, done.went || !done.from ? { open: false } : panelView(done.from, done.line));
    return true;
  }

  g.__thornswoodCarriages = {
    STOPS: RIDE_STOPS, LINES: RIDE_LINES, REACH: RIDE_REACH, SOLSTHEIM: SOLSTHEIM,
    FARE_FERRY: FARE_FERRY, FARE_CARRIAGE_IN_HOLD: FARE_CARRIAGE_IN_HOLD, FARE_CARRIAGE: FARE_CARRIAGE,
    FARE_CROSSING: FARE_CROSSING, PANEL_PROPERTY: PANEL_PROPERTY,
    stopByKey: stopByKey, stopByBase: stopByBase, fare: fare, destinations: destinations,
    stopHere: stopHere, pressDriver: pressDriver, panelView: panelView, ride: ride, command: command
  };
  plog('ready,', RIDE_STOPS.length, 'stops on', Object.keys(RIDE_LINES).length, 'lines');
})();
// ==== end thornswood carriages ====

