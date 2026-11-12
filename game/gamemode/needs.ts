// ==== thornswood needs: hunger, thirst and exhaustion ====
/*
  ============================================================================
  HUNGER, THIRST AND EXHAUSTION, AND THE NUMBERS ARE INVENTED ON PURPOSE.

  Blade Da Razor, 22 September, in the Proffesions/Classes forum, "a mix of
  mine and patrick's pitch for the system":

    Hunger   standard, different foods replenish different amounts, the meter
             deteriorates over time, and low hunger gives negative effects to
             movement, attacks, mana and blocking.
    Thirst   standard but depletes twice as fast. Ale fills it faster and has
             negative effects. Low thirst hits mana and movement.
    Exhaust  "standard, takes hours to completely deplete... it would be over 3
             times larger than the hunger meter. (3 meals get it? Lol)". Rest
             by sitting, at a campfire, or at an inn, which is faster; lying in
             a bed at an inn or your home WHEN YOU LOG OUT gives a bonus when
             you come back. Low exhaustion has negative effects to everything
             including your ability to craft. Working your skilled profession
             drains it faster, and a higher rank drains it slower.

  Grim Reefer added the bard, and Patrick said yes to it: somebody playing
  music in an inn makes everyone there recover faster. "It would encourage
  people to hang out at taverns." Patrick: "I like that Idea too!"

  Patrick, 22 September: "I want for the exhaustion to be able to actually
  sleep in beds and stuff", and then, asked for the balance: "you csn invent
  the balance and we an go form there".

  SO EVERY NUMBER BELOW IS MINE AND NONE OF IT IS MEASURED. That is the point
  of this block existing before it is right: there is nothing to argue with
  until there is something to play. They are gathered in NEEDS so one table is
  the whole of the balance, and moving a number here is the whole of a change.

  WHAT IS DELIBERATELY NOT HERE. No death, no collapse, no forced sleep.
  Nothing in this block can kill anybody or take a turn away from them, and an
  empty meter is a person who is worse at things rather than a person who
  stops playing. A roleplay server people leave running while they talk is the
  wrong place for a meter that punishes being idle, and this is the first
  version of something nobody has felt yet.
  ============================================================================
*/
(function () {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;

  function nlog() {
    var a = ['[thornswood needs]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    try { console.log(a.join(' ')); } catch (e) { }
  }

  var NEEDS_PROPERTY = 'thornswoodNeeds';

  /*
    THE WHOLE OF THE BALANCE, IN ONE TABLE.

    Meters run 0 to 100 and 100 is full. Everything is per REAL hour, because
    a person's session is real time and Skyrim's clock runs twenty times
    faster: a meter on game time would empty while somebody read a sign.

    THE THREE RATES ARE BLADE'S SHAPE. Food empties in six hours, drink in
    three because it goes twice as fast, and rest in twenty, which is over
    three times the food meter as he asked. Six hours is longer than most
    sessions on purpose: the first version should be felt at the end of a long
    evening, not at the end of an hour.
  */
  var NEEDS = {
    // Per real hour, out of 100.
    /*
      TWO AND A HALF TIMES FASTER, asked for by name.

      Patrick, 23 September, after playing with them: "I think the food,
      water, and rest go down wayyyyy to slowly like it needs to go down 2.5x
      this speed".

      The old shape was food in six hours, drink in three, rest in twenty,
      chosen so the first version would be felt at the end of a long evening
      rather than the end of an hour. An evening is not how anybody plays
      this: a session is two hours and nothing ever moved far enough to
      matter. So food empties in two hours and twenty four minutes, drink in
      an hour and twelve, and rest in eight hours, which is a meter that is
      still about sleeping rather than about eating.

      The proportions are Blade's and are untouched: drink goes twice as fast
      as food, and rest is over three times food.
    */
    drain: { food: 2.5 * 100 / 6, drink: 2.5 * 100 / 3, rest: 2.5 * 100 / 20 },

    /*
      TEMPERATURE, AND IT IS THE ONE METER THAT IS NOT A CLOCK.

      Patrick, 22 September: "I forgot to say temp for cold/heat stuff for
      like snow and rain and swimming and fire and stuff."

      The other three only ever fall. This one moves BOTH WAYS toward whatever
      the place you are standing in is worth, so a meter at 50 is comfortable,
      0 is freezing and 100 is overheating. Standing by a fire in a blizzard
      should settle somewhere reasonable rather than one of them winning, and
      a target plus a rate is the shape that does that on its own.

      settleMinutes is a HALF LIFE, not a rate, and it used to be a rate. It
      said 60 "per real hour" and was fed into a power of a half, which is not
      what a rate means: the arithmetic came out at about half a point a
      minute, so walking into the Bannered Mare and standing in the fire would
      have taken the better part of an hour to read as warm. Patrick's five
      screenshots all say Fine 50 and the reason is mostly that nothing was
      reporting a place, but this would have been the next thing wrong.

      A half life says what it does: three minutes to get halfway to wherever
      you are standing, nine to be most of the way there. Long enough that
      crossing a bridge in the rain is not a meter event, short enough that
      going indoors out of a blizzard is felt while you are still taking your
      boots off.

      THE PLACES ARE WORTH WHAT PATRICK NAMED. Snow and swimming pull down,
      fire pulls up, rain is milder than snow, and indoors is simply
      comfortable. Everything unnamed is comfortable too, because a world
      where every unclassified cell is dangerous is a world that punishes
      walking into a room nobody has thought about yet.
    */
    comfort: 50,
    /*
      HOW FAST THE METER GOES WHERE IT IS GOING, AND IT IS TWO NUMBERS.

      Patrick, 23 September, standing in the Bannered Mare's fire pit with
      the client finally reporting it: "Fire is still not changing temp but I
      do catch on fire now and take damage". The client was right, the server
      was right, and the meter was moving: at one half life of three minutes,
      standing in a fire whose target is 84 took a 51 to 52.2 in ten seconds
      and 54.6 in thirty. Nobody stands in a fire for three minutes to find
      out whether a number is broken, and while they are walking about it
      never gets anywhere near the target at all.

      So warming is fast and cooling is not, which is also how it works: a
      fire warms you in seconds and a cold night takes you slowly. Thirty
      seconds to close half the gap toward warm puts a fire at 66 in ten
      seconds from 51, which is legible while you stand there; ninety seconds
      the other way means stepping back from it cools you visibly without the
      snow becoming an emergency the moment you walk into it.

      These are the only two numbers that decide whether any of this can be
      felt, so they are here and named rather than folded into one.
    */
    settleMinutes: 1.5,        // cooling toward a colder place
    settleWarmMinutes: 0.5,    // warming toward a warmer one
    place: {
      // Kept for a client from before the fire became a distance, and for
      // nothing else. See NEEDS.fire.
      fire: 92,
      indoors: 58,     // a roof, which is most of the game
      outdoors: 40,    // under the sky with nothing falling on you
      rain: 34,        // wet and cold, but not dangerous on its own
      snow: 16,        // the reach, the pale, Winterhold, a blizzard
      water: 8,        // swimming, which is the fastest way to get cold
      shallow: 26      // wading: wet to the knees and able to walk out
    },

    /*
      WHAT KIND OF WATER, on top of being in it.

      Patrick, 23 September: "there should be different temperatures for
      different water types like ice, galciers, fresh water, shallow, etc".

      tools\waters.json reads the WATR record every cell and worldspace points
      at and sorts them into classes. This is what each class is worth, as
      degrees on or off the water place itself, so a class only ever matters
      to somebody who is actually in the water.

      THERE IS NO ICE WATER IN TAMRIEL and that is worth saying rather than
      faking: Bethesda named five records for cold water and all of them are
      Dawnguard's Frostreach. The sea off Dawnstar is the same DefaultWater as
      the sea off Riften. So the rest of a freezing swim comes from the
      weather, the hour and the height, which the exposure half already
      measures and which already apply to anybody in the water.

      SHALLOW IS THE PLACE, not the class: wading is its own word from the
      client, because how deep you are in it is the thing you can do something
      about.
    */
    water: {
      lava: 90,        // not water. Standing in it is standing in a forge.
      still: 10,       // an indoor pool, out of the wind
      marsh: 6,        // standing, shallow, sun warmed
      puddle: 12,      // barely water
      river: -5,       // moving, and moving water takes heat faster
      ice: -8,         // Frostreach, and the few records named for it
      deep: 0          // the sea and most lakes, which is the default
    },

    /*
      A FIRE IS A DISTANCE, NOT A PLACE.

      Patrick, 23 September: "temperature should be relative too so like if I
      am further away or closer to a fire it slowly rises and lowers as I walk
      away from the fire".

      The first version made fire one of the words the client could report and
      it beat everything else, so a campfire in a blizzard was worth exactly
      the same as the hearth in the Bannered Mare and stepping one pace back
      from either of them turned it off like a switch.

      So the client reports HOW FAR, and this is what it is worth at nothing
      and what it is worth at reach:

        at     added to the target when you are standing in it
        reach  where it has faded to nothing, in game units, and it has to be
               the same number the client scans with or half of the curve is
               off the end of it

      Added ON TOP of wherever you already are, which is what makes it read
      the way he described: indoors at a hearth is 58 and 34 more, a campfire
      in the open is 40 and 34, the same campfire in a blizzard is 16 and 34,
      and every one of them slides down to the place's own number as you walk
      away.
    */
    /*
      master is a Master Carver's fire or kiln (#1398):
      docs/systems/professions/woodworker.md, "the hottest the warmth rules
      allow: +48 at your feet, and still 0 at 300". See carverFire().
    */
    fire: { at: 34, master: 48, reach: 300 },

    /*
      AND IT SPREADS.

      Patrick, 23 September: "when people catch fire it should be able to
      spread to other people if they ade close enough".

      The client tells the server it is burning, the server looks for anybody
      standing close enough in the same cell, and their client catches. That
      is the only way round it works: the server cannot see a fire and the
      client cannot see where everybody else is standing, so each one does the
      half it can.

        spread   how close, in game units. About two paces, which is close
                 enough to be a choice rather than an ambush.
        catches  how long somebody burns for after catching it, before it goes
                 out on its own. Refreshed while they are still next to
                 whoever set them alight, so standing there is worse.
        every    how often the server looks. Two seconds, because a fire that
                 takes twenty to notice is not a fire.

      IT CANNOT RUN AWAY WITH ITSELF. Somebody who catches it becomes a source
      in their own right, which is what "spread" means, but the burn is on a
      clock and the radius is small, so a crowd standing shoulder to shoulder
      in a bonfire is the worst it gets and that is a decision they made.
    */
    burn: { spread: 220, catches: 5000, every: 2000 },

    /*
      WHAT YOU ARE WEARING, AND IT IS THE SECOND HALF OF THE ANSWER.

      Patrick, 23 September: "also clothing should affect temperature depening
      on what clothes and if you are weaing them no clothes should equal colder
      some clothes/armor should be hotter than others etc".

      tools\warmth.json says what every wearable in the load order is made of
      and what it covers, read off the ARMO records. This says what that is
      WORTH, which is balance and belongs here with the rest of it.

      EVERY PIECE COUNTS ON ITS OWN. Patrick, 23 September: "different types of
      clothes and wether one is on and others are like a hat, helmet, scarf,
      cape, shirt, pants, boots, gloves, etc are all counted individually and
      not grouped". So perPart has a line for every biped slot that comes
      between weather and skin, including the ones only the mods use: the
      cloak slot, the scarf slot and both hood slots. The names are the ones
      Build-WarmthTable.js writes into the table and the two have to agree.

      perPart is how much of a person each piece of kit is. A fully dressed
      person adds up to about one, so the fractions are what each piece is
      worth against being naked: a shirt is a quarter of the answer, boots are
      a fourteenth, and going barefoot in the snow costs exactly that much.

      material is how well it keeps weather out. Fur is the best thing in the
      game and metal is the worst, which is both true and the reason anybody in
      the Pale is dressed like that. An armour with no material keyword lands
      on cloth, the middle, so an unclassified mod piece is neither a blessing
      nor a punishment.

      AND IT CUTS BOTH WAYS, which is the part that makes it a choice rather
      than a number to maximise. Warm clothes pull a cold place back toward
      comfortable. In a HOT place they push it further the other way: full
      plate at a forge is worse than a shirt, and `heat` is how much worse.
    */
    wear: {
      perPart: { body: 0.26, pelvis: 0.09, legs: 0.04, head: 0.10, hair: 0.03,
                 circlet: 0.01, ears: 0.01, neck: 0.04, back: 0.10,
                 chest: 0.05, shoulder: 0.03, arms: 0.04, hands: 0.05,
                 calves: 0.05, feet: 0.07 },
      material: { fur: 1.0, leather: 0.75, light: 0.55, cloth: 0.5,
                  heavy: 0.45, none: 0 },
      most: 0.8,
      heat: 0.5,
      /*
        A Master Weaver's garment (#1398): "ignores 4 degrees of exposure on
        top of the table", docs/systems/temperature.md. mark is what the craft
        writes in front of its name, which is how a worn one is known. See
        weathered().
      */
      woven: { degrees: 4, mark: 'Master-Woven ' }
    },

    /*
      THE REST OF THE WEATHER AND THE REST OF THE PLACE.

      Patrick, 23 September: "the temp should also account for wind and all
      other weather reelated and environment factors".

      Degrees on or off whatever the place is already worth, and every one of
      them stops at a roof. See exposure() for what each is read from; these
      are what each is worth, which is the invented half.

      The wind is the big one on purpose. Standing still in the open in a
      blizzard should be the worst thing in the game that is not swimming, and
      fourteen off a snow target of 16 is two, which is as cold as this system
      goes.
    */
    weather: {
      wind: 14,        // the full gale, scaled down by how hard it is blowing
      snow: 6,         // snow falling on you, on top of the place
      rain: 4,
      cloud: 1,
      sun: 4,          // a clear day with no roof over you, and not at night
      night: 6,
      highFrom: 6000,  // the tundra is about zero, Ivarstead about 3,000
      highPer1000: 1.2,
      highMost: 14,    // the Throat of the World, and then no worse
      /*
        A BLIZZARD OR A HEAVY STORM SLOWS TRAVEL (#3176). Patrick, 22 Oct, on
        his report page, B: "15% slower in a blizzard or heavy storm", recorded
        in docs/DECIDED.md as "A blizzard or heavy storm makes travel 15%
        slower and adds cold or wet; the right gear protects."

        SpeedMult is 100 on everybody, so 15 off it is 15 per cent of a
        walk. A storm is the s mark Build-WeatherTable.js puts on a rainy or
        snowy weather that its record names a storm. It stops at a roof, the
        same as every other line here. The cold and the wet are what the snow,
        rain and wind lines above already cost, and clothing is what pulls
        those back toward comfort; the slowdown is the storm itself, which no
        coat takes away.
      */
      storm: 15
    },

    /*
      WORKING COSTS REST, AND IT IS A COST PER SWING RATHER THAN A RATE.

      Blade: "When doing your skilled profession, it drains your Exhaustion
      faster. As you level up your skill it doesn't drain your exhaustion
      meter as fast."

      That was a multiplier on the drain for two minutes after each piece of
      work, and Patrick found what it is worth: "I didn't get anymore tired
      while mining or smithing". He is right, and the arithmetic says why.
      Rest drains 12.5 a real hour. Doubled for a novice, for two minutes,
      that is four tenths of one point for a whole spell of mining. It was
      working perfectly and nobody was ever going to feel it.

      So the work itself costs, on the swing, and the rank is what it costs
      rather than how fast the clock runs. A novice loses a point and a half
      a swing, which is twenty swings for a third of the meter and is a
      morning's work; a master loses half of that, which is the whole of what
      Blade asked for.

      THE MULTIPLIER IS GONE, not kept beside this. Two things charging for
      the same swing is how a number ends up twice what anybody meant, and
      the rate version is the one nobody could feel.
    */
    work: { novice: 1.5, advanced: 1.2, expert: 0.9, master: 0.6 },
    workRest: { novice: 1.0, advanced: 1.0, expert: 1.0, master: 1.0 },
    workFor: 120000,   // how long one swing counts as still working

    /*
      Recovery, per real hour, by where somebody is resting.

      Patrick's ladder on #1603, "use some common sense": a bed is better than
      a campfire, a bed or bedroll nobody lends you is a little better than
      sitting, a campfire with a bedroll is better than a campfire alone, and
      so on up to your own bed. So: a seat 20, a bed or bedroll nobody can lend
      you 25 (rough), a seat with a fire in reach 35 (campfire), rough with a
      fire in reach 45 (camp), a bed you are allowed in 50 (inn: a guest, or a
      key or deed carried), your own bed 80. The bard is added on top of
      whatever the place already gives.

      Which kind somebody gets is the beds' answer in the property block, by
      what the server saw them press, never the word after /rest (#1392, #1607).

      AN INN OR A TEMPLE NOBODY HOLDS IS ITS OWN KIND (#2246): common, and
      commonfire with a fire in reach (restPlaceOf in the property block).
      Djinn's ask on #2246 is that resting at an inn or a temple gives back
      more than the wild. Patrick, 12 Oct 2026, on #2246: 40 an hour, and 45
      by a fire, the road's own number by a fire. Better than a bedroll on
      the road (25), still under a bed you are allowed in (50) and your own
      (80), so the #1603 ladder holds.
    */
    recover: { sit: 20, rough: 25, campfire: 35, camp: 45, inn: 50, bed: 80,
               common: 40, commonfire: 45 },
    bard: 25,

    /*
      WHAT THE TIME AWAY DOES, BY WHERE SOMEBODY LOGGED OUT (#1606, #2246).

      One row for each kind of rest they were in when they left, and up for
      somebody who left on their feet. Each row is four things:

        drain  the share of the ordinary clock the whole time away costs
               hunger, thirst and rest. 1 is all of it, the same as being
               awake in the world; 0 would be nothing at all.
        floor  the time away takes no meter below this. A meter already
               under it is left where it was. 0 is no floor.
        rest   after a night away, rest is at least this. 0 gives nothing.
        food, drink  after a night away, added to hunger and to thirst, on
               what the time away left.

      Logging out in a bed was Blade's: "laying down in a bed in an inn or
      your home when you log out will give you bonuses when you come back".
      Full rest on return and 25 back on hunger and thirst, because somebody
      who slept properly did not also starve. It is a rule about where to
      sleep, not a bonus for logging out at a clever hour. Which beds give it
      was asked on #1606 and built as the suggested answer: your own bed, and
      a bed you are allowed in (a night the holder gave you, or the
      building's key or deed carried). A bed or bedroll nobody can lend you is
      the road, and gives nothing.

      #2246 asked for the rest of this table: logging out should give the
      most back, an inn or a temple the highest share, the wild the least.
      Measured on #2246 before this: every row drained the whole clock, so a
      new character who logged out anywhere but a bed of their own and came
      back after a night found hunger, thirst and rest all at 0, spent on
      all three, and every new character arrives in an inn nobody holds.

      Patrick, 12 Oct 2026, on #2246, the recommended table:
        - in a bed indoors, your own, one you are allowed in, or an inn or
          temple bed nobody holds, nothing drains while you are away;
        - anywhere else, a bedroll or a bed on the road, a seat, or on your
          feet, half the clock, and never under 25;
        - a night away in an inn or temple bed nobody holds gives rest to
          100 and 15 on hunger and thirst, under your own bed's and a bed
          you are allowed in's 25;
        - a night on a bedroll or a bed on the road leaves rest at least 50
          and nothing on hunger or thirst; a seat or your feet, nothing;
        - the clock itself (drain, above) stays as he set it on 23 Sep.

      sleptFor is how long away is a night: 8 hours on the game clock, which
      runs twenty times real time, so 24 real minutes. Away for less is no
      night, only the drain. Without it, lying down at home and logging
      straight back in would put 25 on hunger and thirst every time.
    */
    away: {
      bed:        { drain: 0, floor: 0, rest: 100, food: 25, drink: 25 },
      inn:        { drain: 0, floor: 0, rest: 100, food: 25, drink: 25 },
      common:     { drain: 0, floor: 0, rest: 100, food: 15, drink: 15 },
      commonfire: { drain: 0, floor: 0, rest: 100, food: 15, drink: 15 },
      camp:       { drain: 0.5, floor: 25, rest: 50, food: 0, drink: 0 },
      rough:      { drain: 0.5, floor: 25, rest: 50, food: 0, drink: 0 },
      campfire:   { drain: 0.5, floor: 25, rest: 0, food: 0, drink: 0 },
      sit:        { drain: 0.5, floor: 25, rest: 0, food: 0, drink: 0 },
      up:         { drain: 0.5, floor: 25, rest: 0, food: 0, drink: 0 }
    },
    sleptFor: 24 * 60000,

    /*
      What a thing is worth. The default is what an unlisted food or drink
      gives, so the table never has to be complete for the system to work, and
      an ingredient nobody thought about is a small meal rather than nothing.

      ALE IS THE ONE THAT COSTS SOMETHING, which is Blade's "Ale fills your
      thirst meter faster but has negative effects (TBD)". It is the best drink
      in the game and it takes rest off you, so a night at the inn is a real
      choice rather than a free one.
    */
    food: { def: 15 },
    drink: { def: 20 },
    /*
      A POTION IS A LIQUID AND A SWALLOW. Patrick, 23 September: "Potions
      and poisons should be counted towards thirst they are liquids". It is
      a mouthful rather than a drink, so it is worth a quarter of one, and a
      poison counts the same because applying one to a blade and drinking it
      fire the same event and nothing here can tell them apart.
    */
    /*
      THE POTION WINDOW (#1382). potions.md: "Inside 60 seconds, the first
      potion does what it says. The second heals or buffs at 50%. The third
      at 25%. The fourth and after do the sip of thirst and nothing else.
      The window is from the first swallow." The server applies a potion's
      effects itself (EatItemEvent in the engine) and the client's own heal
      is cropped to regeneration, so the scale is handed to the engine in
      onEatItem before anything lands, through eatItemScale (skymp #62).
    */
    potion: { def: 5, windowSeconds: 60, scales: [1, 0.5, 0.25, 0] },

    /*
      WATER YOU CARRY (#1382). drink.md's table: a well, an inn or a filled
      skin is 20 and safe; a river unboiled is 20 and can foul you; marsh, a
      puddle or standing water is 15 and fouls you more often; the sea is 10
      and salt. The chance of fouled water is the disease block's own
      (EXPOSED.fouled), so it is named here and rolled there. Patrick, 12 Oct
      2026: Frostreach ice water and well water are safe without boiling;
      rivers, lakes and streams must be boiled. Boiled water is safe. And
      20 October 2026 (#1382): lake water is worth what river water is, 20
      thirst and the river's chance of fouled water unboiled, so the water
      bucket by a lake fills river water.
    */
    waterSource: {
      safe: { thirst: 20, fouled: '' },
      well: { thirst: 20, fouled: '' },
      ice: { thirst: 20, fouled: '' },
      boiled: { thirst: 20, fouled: '' },
      river: { thirst: 20, fouled: 'river' },
      standing: { thirst: 15, fouled: 'standing' },
      sea: { thirst: 10, fouled: 'sea' }
    },
    // tools\waters.json's classes (WATERS) to the rows above. Lava is not
    // water and fills nothing. A lake is the deep class, which is the sea's
    // row unless WATERS names it otherwise.
    waterClass: { river: 'river', still: 'standing', marsh: 'standing', puddle: 'standing',
                  deep: 'sea', ice: 'ice' },
    // What drinking takes first: the worst you are carrying, never a guess in
    // your favour.
    waterOrder: ['standing', 'sea', 'river', 'ice', 'well', 'boiled'],
    unboiled: ['standing', 'sea', 'river'],
    // drink.md: "Boiling is a cook fire, a minute at it." Leaving the fire
    // before the minute is up, as the client reports it, loses the boil.
    boilSeconds: 60,
    // An empty wine bottle fills; a bottle of water is what it fills into.
    waterItems: { empty: 'f2012:Skyrim.esm', full: '13f598:WindhelmSSE.esp' },
    /*
      THE WELLS (Patrick, 12 Oct 2026): activating a well with an empty bottle
      fills it, at the game's own activation range. Every placed vanilla well
      is a STAT, and a static raises no activation, so nothing reaches the
      server from one (#1382, issuecomment-6129142274). wellActivators is the
      list of activator bases the content plugin puts on each well (WELLS,
      scripts\dev\Build-WellTable.py, has where they go). Since #1382 that is
      the well bucket, ThornswoodActivatorWellBucket, which the content
      plugin stands beside each well scripts\dev\Build-StationSites.py finds
      a clear spot at (game\data\station-sites.json, kind well: 18 of the
      30, and why each other one is left out).
      Once somebody fills at a well, that well is done for THEM for one
      in-game day. The game clock runs twenty times real time, so a day is
      72 real minutes. This is the one number to change.
    */
    wellActivators: ['18030:Thornswood-Content.esp'],
    /*
      THE WATER BUCKET (#1382, Patrick, 12 Oct 2026: drawing spots at rivers
      and lakes). The content plugin stands it on the bank of the river or
      lake nearest each town with a forge (game\data\station-sites.json,
      kind river). Activating it fills an empty bottle with river water,
      which must be boiled; lake water is worth the same (Patrick, 20 Oct
      2026), so one bucket serves both. No cooldown: drink.md gives a river
      none.
    */
    riverActivators: ['18031:Thornswood-Content.esp'],
    wellCooldownMinutes: 72,
    // Boiling is activating a cooking spot (Patrick, 12 Oct 2026): the
    // workbench keyword the cooking recipes are made at, CraftingCookpot,
    // as BENCH_BY_BASE names it. A plain campfire is a static or a light and
    // raises no activation.
    cookKeyword: 'a5cb3:Skyrim.esm',
    /*
      WHAT A MEAL IS WORTH, BY ITS GROUP (#1382, the approved list,
      issuecomment-6127545395). docs/systems/food.md: raw meat or fish 8 and
      can start food sickness, cooked 25, ordinary food 15, and a soup, stew
      or chowder is food and 10 thirst. A soup counts as cooked, so it is 25
      and 10 (Patrick, 12 Oct 2026, decision 2 on #1382): cooking a stew is
      never worse than cooking a chop. Ingredient, prepared and drugs are
      ordinary until the drug effect lands. FOOD_GROUPS (game/data/
      food-groups.json) says which record is in which group, by record, never
      by name. Burnt is a quality level a cook can come out at, not a group.
    */
    foodGroup: {
      raw: { food: 8, sick: 'raw' },
      cooked: { food: 25 },
      soup: { food: 25, drink: 10 },
      ingredient: { food: 15 },
      prepared: { food: 15 },
      drugs: { food: 15, drug: true },
      // A festival dish (#3152) is food.md's feast: 40.
      feast: { food: 40 }
    },
    /*
      A COOKED MEAL'S HELP (#2682). Patrick, 18 October 2026: a cooked meal
      gives only its temperature help by default, so a soup, stew or chowder
      warms; stamina recovery or the disease guard comes only when the cook
      adds one extra ingredient at the pot. Which group warms by default,
      which extra gives which help and which seasoned dish is which are data,
      in FOOD_GROUPS.season (game/data/food-groups.json). These are the
      numbers, from docs/systems/food.md: the temperature target 4 degrees
      warmer, or stamina recovery +10%, for 20 real minutes. The disease
      guard's own numbers are the injury block's MEAL_GUARD (#2684), and it
      is that block's guarded() that gives it; there is no second guard here.
      One help at a time: a meal with a help replaces the one before it.
    */
    mealHelp: {
      minutes: 20, warm: 4, stamina: 10,
      /*
        A FEAST (#3152). food.md: "A feast is the same list at double the
        help and half the time, so the disease chance is a quarter." The
        festival dishes are the feasts, and which help each gives is
        FOOD_GROUPS.feasts. The guard's quarter is the injury block's
        MEAL_GUARD.feast; the warmth and stamina are doubled here.
      */
      feast: { strength: 2, time: 0.5 },
      lines: {
        warm: 'The heat of it settles in your chest.',
        stamina: 'It sits well. You could walk a long way on that.',
        guard: 'It is sharp with the seasoning. You feel hale for it.'
      }
    },
    /*
      HOW A COOK COMES OUT (#2906). Patrick, 20 October 2026, B: three
      levels, burnt, plain and fine, the odds by the cook's rank in the half
      the recipe is, and a fine dish's help lasts 30 real minutes instead of
      20. Burnt is food.md's row: 8 hunger, and stamina recovery -10% for 10
      real minutes. Which record is the burnt meal and which is each dish's
      fine one is FOOD_GROUPS.quality (game/data/food-groups.json); the odds
      are these, the defaults the #2906 plan set, each a chance out of 1, the
      rest plain. Grand Chef's second portion is the same quality as the
      first: one roll, and the engine gives the batch twice (craftOutput).
    */
    cookQuality: {
      odds: {
        novice: { burnt: 0.2, fine: 0.05 },
        advanced: { burnt: 0.1, fine: 0.1 },
        expert: { burnt: 0.05, fine: 0.2 },
        master: { burnt: 0, fine: 0.35 }
      },
      fineMinutes: 30,
      burnt: { food: 8, stamina: -10, minutes: 10 },
      lines: {
        burnt: 'It caught on the heat. What comes off it is a Burnt Meal.',
        fine: 'It comes out well. This one is fine work.',
        ateBurnt: 'It is burnt. It fills a corner and sits heavy.'
      }
    },
    /*
      THE DRUG (#1382). docs/systems/exhaustion.md, A stimulant: "Skooma holds
      the drain at zero for 10 minutes, then costs 30 rest and 10 hunger. A
      second dose inside the window does not stack. It refreshes the clock and
      adds the crash again." All six drugs on the approved list
      (issuecomment-6127545395) take it. Real minutes.
    */
    drug: { holdMinutes: 10, crashRest: 30, crashFood: 10,
      /*
        WITHDRAWAL (#3153). Patrick, 22 Oct 2026, A on his report page:
        "Withdrawal after 3 uses in a day: stamina and magicka regen down 10%
        for 30 minutes." docs/systems/exhaustion.md, A stimulant. A use is a
        dose; the day is the last 24 real hours, the way every other number
        here is real time. When the window of a dose that is the third or
        more inside that day ends, withdrawal runs for its 30 minutes from
        that end, on top of the crash.
      */
      withdrawal: { uses: 3, dayHours: 24, minutes: 30,
                    cost: { staminaRateMult: -10, magickaRateMult: -10 },
                    line: 'Your hands shake and you want another dose. Withdrawal sets in.' } },
    /*
      TEA (#1382). docs/systems/exhaustion.md, A stimulant: "A tea holds the
      rest drain at half for 20 real minutes, then costs 15 rest more than
      those 20 minutes would have." A second cup inside the window refreshes
      the clock and owes the crash again, as a drug does. The teas are the
      content plugin's (Patrick, 12 Oct 2026, decision 4), group tea in
      FOOD_GROUPS. A tea is a drink, so it is also NEEDS.drink.def of thirst.
      Where a drug's window and a tea's overlap, the drug's zero is the one
      that holds.
    */
    tea: { holdMinutes: 20, share: 0.5, crashRest: 15 },
    /*
      EATING TAKES TIME, AND A FULL STOMACH SICKENS (#1382). docs/systems/
      food.md: "Eating takes 8 seconds. Another meal in that window does
      nothing. At 90 hunger or above, another meal does not raise the meter
      and starts food sickness instead." The sickness is the disease block's
      exposed(actorId, 'food', 'full'), which owns the chance.
    */
    meal: { eatSeconds: 8, fullAt: 90 },
    // What eating spoiled food says (#3163); the sickness says its own line.
    spoiledLine: 'It has gone off. It fills nothing.',
    /*
      COLD SPEEDS HUNGER AND THIRST (#1382). docs/systems/hunger.md and
      thirst.md: while the cold band is weary the clock runs at 1.25, at bad
      1.5, at spent 2. Heat does not speed it.
    */
    coldDrain: { fine: 1, weary: 1.25, bad: 1.5, spent: 2 },
    /*
      WET LASTS 3 MINUTES (#1382). docs/systems/temperature.md: "Rain and
      swimming leave you wet for 3 minutes after you are under a roof or out
      of the water. The exposure from rain or from the water place fades
      across those 3 minutes. It does not snap off at the door." The wet
      places are the ones the client reports for them.
    */
    wetMinutes: 3,
    wetPlaces: { rain: true, water: true, shallow: true },
    /*
      ALE, AND IT GETS WORSE WITH EVERY ONE.

      Patrick, 23 September: "alcohol should make you more hungry and give a
      drink effect over amounts drunken getting worse with each drink of
      alcohol".

      So one is a good drink and a small cost. The fourth is barely a drink
      at all and a real cost, and none of it is hidden: the line says which
      one this was.

        drink   what the first one quenches, in meter points
        rest    what the first one costs in tiredness
        food    what it costs in hunger, because drinking makes you hungry
        worse   how much of each cost the NEXT one adds, as a fraction: at
                0.6 the second is 1.6 times the first and the fourth is 2.8
        less    how much of the thirst each one after the first loses, so
                the fifth ale is nearly no use as a drink at all
        sober   how long a drink hangs about, in real minutes, before it
                stops counting toward the next one
    */
    ale: { drink: 30, rest: -8, food: -6, worse: 0.6, less: 0.25, sober: 45,
      /*
        THE HELP (#1382), docs/systems/drink.md: "The first two also give
        +0.05 melee damage for 5 real minutes. The third and after do not."
      */
      help: 0.05, helpMinutes: 5, helpThrough: 2,
      /*
        THE HANGOVER (#3153). Patrick, 22 Oct 2026, A on his report page:
        "Hangover: stamina regen down 25% for 10 minutes." It is what being
        drunk leaves when it wears off: the 45 minutes pass, in the world or
        while logged out (then it starts on the way back in). A night in a
        bed sleeps it off instead, and a physicker's remedy ends it early.
        docs/systems/drink.md.
      */
      hangoverMinutes: 10, hangover: { staminaRateMult: -25 },
      hungLine: 'Your head pounds and your legs are slow. You are hung over.',
      /*
        DRUNK (#1382), docs/systems/drink.md: "Drunk, from the third ale until
        you sleep or the 45 minutes pass: the client draws a sway and a soft
        edge." The server keeps drunk on the needs record and the HUD script
        hands it to the front plugin, which draws the content plugin's
        ThornswoodDrunkImod (Patrick, 12 Oct 2026, decision 3).
      */
      drunkFrom: 3 },

    /*
      The bands, and what each one costs.

      Nothing at all above 50, so half a meter is not a penalty and most of a
      session is unaffected. Then three steps. The names are what a person is
      told they are, because a number on a panel is not a feeling and "you are
      starving" is.
    */
    bands: [
      { at: 50, name: 'fine' },
      { at: 25, name: 'weary' },
      { at: 10, name: 'bad' },
      { at: 0, name: 'spent' }
    ]
  };

  /*
    WHAT EACH BAND DOES TO A CHARACTER, by meter.

    Every name here is an engine actor value that this repo has already proved
    it can set: they are the same names TUNING.perPoint uses, which the client
    applies through treeApplyNow. Nothing invents an actor value, because a
    name the game cannot resolve is set to 0 quietly and nothing says so, which
    is written out at length over perPoint and is not a lesson worth learning
    twice.

    attackDamageMult is a MULTIPLIER and everything else is a flat amount. That
    is why its numbers are small and the rest are not. Also written out over
    perPoint, where a 5 was once six times melee damage.

    Hunger takes your strength, thirst takes your magic and your legs, and
    exhaustion takes a little of everything, which is Blade's split.
  */
  var COST = {
    food: {
      fine:  {},
      weary: { stamina: -20, attackDamageMult: -0.05 },
      bad:   { stamina: -40, attackDamageMult: -0.10 },
      spent: { stamina: -60, attackDamageMult: -0.20, health: -20 }
    },
    drink: {
      fine:  {},
      weary: { magicka: -20, speedMult: -3 },
      bad:   { magicka: -40, speedMult: -7 },
      spent: { magicka: -60, speedMult: -12, magickaRateMult: -30 }
    },
    rest: {
      fine:  {},
      weary: { stamina: -10, magicka: -10, speedMult: -2 },
      bad:   { health: -15, stamina: -25, magicka: -25, speedMult: -5, attackDamageMult: -0.05 },
      spent: { health: -30, stamina: -45, magicka: -45, speedMult: -10, attackDamageMult: -0.15 }
    }
  };

  /*
    TEMPERATURE COSTS FROM BOTH ENDS, which is why it is not in COST above.

    The other three are worse the lower they are, so one band table each is
    enough. This one is worst at BOTH extremes and fine in the middle, so it
    is read as a distance from comfort rather than as a level.

    Cold takes your hands: stamina and speed, and at the far end health,
    because that is what freezing does. Heat takes your wind and your magic:
    stamina and magicka regeneration, and it never touches health, because
    being too warm in Skyrim should be a nuisance and not a death.
  */
  var TEMP_COST = {
    cold: {
      fine:  {},
      weary: { staminaRateMult: -20, speedMult: -2 },
      bad:   { staminaRateMult: -40, speedMult: -6, stamina: -20 },
      spent: { staminaRateMult: -60, speedMult: -12, stamina: -40, health: -25 }
    },
    hot: {
      fine:  {},
      weary: { staminaRateMult: -15 },
      bad:   { staminaRateMult: -35, magickaRateMult: -20, stamina: -15 },
      spent: { staminaRateMult: -55, magickaRateMult: -40, stamina: -35 }
    }
  };

  /*
    How far from comfort counts as what. A distance, in meter points.

    Comfort is 50, so 'spent' at 40 away means 10 or 90 on the meter: you have
    to be most of the way to an extreme before it is serious, and the middle
    twenty points either side cost nothing at all.
  */
  var TEMP_BANDS = [
    { at: 40, name: 'spent' },
    { at: 30, name: 'bad' },
    { at: 20, name: 'weary' },
    { at: 0, name: 'fine' }
  ];

  /** Which way, and how badly, the temperature is wrong. */
  function tempBand(v) {
    var away = Math.abs(clamp(v) - NEEDS.comfort);
    var name = 'fine';
    for (var i = 0; i < TEMP_BANDS.length; i++) {
      if (away >= TEMP_BANDS[i].at) { name = TEMP_BANDS[i].name; break; }
    }
    return { name: name, cold: clamp(v) < NEEDS.comfort };
  }

  /* Below this, a person is too tired to make anything. Blade: low exhaustion
     hits "everything including your ability to craft". A gate rather than a
     number, because a half made sword is not a thing. */
  var CRAFT_REST = 15;

  function clamp(n) {
    n = Number(n);
    if (!isFinite(n)) { return 100; }
    return n < 0 ? 0 : (n > 100 ? 100 : n);
  }

  /** The band a meter is in. See NEEDS.bands. */
  function bandOf(v) {
    v = clamp(v);
    for (var i = 0; i < NEEDS.bands.length; i++) {
      if (v >= NEEDS.bands[i].at) { return NEEDS.bands[i].name; }
    }
    return 'spent';
  }

  function fresh() {
    return { food: 100, drink: 100, rest: 100, temp: NEEDS.comfort,
             at: Date.now(), resting: '', worked: 0, place: '',
             sky: '', night: false, roof: false, high: 0 };
  }

  function read(actorId) {
    var v = null;
    try { v = mp.get(actorId, NEEDS_PROPERTY); } catch (e) { v = null; }
    if (!v || typeof v !== 'object') { return null; }
    return {
      food: clamp(v.food), drink: clamp(v.drink), rest: clamp(v.rest),
      // A character stored before temperature existed has no temp. Comfortable
      // is the right answer for them: nobody should log in freezing because a
      // meter was added while they were away.
      temp: (typeof v.temp === 'number') ? clamp(v.temp) : NEEDS.comfort,
      at: Number(v.at) || Date.now(),
      resting: String(v.resting || ''),
      worked: Number(v.worked) || 0,
      place: String(v.place || ''),
      // A drug's window and the crashes it owes (#1382), kept across reads.
      drugUntil: Number(v.drugUntil) || 0,
      drugCrash: Number(v.drugCrash) || 0,
      // When each dose of the last day went down, and when withdrawal ends
      // (#3153, NEEDS.drug.withdrawal).
      doses: dosesKept(v.doses),
      withdrawalUntil: Number(v.withdrawalUntil) || 0,
      // Whether that window is still open, for the HUD's high icon (#3143).
      drugged: !!v.drugged,
      // And a tea's (#1382).
      teaUntil: Number(v.teaUntil) || 0,
      teaCrash: Number(v.teaCrash) || 0,
      /*
        THE REST OF WHAT THE CLIENT REPORTS, AND LEAVING IT OUT COST AN HOUR.

        This function does not hand back what was stored, it rebuilds a clean
        object field by field, which is right: it is the boundary where
        somebody else's JSON becomes numbers this file can do arithmetic on.
        It also means a field that is not named here is dropped on the next
        read. sky, night, roof, high and fire were written by place() and gone
        three seconds later, so every temperature came out as the bare place
        value with no wind, no night, no altitude and no fire.

        The symptom was the meter looking exactly like it did before any of it
        was written, which is the most expensive kind of bug there is.
      */
      sky: String(v.sky || ''),
      night: !!v.night,
      roof: !!v.roof,
      high: Number(v.high) || 0,
      fire: (typeof v.fire === 'number') ? v.fire : -1,
      // The ales lately and when the last went down (#1677). consumed() reads
      // them through settle(), so without them every ale was the first.
      ale: Number(v.ale) || 0,
      aleAt: (typeof v.aleAt === 'number') ? v.aleAt : null,
      // Whether the third ale is still counting, for the screen (#1382).
      drunk: !!v.drunk,
      // The end of the 8 seconds a meal takes (#1382), so a second meal
      // inside it is still refused after the next read.
      eatUntil: Number(v.eatUntil) || 0,
      // When the last wet place was left, and what that place was worth
      // with its water, so the 3 minutes of wet survive a read (#1382).
      wetFrom: Number(v.wetFrom) || 0,
      wetPlace: (typeof v.wetPlace === 'number') ? v.wetPlace : null,
      // The first two ales' damage help (#1382), and when a hangover ends (#3153).
      aleHelpUntil: Number(v.aleHelpUntil) || 0,
      hangoverUntil: Number(v.hangoverUntil) || 0,
      // Which after-effect or high the screen shows, for the HUD script (#3153).
      look: String(v.look || ''),
      // A cooked meal's warmth or stamina help and when it ends (#2682).
      // The disease guard is kept by the injury block, not here.
      mealHelp: String(v.mealHelp || ''),
      mealHelpUntil: Number(v.mealHelpUntil) || 0,
      // True while that help is a feast's, twice as strong (#3152).
      mealFeast: !!v.mealFeast,
      // When a burnt meal's slow stamina ends (#2906).
      burntUntil: Number(v.burntUntil) || 0,
      // Water carried, by where it came from, a boil under way, and the
      // wells this person has filled at lately (#1382).
      water: waterHeld(v.water),
      boilFrom: (typeof v.boilFrom === 'number') ? v.boilFrom : null,
      boilFire: !!v.boilFire,
      wellAt: wellsUsed(v.wellAt)
    };
  }

  function write(actorId, n) {
    try { mp.set(actorId, NEEDS_PROPERTY, n); return true; }
    catch (e) { return false; }
  }

  /*
    Whether somebody is still making their character. The chargen block's own
    answer, through the global the way the character block reaches it, and no
    answer counts as not in creation, so a missing block never freezes anybody.
  */
  function inCreation(actorId) {
    try {
      var c = g.__thornswoodChargen;
      return !!(c && c.inCreation && c.inCreation(actorId));
    } catch (e) { return false; }
  }

  /*
    WHO HAS COME INTO THE WORLD SINCE THEY LAST LEFT IT (#1606).

    The first settle after somebody comes online is their arrival, and the
    arrival is where a night in a bed is counted (arrived, below). Every
    reader of the meters goes through settle, whichever of them comes first
    after a login: the client's first /place, the K panel, the beds' first
    sight, this block's own tick. So settle is the one place that always sees
    the arrival before anything else has moved the clock on.

    here holds everybody settled since they came online. The tick takes out
    whoever is no longer online, so their next settle is an arrival again. It
    is on globalThis, so a hot reload is not an arrival, and whoever is online
    when this block first loads has already arrived.
  */
  if (!g.__thornswoodNeedsHere) {
    var already = {};
    // No list at all is a cold start, and nobody is online at a cold start.
    var on = [];
    try { on = mp.get(0, 'onlinePlayers') || []; } catch (e) { on = []; }
    for (var oi = 0; oi < on.length; oi++) { already[on[oi]] = true; }
    g.__thornswoodNeedsHere = already;
  }
  var here = g.__thornswoodNeedsHere;

  function onlineNow(actorId) {
    try { return (mp.get(0, 'onlinePlayers') || []).indexOf(actorId) !== -1; } catch (e) { return false; }
  }

  /*
    Bring a character's meters up to now, and answer them.

    Everything is worked out from ELAPSED REAL TIME rather than ticked, so a
    server restart, a slow tick or somebody logging back in after a day all
    land on the same number. The tick below only exists to make the change
    visible and to notice a band crossing; the arithmetic does not need it.
  */
  function settle(actorId, now) {
    now = now || Date.now();
    var n = read(actorId);
    var arriving = !here[actorId] && onlineNow(actorId);
    if (arriving) { here[actorId] = true; }
    /*
      IN CREATION NOTHING MOVES, AND THE CLOCK IS MOVED ON WITH IT.

      Patrick, 24 September, over a tester in the hall with the bars at 96,
      91 and 99 and Temp at 58 while the K panel was still asking for a home:
      "needs menu shouldnt show or be actuive during creation". So a character
      in creation keeps the values they had: no drain, no warming or cooling,
      and no band to report because nothing crosses one.

      at is still brought up to now, which is the half that matters. Every
      number here is worked from elapsed time, so leaving at behind would
      charge the whole of creation in one go on the first settle after it.
      The first settle after the home is picked starts the meters from the
      last one here, whether or not they ever reconnect in between.

      creating rides on the property so the HUD takes the bars off. read()
      drops it, so it is written only while this is true.
    */
    if (inCreation(actorId)) {
      if (!n) { n = fresh(); }
      n.at = now;
      n.creating = true;
      write(actorId, n);
      return n;
    }
    if (!n) { n = fresh(); write(actorId, n); return n; }

    var away = now - n.at;
    var hours = (now - n.at) / 3600000;
    if (hours <= 0) { return n; }
    // A session that has been away for a week does not starve to death twice
    // over; the meters bottom out at 0 anyway, and this keeps the arithmetic
    // sane for anything that reads the difference.
    if (hours > 48) { hours = 48; }

    /*
      HOW MUCH OF THE CLOCK THE TIME AWAY COSTS, by where they logged out
      (#2246): NEEDS.away's drain and floor, on an arrival only. Nothing in a
      bed indoors, half the clock and never under 25 anywhere else.
    */
    var gone = arriving ? awayRow(n.resting) : null;
    var share = gone ? Number(gone.drain) : 1;
    if (!(share >= 0)) { share = 1; }
    var floor = gone ? clamp(Number(gone.floor) || 0) : 0;

    /*
      THE COLD BAND SPEEDS BOTH CLOCKS (#1382), at the band the meter is in
      as this stretch starts. Not on an arrival: the time away was not spent
      standing in that cold.
    */
    var chillBand = tempBand(n.temp);
    var chill = (!arriving && chillBand && chillBand.cold)
      ? (Number(NEEDS.coldDrain[chillBand.name]) || 1) : 1;
    n.food = awayDrain(n.food, NEEDS.drain.food * hours * share * chill, floor);
    n.drink = awayDrain(n.drink, NEEDS.drain.drink * hours * share * chill, floor);

    var restRate = NEEDS.drain.rest;
    if (n.worked && (now - n.worked) < NEEDS.workFor) {
      restRate = restRate * workMultiplier(actorId);
    }
    /*
      THE TIME AWAY GAINS NO REST (#1764). On an arrival n.resting is still
      the place they logged out on, and nobody comes back into the world
      sitting or lying down (#1734), so that place was not true while they
      were gone: exhaustion.md, "You are resting only while the place is
      true". Until #1764 the whole time away gained that place's rate, so a
      chair or a bedroll on the road filled rest the way only the logout fill
      may. The time away drains; the fill for the beds that give it is
      arrived(), below, and the beds' first sight of them gets them up.
    */
    var gain = arriving ? 0 : restingGain(actorId, n);
    /*
      A DRUG HOLDS THE REST DRAIN AT ZERO while its window lasts (#1382), for
      the part of this stretch before drugUntil. Resting still gains.
    */
    var held = 0;
    if (n.drugUntil > n.at) { held = Math.min(hours, (Math.min(now, n.drugUntil) - n.at) / 3600000); }
    /*
      A TEA HOLDS IT AT HALF (#1382) for the part of the stretch before
      teaUntil that the drug has not already held at zero. Both windows run
      from n.at, so the drug's part is the first part of the tea's.
    */
    var steeped = 0;
    if (n.teaUntil > n.at) { steeped = Math.min(hours, (Math.min(now, n.teaUntil) - n.at) / 3600000); }
    held += Math.max(0, steeped - held) * NEEDS.tea.share;
    var drained = Math.max(0, hours - held);
    n.rest = gone ? awayDrain(n.rest, restRate * share * drained, floor)
                  : clamp(n.rest + gain * hours - restRate * share * drained);
    // The window over: the crash, once for every dose that added one.
    var pulled = false;
    if (n.drugCrash > 0 && now >= n.drugUntil) {
      n.rest = clamp(n.rest - NEEDS.drug.crashRest * n.drugCrash);
      n.food = clamp(n.food - NEEDS.drug.crashFood * n.drugCrash);
      /*
        AND WITHDRAWAL, when the last dose was the third or more in a day
        (#3153, NEEDS.drug.withdrawal). From the window's end, or from the way
        back in for somebody whose window ended while they were away, as a
        hangover is.
      */
      var W = NEEDS.drug.withdrawal;
      if (usesOfDay(n.doses) >= W.uses) {
        var wasPulled = n.withdrawalUntil > now;
        var pullFrom = arriving ? now : n.drugUntil;
        n.withdrawalUntil = Math.max(n.withdrawalUntil, pullFrom + W.minutes * 60000);
        pulled = !wasPulled && n.withdrawalUntil > now;
      }
      n.drugCrash = 0;
      n.drugUntil = 0;
    }
    if (n.teaCrash > 0 && now >= n.teaUntil) {
      n.rest = clamp(n.rest - NEEDS.tea.crashRest * n.teaCrash);
      n.teaCrash = 0;
      n.teaUntil = 0;
    }

    /*
      Temperature moves TOWARD where you are, rather than only falling.

      An exponential approach rather than a straight line, so it is quick when
      you are far from the target and settles rather than overshooting: step
      the remaining distance by a fraction of an hour's worth of warmth. Walk
      indoors out of a blizzard and most of the cold is gone in a few minutes;
      stand in the snow and you keep sliding toward freezing without ever
      quite arriving, which is the right shape for something you are supposed
      to be able to endure for a while.
    */
    /*
      WARMING IS FAST AND COOLING IS NOT, and which one this is decides the
      half life. See the two numbers in NEEDS: a fire warms you in seconds and
      a cold night takes you slowly, and at one shared three minute half life
      standing in a fire moved the meter barely a point in ten seconds, which
      is the whole of "fire is still not changing temp".
    */
    /*
      THE TIME AWAY MOVES NO TEMPERATURE (#3154). On an arrival the place in
      n is still the one they logged out in, and they were not standing in it
      while they were gone: the same reason the cold band above does not
      speed the clocks for the time away, and the time away gains no rest
      (#1764). Until this, the whole time away was settled toward that place,
      so somebody who logged out at 45 in the snow at night came back six
      hours later at 10, freezing, with the cold band on both clocks and the
      chill's hour already counting (tests\test-3154-login-restore.js). They
      come back at the temperature they left with, and it moves from there
      toward wherever they stand now, from their game's first /place.
    */
    if (!arriving) {
      var target = warmthTarget(actorId, n);
      // Winter out under the sky cools a quarter faster (#3144), so its half
      // life is the cooling one cut by that share. Warming is left alone.
      var half = (target > n.temp)
        ? (NEEDS.settleWarmMinutes || NEEDS.settleMinutes)
        : NEEDS.settleMinutes / outdoorCooling(n);
      var k = 1 - Math.pow(0.5, (hours * 60) / half);
      if (k > 1) { k = 1; }
      if (k > 0) { n.temp = clamp(n.temp + (target - n.temp) * k); }
    }

    // A night in a bed, on top of the time away settled above (#1606).
    var slept = arriving ? arrived(actorId, n, away) : '';
    var hungBefore = n.hangoverUntil > now;
    /*
      DRUNK WEARS OFF INTO A HANGOVER (#3153). n.drunk is still what the last
      settle wrote, so drunk then and not now is the 45 minutes passing. In
      the world the hangover runs from the moment they passed; for somebody
      who left drunk, from the way back in, because a hangover is felt in the
      world. A night's sleep ends being drunk (drink.md: "until you sleep")
      and sleeps the hangover off, one already running as well.
    */
    if (slept) { n.hangoverUntil = 0; n.ale = 0; }
    else if (n.drunk && !drunkNow(n, now)) {
      var soberAt = arriving ? now : n.aleAt + NEEDS.ale.sober * 60000;
      n.hangoverUntil = Math.max(n.hangoverUntil, soberAt + NEEDS.ale.hangoverMinutes * 60000);
    }
    n.drunk = drunkNow(n, now);
    var hung = n.hangoverUntil > now;
    n.look = lookNow(n, now);
    // High while a drug's window is open (#3143); the crash above closes it.
    n.drugged = n.drugUntil > now;

    n.at = now;
    write(actorId, n);
    // A hangover starting or ending changes what there is to tend (#1382),
    // and what the character pays (effects reads it).
    if (hungBefore !== hung) {
      pushEffects(actorId);
      hangoverCare(actorId);
      if (hung) { notify(actorId, NEEDS.ale.hungLine); say(actorId, NEEDS.ale.hungLine); }
    }
    if (pulled) {
      pushEffects(actorId);
      notify(actorId, NEEDS.drug.withdrawal.line);
      say(actorId, NEEDS.drug.withdrawal.line);
    }
    if (slept) {
      /*
        Up, in the beds' book as well, so the property block does not go on
        counting them as lying in the bed they woke in. And the bands the
        night moved reach the character, the way a crossing does.
      */
      var beds = g.__thornswoodBeds;
      if (beds && beds.off) { beds.off(actorId); }
      pushEffects(actorId);
      notify(actorId, slept);
      say(actorId, slept);
    }
    return n;
  }

  /*
    Where the temperature is heading, once what they are wearing is counted.

    Patrick, 23 September: "also clothing should affect temperature depening on
    what clothes and if you are weaing them no clothes should equal colder some
    clothes/armor should be hotter than others etc".

    The place gives a raw target and the clothes move it toward comfortable.
    Bare skin in a blizzard gets the blizzard's own 16; the same person in fur
    head to toe gets about 38, which is cold and survivable, which is what fur
    is for.

    IT CUTS BOTH WAYS ON PURPOSE. At a forge the raw target is 92 and warm
    clothes push it HIGHER rather than lower, so the best thing to wear in a
    blizzard is the worst thing to wear at a smelter and there is no outfit
    that wins everywhere. That is NEEDS.wear.heat.
  */
  function underSeason(n) {
    if (!n || n.place === 'indoors' || n.roof) { return false; }
    return n.place === 'outdoors' || n.place === 'rain' || n.place === 'snow' ||
           n.place === 'water' || n.place === 'shallow';
  }

  function outdoorSeason(n) {
    if (!underSeason(n)) { return 0; }
    var S = g.__thornswoodSeason;
    if (!S || !S.outdoorShift) { return 0; }
    return Number(S.outdoorShift(Date.now())) || 0;
  }

  /*
    How much faster the meter cools than the written half life, in the same
    places the season shifts the target (#3144): 1.25 in winter out under the
    sky, 1 everywhere and every season else.
  */
  function outdoorCooling(n) {
    if (!underSeason(n)) { return 1; }
    var S = g.__thornswoodSeason;
    if (!S || !S.coolingShare) { return 1; }
    var share = Number(S.coolingShare(Date.now()));
    return share > 0 ? share : 1;
  }

  /*
    What the place is worth, with the wet still on you (#1382). The place
    alone answered until this, so a roof dried you the moment the client said
    you were under one. For 3 minutes after leaving the rain or the water,
    the place moves from what the wet place was worth to what this one is,
    in a straight line. Only ever colder: walking out of the water onto snow
    is the snow.
  */
  function wetPlaceWorth(n, worth) {
    if (!n || !n.wetFrom || typeof n.wetPlace !== 'number') { return worth; }
    if (NEEDS.wetPlaces[n.place]) { return worth; }
    var span = NEEDS.wetMinutes * 60000;
    var left = 1 - (Date.now() - n.wetFrom) / span;
    if (!(left > 0) || n.wetPlace >= worth) { return worth; }
    if (left > 1) { left = 1; }
    return worth + (n.wetPlace - worth) * left;
  }

  function warmthTarget(actorId, n) {
    var raw = NEEDS.place[n.place];
    if (typeof raw !== 'number') { raw = NEEDS.comfort; }
    raw = wetPlaceWorth(n, raw);
    raw = raw + outdoorSeason(n) + weathered(actorId, n) + fireWarmth(n, actorId) + waterKind(actorId, n);
    if (raw < 0) { raw = 0; }
    if (raw > 100) { raw = 100; }
    if (raw === NEEDS.comfort) { return mealWarmed(n, raw); }
    var ins = insulation(actorId);
    var away = raw - NEEDS.comfort;
    var out = (away < 0)
      ? NEEDS.comfort + away * (1 - ins)
      : NEEDS.comfort + away * (1 + ins * NEEDS.wear.heat);
    if (out < 0) { out = 0; }
    if (out > 100) { out = 100; }
    return mealWarmed(n, out);
  }

  /*
    A WARMING MEAL (#2682): the target itself is NEEDS.mealHelp.warm degrees
    warmer while the help lasts, after the clothes, so it is the same 4
    degrees whatever somebody is wearing, as food.md says.
  */
  function mealWarmed(n, target) {
    if (!n || n.mealHelp !== 'warm' || !(Date.now() < (Number(n.mealHelpUntil) || 0))) { return target; }
    var out = target + NEEDS.mealHelp.warm * helpStrength(n);
    if (out > 100) { out = 100; }
    return out;
  }

  /*
    Everything else about where somebody is standing, as one number of degrees
    on or off the place's own target.

    Patrick, 23 September: "the temp should also account for wind and all other
    weather reelated and environment factors".

    FOUR THINGS, AND NONE OF THEM APPLY UNDER A ROOF. A roof is the whole point
    of a roof: it is not windy indoors, it is not colder upstairs at night, and
    a building at the top of a mountain is a building. So the client reports
    whether there is one over you and this stops at the door. A campfire in a
    blizzard still gets the blizzard, because a campfire is not a roof, which
    is the case this shape exists for.

      wind    the weather's own WTHR wind speed, read out of the plugins into
              WEATHER. It is measured against the middle of this load order
              rather than against 255: see the note in Build-WeatherTable.js,
              where Cathedral Weathers sets a clear day to 150.
      sky     what kind of weather it is, off the same record, which is finer
              than the four the engine reports: cloudy is its own step.
      night   the game clock, which runs twenty times real time.
      height  the tundra is near zero, High Hrothgar is twelve thousand up and
              the Throat of the World is past twenty five.

    The sun is the one that goes the other way: a clear day with no roof over
    you is the only thing in here that adds.
  */
  /*
    What the nearest fire is worth from where you are standing.

    Patrick: "if I am further away or closer to a fire it slowly rises and
    lowers as I walk away from the fire". A straight line from NEEDS.fire.at at
    nothing to zero at reach; the settle curve on top of it is what makes the
    number on screen move rather than jump.

    A fire is not gated on the roof, because a campfire in a blizzard is the
    whole point of a campfire.
  */
  function fireWarmth(n, actorId) {
    if (!n) { return 0; }
    var d = Number(n.fire);
    if (!isFinite(d) || d < 0) { return 0; }
    var reach = NEEDS.fire.reach || 1;
    if (d >= reach) { return 0; }
    var at = (actorId && carverFire(actorId)) ? NEEDS.fire.master : NEEDS.fire.at;
    return at * (1 - (d / reach));
  }

  /*
    MASTER CARVER'S FIRE (#1398).

    docs/systems/professions/woodworker.md: fires and kilns a master
    woodworker builds or works are the hottest the warmth rules allow, 48 at
    your feet and still nothing at 300, where any other fire is 34.

    The server cannot see which fire is which: the client says only how far
    the nearest one is. So a fire is a Master Carver's while one is working
    it: a master woodworker who is within reach of a fire, and you within
    reach of them in the same cell. That is the master's own fire, the kiln
    they burn at, and whoever is standing at it with them. Nobody builds a
    fire in this world yet, so working one is the whole of it today.

    The perk is the progression block's own answer, held at master in the
    half somebody picked. Nothing loaded answers no, which is an ordinary fire.
  */
  function perkHeld(actorId, key) {
    var P = g.__thornswoodProgression;
    var C = g.__thornswoodCharacter;
    if (!P || !P.perks || !C || !C.stateOf) { return false; }
    try { return P.perks(C.stateOf(actorId)).indexOf(key) !== -1; } catch (e) { return false; }
  }

  function carverFire(actorId) {
    if (perkHeld(actorId, 'mastercarver')) { return true; }
    var reach = NEEDS.fire.reach || 1;
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return false; }
    if (online.length < 2) { return false; }
    var here = null, cell = '';
    try {
      here = mp.get(actorId, 'pos');
      cell = String(mp.get(actorId, 'worldOrCellDesc') || '');
    } catch (e) { return false; }
    if (!here || !cell) { return false; }
    for (var i = 0; i < online.length; i++) {
      var them = online[i];
      if (them === actorId) { continue; }
      try {
        if (String(mp.get(them, 'worldOrCellDesc') || '') !== cell) { continue; }
        var p = mp.get(them, 'pos');
        if (!p) { continue; }
        var dx = p[0] - here[0], dy = p[1] - here[1], dz = p[2] - here[2];
        if ((dx * dx + dy * dy + dz * dz) >= reach * reach) { continue; }
      } catch (e) { continue; }
      var theirs = read(them);
      if (!theirs || !(theirs.fire >= 0) || theirs.fire >= reach) { continue; }
      if (perkHeld(them, 'mastercarver')) { return true; }
    }
    return false;
  }

  /*
    What kind of water somebody is in, and what that is worth.

    Only ever asked of somebody who is actually in it, so a lava row costs
    nothing to anybody walking past a forge.

    THE CELL IS THE SERVER'S TO ANSWER. This is the one part of the
    temperature the client does not report: the water type is a WATR record on
    the cell and nothing in Skyrim Platform exposes it, while the server has
    held a cell descriptor for everybody online since the first day. WATERS is
    tools\waters.json flattened by its builder to cell-or-worldspace ->
    class, so this is one lookup and no resolution at all: the descriptors are
    compared as strings, the same shape worldOrCellDesc already answers in.
  */
  function waterKind(actorId, n) {
    if (!n || (n.place !== 'water' && n.place !== 'shallow')) { return 0; }
    var desc = '';
    try { desc = String(mp.get(actorId, 'worldOrCellDesc') || ''); } catch (e) { return 0; }
    if (!desc) { return 0; }
    var cls = '';
    try {
      if (typeof WATERS !== 'undefined' && WATERS && WATERS.items) {
        cls = WATERS.items[desc] || '';
      }
    } catch (e) { cls = ''; }
    if (!cls) { cls = 'deep'; }
    var worth = NEEDS.water[cls];
    return (typeof worth === 'number') ? worth : 0;
  }

  function exposure(n) {
    if (!n || n.roof) { return 0; }
    var row = weatherRow(n.sky);
    var off = 0;

    // Wind, above the middle of the table and up to the windiest thing in it.
    if (row && WEATHER && WEATHER.most > WEATHER.mid) {
      var over = (row.w - WEATHER.mid) / (WEATHER.most - WEATHER.mid);
      if (over > 0) {
        off -= Math.min(1, over) * NEEDS.weather.wind;
      }
    }

    // What is falling on you. The bits are 1 pleasant, 2 cloudy, 4 rainy,
    // 8 snow, and the aurora bit on top of any of them is ignored.
    if (row) {
      if (row.k & 8) { off -= NEEDS.weather.snow; }
      else if (row.k & 4) { off -= NEEDS.weather.rain; }
      else if (row.k & 2) { off -= NEEDS.weather.cloud; }
      else if ((row.k & 1) && !n.night) { off += NEEDS.weather.sun; }
    }

    if (n.night) { off -= NEEDS.weather.night; }

    var high = Number(n.high) || 0;
    if (high > NEEDS.weather.highFrom) {
      var up = ((high - NEEDS.weather.highFrom) / 1000) * NEEDS.weather.highPer1000;
      off -= Math.min(NEEDS.weather.highMost, up);
    }
    return off;
  }

  /*
    The weather the client is standing in, out of the table.

    WEATHER is tools\weather.json, installed into this file by
    tools\Build-WeatherTable.js: 117 weathers with a wind speed and a
    classification, read off the WTHR records of the whole load order.
    Descriptors, resolved through idOf once, the same as the warmth table.
  */
  var skyIndex = null;

  function weatherRow(hexId) {
    if (!hexId) { return null; }
    if (!skyIndex) {
      skyIndex = {};
      var table = null;
      try {
        table = (typeof WEATHER !== 'undefined' && WEATHER && WEATHER.items)
          ? WEATHER.items : null;
      } catch (e) { table = null; }
      var n = 0;
      if (table) {
        for (var d in table) {
          if (!Object.prototype.hasOwnProperty.call(table, d)) { continue; }
          var id = 0;
          try { id = idOf(d); } catch (e) { id = 0; }
          if (id) { skyIndex[id.toString(16)] = table[d]; n++; }
        }
      }
      nlog('weather: ' + n + ' resolved in this load order');
    }
    return skyIndex[String(hexId).toLowerCase()] || null;
  }

  /*
    How well dressed somebody is, 0 for bare skin up to NEEDS.wear.most.

    WARMTH is tools\warmth.json, built by tools\Build-WarmthTable.js out of the
    ARMO records of the whole load order: what each wearable is made of and
    what it covers. Descriptors, like every other table in this file, so it is
    resolved to the numbers the running game uses once and then kept.

    TWO PIECES OVER THE SAME SKIN ADD UP, which is not quite right and is
    capped rather than solved: a cuirass and a cloak both say they cover a
    torso and this counts both. The cap is what stops that mattering, and
    working out what is underneath what is a wardrobe simulator nobody asked
    for.
  */
  var wearIndex = null;

  /*
    WHAT A THING IS WHEN SOMEBODY SWALLOWS IT.

    tools\food.json, built by tools\Build-FoodTable.js out of the ALCH
    records of the whole load order: food, drink or ale. Descriptors, like
    every other table here, resolved once to the ids the running game uses.

    An unlisted thing is food, which is the same shape as the rest of this
    file: a mod adding a pie nobody classified is a small meal rather than
    nothing at all.
  */
  var foodIndex = null;
  var groupIndex = null;

  /*
    The group a record is in, out of FOOD_GROUPS, or ''. A group that is
    itself a kind (ale, drink, potion) moves the record to that kind: the
    Bee and Barb's mixed drinks, the Battle-Brew meads and Red Eagle's Rye
    are ale though their names carry no drink word, milk and juice are
    drink, and Goodberry is a healing potion with the food flag.
  */
  function foodGroup(baseId) {
    if (!groupIndex) {
      groupIndex = {};
      var table = null;
      try {
        table = (typeof FOOD_GROUPS !== 'undefined' && FOOD_GROUPS && FOOD_GROUPS.items) ? FOOD_GROUPS.items : null;
      } catch (e) { table = null; }
      if (table) {
        for (var d in table) {
          if (!Object.prototype.hasOwnProperty.call(table, d)) { continue; }
          var id = 0;
          try { id = idOf(d); } catch (e) { id = 0; }
          if (id) { groupIndex[id] = table[d]; }
        }
      }
    }
    return groupIndex[baseId] || '';
  }

  // One key of FOOD_GROUPS, or null.
  function foodGroupsKey(key) {
    try {
      return (typeof FOOD_GROUPS !== 'undefined' && FOOD_GROUPS && FOOD_GROUPS[key] &&
              typeof FOOD_GROUPS[key] === 'object') ? FOOD_GROUPS[key] : null;
    } catch (e) { return null; }
  }

  /*
    WHETHER A FOOD'S OWN MAGIC IS TAKEN AWAY (#2682). Patrick, 18 October
    2026: vanilla food's extra magic effects go, except temperature ones, so
    alchemy matters more. FOOD_GROUPS.strip says which groups lose them and
    which records keep them. The engine scales a record's effects as a whole
    (EatItemEvent, eatItemScale), so a record whose temperature effect rides
    with another effect is kept whole until the engine can drop one effect
    and keep another. Hunger and thirst are this block's own numbers, not
    record effects, and are not touched.
  */
  var stripIndex = null;

  function stripped(baseId) {
    if (!baseId) { return false; }
    if (!stripIndex) {
      stripIndex = { groups: {}, keep: {} };
      var s = foodGroupsKey('strip');
      if (s) {
        var gs = Array.isArray(s.groups) ? s.groups : [];
        for (var i = 0; i < gs.length; i++) { stripIndex.groups[String(gs[i])] = true; }
        var keep = (s.keep && typeof s.keep === 'object') ? s.keep : {};
        for (var d in keep) {
          if (!Object.prototype.hasOwnProperty.call(keep, d)) { continue; }
          var id = 0;
          try { id = idOf(d); } catch (e) { id = 0; }
          if (id) { stripIndex.keep[id] = true; }
        }
      }
    }
    if (stripIndex.keep[baseId]) { return false; }
    var grp = foodGroup(baseId);
    return !!grp && stripIndex.groups[grp] === true;
  }

  /*
    WHICH HELP A MEAL GIVES (#2682), out of FOOD_GROUPS.season: a seasoned
    dish's help is what its extra ingredient gives (season.extras), and any
    other meal's is its group's (season.plain: a soup warms). '' for none.
    season.dishes names each seasoned record the content plugin makes, with
    the plain dish it is made from and the extra that went in at the pot. It
    is empty until those records exist, and then only the plain help is live.
  */
  var MEAL_HELPS = ['warm', 'stamina', 'guard'];
  var seasonIndex = null;

  function mealHelpOf(baseId, group) {
    var s = foodGroupsKey('season');
    if (!seasonIndex) {
      seasonIndex = {};
      var dishes = (s && s.dishes && typeof s.dishes === 'object') ? s.dishes : {};
      var extras = (s && s.extras && typeof s.extras === 'object') ? s.extras : {};
      for (var d in dishes) {
        if (!Object.prototype.hasOwnProperty.call(dishes, d)) { continue; }
        var row = dishes[d];
        var help = (row && Object.prototype.hasOwnProperty.call(extras, row.extra)) ? extras[row.extra] : '';
        if (MEAL_HELPS.indexOf(help) === -1) { continue; }
        var id = 0;
        try { id = idOf(d); } catch (e) { id = 0; }
        if (id) { seasonIndex[id] = help; }
      }
    }
    if (baseId && seasonIndex[baseId]) { return seasonIndex[baseId]; }
    if (group === 'feast') { return feastHelpOf(baseId); }
    var plain = (s && s.plain && typeof s.plain === 'object') ? s.plain : {};
    var byGroup = Object.prototype.hasOwnProperty.call(plain, group) ? plain[group] : '';
    return (MEAL_HELPS.indexOf(byGroup) !== -1) ? byGroup : '';
  }

  /*
    WHICH HELP A FEAST GIVES (#3152), out of FOOD_GROUPS.feasts, by the plain
    festival dish: its fine record gives the same help. '' for none.
  */
  var feastIndex = null;

  function feastHelpOf(baseId) {
    if (!feastIndex) {
      feastIndex = {};
      var f = foodGroupsKey('feasts') || {};
      for (var d in f) {
        if (!Object.prototype.hasOwnProperty.call(f, d) || MEAL_HELPS.indexOf(f[d]) === -1) { continue; }
        var id = 0;
        try { id = idOf(d); } catch (e) { id = 0; }
        if (id) { feastIndex[id] = f[d]; }
      }
    }
    var plainId = quality().plainOf[baseId] || baseId;
    return feastIndex[plainId] || '';
  }

  // How strong the meal help on this record is: a feast's is doubled (#3152).
  function helpStrength(n) {
    return (n && n.mealFeast) ? NEEDS.mealHelp.feast.strength : 1;
  }

  /*
    THE QUALITY RECORDS (#2906), out of FOOD_GROUPS.quality: the burnt meal,
    and each dish's fine record by the plain dish it is a fine one of. A fine
    record is in its plain dish's group in FOOD_GROUPS.items, so it is worth
    what the dish is and its own magic goes the same way; only its help lasts
    longer. Built once, by id.
  */
  var qualityIndex = null;

  function quality() {
    if (!qualityIndex) {
      qualityIndex = { burnt: 0, fineOf: {}, plainOf: {} };
      var q = foodGroupsKey('quality');
      if (q) {
        try { qualityIndex.burnt = q.burnt ? (idOf(q.burnt) || 0) : 0; } catch (e) { qualityIndex.burnt = 0; }
        var fine = (q.fine && typeof q.fine === 'object') ? q.fine : {};
        for (var d in fine) {
          if (!Object.prototype.hasOwnProperty.call(fine, d)) { continue; }
          var plain = 0, made = 0;
          try { plain = idOf(d); made = idOf(fine[d]); } catch (e) { plain = 0; made = 0; }
          if (plain && made) { qualityIndex.fineOf[plain] = made; qualityIndex.plainOf[made] = plain; }
        }
      }
    }
    return qualityIndex;
  }

  /** The burnt meal's id, or 0. */
  function burntMeal() { return quality().burnt; }
  /*
    The spoiled food record (#3163), FOOD_GROUPS.spoil.spoiled, or 0. Patrick,
    26 October 2026, C: eating it fills nothing and starts food sickness. See
    the spoilage block for why it is a record of its own.
  */
  var spoiledIdKept = -1;
  function spoiledFood() {
    if (spoiledIdKept < 0) {
      var sp = foodGroupsKey('spoil');
      spoiledIdKept = 0;
      try { spoiledIdKept = (sp && sp.spoiled) ? (idOf(sp.spoiled) || 0) : 0; } catch (e) { spoiledIdKept = 0; }
    }
    return spoiledIdKept;
  }
  /** The fine record of a plain dish, or 0 when the dish has none. */
  function fineOf(baseId) { return quality().fineOf[baseId] || 0; }
  /** True for a fine dish. */
  function isFine(baseId) { return !!quality().plainOf[baseId]; }

  /*
    WHAT A COOK OF THIS DISH COMES OUT AS (#2906): the id the craft gives, by
    the cook's rank and one roll in [0, 1). A dish with no fine record is not
    a dish the quality is for (a tea, flour, a paste) and comes out as it is.
    Answers { baseId, quality } with quality 'burnt', 'plain' or 'fine'.
  */
  function cookedAs(plainId, rank, roll) {
    var fine = fineOf(plainId);
    var burnt = burntMeal();
    if (!fine || !burnt) { return { baseId: plainId, quality: 'plain' }; }
    var odds = NEEDS.cookQuality.odds[rank] || NEEDS.cookQuality.odds.novice;
    if (roll < odds.burnt) { return { baseId: burnt, quality: 'burnt' }; }
    if (roll < odds.burnt + odds.fine) { return { baseId: fine, quality: 'fine' }; }
    return { baseId: plainId, quality: 'plain' };
  }

  /*
    A BURNT MEAL WENT DOWN (#2906): stamina recovery -10% for 10 real
    minutes, food.md's row. It is not a meal's help and does not take one
    away: the warmth of the stew before it keeps its own clock.
  */
  function burntDown(actorId) {
    var n = settle(actorId);
    n.burntUntil = Date.now() + NEEDS.cookQuality.burnt.minutes * 60000;
    write(actorId, n);
    pushEffects(actorId);
  }

  /*
    A MEAL'S HELP LANDS (#2682). The latest meal's help is the one that
    counts. The disease guard is the injury block's (guarded(), #2684), so a
    guard clears the warmth or stamina kept here, and warmth or stamina takes
    the guard off through unguarded() where that block has it. feast is true
    for a feast (#3152): the guard is the injury block's feast row, and the
    warmth or stamina is doubled while it lasts. Answers the line to tell
    them, or '' when nothing landed.
  */
  function mealHelped(actorId, help, minutes, feast) {
    var H = g.__thornswoodHurt;
    var n = settle(actorId);
    var lasts = Number(minutes) > 0 ? Number(minutes) : NEEDS.mealHelp.minutes;
    if (help === 'guard') {
      if (!H || !H.guarded) { return ''; }
      H.guarded(actorId, !!feast, lasts);
      n.mealHelp = '';
      n.mealHelpUntil = 0;
      n.mealFeast = false;
    } else {
      if (H && H.unguarded) { H.unguarded(actorId); }
      n.mealHelp = help;
      n.mealHelpUntil = Date.now() + lasts * 60000;
      n.mealFeast = !!feast;
    }
    write(actorId, n);
    pushEffects(actorId);
    return NEEDS.mealHelp.lines[help] || '';
  }

  function foodKind(baseId) {
    if (!foodIndex) {
      foodIndex = {};
      var table = null;
      try {
        table = (typeof FOODS !== 'undefined' && FOODS && FOODS.items) ? FOODS.items : null;
      } catch (e) { table = null; }
      var n = 0, missed = 0;
      if (table) {
        for (var d in table) {
          if (!Object.prototype.hasOwnProperty.call(table, d)) { continue; }
          var id = 0;
          try { id = idOf(d); } catch (e) { id = 0; }
          if (id) { foodIndex[id] = table[d].k; n++; } else { missed++; }
        }
      }
      nlog('food: ' + n + ' edible things resolved, ' + missed + ' not in this load order');
    }
    return foodIndex[baseId] || '';
  }

  /*
    Something was eaten or drunk in the game: eaten(), below consumed, from
    mp.onEatItem.
  */
  /*
    WHAT THIS POTION IS WORTH, by how many came before it in the window.
    Kept in memory: a window is a minute, and a restart inside it starts a
    new one, which is the generous side. Food and drink are 1, always.
  */
  var potionWindow = {};

  function isPotion(baseId) {
    if (!baseId) { return false; }
    if (baseId >= 0xff000000) { return true; }
    // The food groups move a record's kind (#1382): Goodberry is a potion
    // with the food flag, and consumed() reads the group first too.
    var grouped = foodGroup(baseId);
    if (grouped) { return grouped === 'potion'; }
    return foodKind(baseId) === 'potion';
  }

  function potionScale(actorId, baseId) {
    if (!isPotion(baseId)) { return 1; }
    var now = Date.now();
    var w = potionWindow[actorId];
    if (!w || now - w.from >= NEEDS.potion.windowSeconds * 1000) {
      w = potionWindow[actorId] = { from: now, n: 0 };
    }
    var scales = NEEDS.potion.scales;
    var scale = scales[Math.min(w.n, scales.length - 1)];
    w.n++;
    return scale;
  }

  /*
    HOW MUCH OF A SWALLOWED RECORD'S OWN MAGIC THE ENGINE APPLIES, asked by
    mp.onEatItem before the engine applies it. A food in FOOD_GROUPS.strip
    gets none of it (#2682); anything else is the potion window's answer,
    which is 1 for everything that is not a potion.
  */
  function effectScale(actorId, baseId) {
    if (stripped(baseId)) { return 0; }
    return potionScale(actorId, baseId);
  }

  function consumed(actorId, baseId) {
    if (!baseId) { return ''; }
    if (isWaterItem(baseId)) { return drankWater(actorId); }
    var kind = foodKind(baseId);
    var group = foodGroup(baseId);
    if (group === 'ale' || group === 'drink' || group === 'potion') { kind = group; }
    /*
      A POTION SOMEBODY BREWED IS NOT IN ANY PLUGIN. The game makes its record
      at the alchemy lab, above 0xff000000 (see RUNTIME in recipelessCraft),
      so the food table never has it, and until 25 September it fell through
      to food: a brewed potion of healing counted as a meal. Alchemy is the
      only thing here that makes something to swallow that way; cooking works
      from recipes, and a recipe's result is a plugin's record. So it is what
      Patrick said potions are, a mouthful towards thirst.
    */
    if (!kind && baseId >= 0xff000000) { kind = 'potion'; }
    if (!kind) { kind = 'food'; }
    if (kind === 'potion' || kind === 'poison') {
      // A mouthful, not a drink. See NEEDS.potion.
      return ate(actorId, 'drink', NEEDS.potion.def);
    }
    if (group === 'tea') {
      // A drink, and the steep (#1382). See NEEDS.tea.
      var teaLine = ate(actorId, 'drink');
      steeped(actorId);
      return teaLine;
    }
    if (baseId && baseId === spoiledFood()) {
      // Spoiled food (#3163): no hunger at all, and the stomach turns. The
      // sickness is the disease block's, EXPOSED.food.spoiled.
      var ateSpoiled = meal(actorId, { food: 0, sick: 'spoiled' });
      if (ateSpoiled.taken && !ateSpoiled.full) {
        return NEEDS.spoiledLine + (ateSpoiled.line ? ' ' + ateSpoiled.line : '');
      }
      return ateSpoiled.line;
    }
    if (baseId === burntMeal()) {
      // A burnt meal (#2906): 8 hunger and the slow stamina, only for one
      // that went down, as a meal's help is.
      var ateBurnt = meal(actorId, { food: NEEDS.cookQuality.burnt.food });
      if (ateBurnt.taken && !ateBurnt.full) {
        burntDown(actorId);
        return NEEDS.cookQuality.lines.ateBurnt + (ateBurnt.line ? ' ' + ateBurnt.line : '');
      }
      return ateBurnt.line;
    }
    if (Object.prototype.hasOwnProperty.call(NEEDS.foodGroup, group)) {
      // A meal by its group (#1382): the hunger, a soup's thirst, raw's risk.
      // Before the kind: the food table calls 29 of the 30 soups drink, so a
      // stew was 20 thirst and no hunger at all.
      var row = NEEDS.foodGroup[group];
      var ate1 = meal(actorId, row);
      // A drug refused inside the 8 seconds does nothing, the same as any meal.
      if (row.drug && ate1.taken) { dosed(actorId); }
      // A cooked meal's help (#2682), only for a meal that went down: not
      // inside the 8 seconds, and not on a full stomach, where it sits badly.
      if (ate1.taken && !ate1.full) {
        var help = mealHelpOf(baseId, group);
        // A fine dish's help lasts longer (#2906), and a feast's lasts half
        // as long as a meal's, fine or plain (#3152).
        var lasts = isFine(baseId) ? NEEDS.cookQuality.fineMinutes : NEEDS.mealHelp.minutes;
        var feast = group === 'feast';
        if (feast) { lasts = lasts * NEEDS.mealHelp.feast.time; }
        var helpLine = help ? mealHelped(actorId, help, lasts, feast) : '';
        if (helpLine) { return helpLine + (ate1.line ? ' ' + ate1.line : ''); }
      }
      return ate1.line;
    }
    if (kind !== 'ale') { return ate(actorId, kind === 'drink' ? 'drink' : 'food'); }

    // Ale, and how many have gone down lately.
    var n = settle(actorId);
    var was = { food: bandOf(n.food), drink: bandOf(n.drink), rest: bandOf(n.rest),
                temp: tempBand(n.temp).name };
    var now = Date.now();
    var since = (typeof n.aleAt === 'number') ? (now - n.aleAt) : (NEEDS.ale.sober * 60000 + 1);
    var had = (since <= NEEDS.ale.sober * 60000) ? (Number(n.ale) || 0) : 0;

    var worse = 1 + (NEEDS.ale.worse * had);
    var quench = NEEDS.ale.drink * Math.max(0, 1 - (NEEDS.ale.less * had));
    n.drink = clamp(n.drink + quench);
    n.rest = clamp(n.rest + (NEEDS.ale.rest * worse));
    n.food = clamp(n.food + (NEEDS.ale.food * worse));
    n.ale = had + 1;
    n.aleAt = now;
    n.drunk = drunkNow(n, now);
    n.look = lookNow(n, now);
    if (had < NEEDS.ale.helpThrough) { n.aleHelpUntil = now + NEEDS.ale.helpMinutes * 60000; }
    write(actorId, n);
    if (had < NEEDS.ale.helpThrough) { pushEffects(actorId); }

    var words = ['You drink it down. It goes well.',
                 'The second one is going down easier than it should.',
                 'Three in. You are hungry and your legs know it.',
                 'Four. You will feel this tomorrow.'];
    var said = words[Math.min(had, words.length - 1)];
    var crossedLine = crossed(actorId, was, n);
    return said + (crossedLine ? ' ' + crossedLine : '');
  }

  /*
    SOMETHING WENT DOWN, AS THE ENGINE SAW IT (#3136). mp.onEatItem in the
    injury block hands every swallow here. The engine raises it only once it
    has checked the pack holds the thing, and the same message takes it out
    (MpActor::OnEquip), so a meter moves only for an item somebody had.

    Until #3136 the meters moved on the front plugin's /ate line, which
    anybody could type: /ate and a food's id in the chat was a meal with no
    food, and a drug's window with no drug. Its comment said there was no eat
    hook, which was true before the engine raised onEatItem and stopped being
    true when it did.

    Only a person's, the way the plugin only ever spoke for its own
    character, and only an ALCH or a brewed potion, which is everything the
    plugin reported (Potion.from on what was equipped). An ingredient is
    INGR and was never a meal; what eating one teaches is the alchemy
    block's. Answers the line to say, or ''.
  */
  function eaten(actorId, baseId) {
    baseId = Number(baseId) || 0;
    if (!baseId || !onlineNow(actorId)) { return ''; }
    if (baseId < 0xff000000) {
      var type = '';
      try {
        var res = mp.lookupEspmRecordById(baseId);
        type = (res && res.record) ? String(res.record.type || '') : '';
      } catch (e) { type = ''; }
      if (type !== 'ALCH') { return ''; }
    }
    return consumed(actorId, baseId);
  }

  function wearRow(baseId) {
    if (!wearIndex) {
      wearIndex = {};
      var table = null;
      try {
        table = (typeof WARMTH !== 'undefined' && WARMTH && WARMTH.items)
          ? WARMTH.items : null;
      } catch (e) { table = null; }
      var n = 0, missed = 0;
      if (table) {
        for (var d in table) {
          if (!Object.prototype.hasOwnProperty.call(table, d)) { continue; }
          var id = 0;
          try { id = idOf(d); } catch (e) { id = 0; }
          if (id) { wearIndex[id] = table[d]; n++; } else { missed++; }
        }
      }
      // Said once, because a table that resolved nothing looks exactly like
      // everybody being naked and there would be no other way to tell.
      nlog('warmth: ' + n + ' wearables resolved, ' + missed + ' not in this load order');
    }
    return wearIndex[baseId] || null;
  }

  /*
    WHAT THE SERVER THINKS IS ON SOMEBODY, ITEM BY ITEM.

    Patrick, 23 September: "temperature was not right it said the same with
    clothes, without clothes, and with a mix". There are four things that
    produce exactly that and nothing on screen tells them apart: the meter
    being slow, the warmth table resolving nothing, the server holding no
    record of the clothes because they were handed out inside the client's
    own game, or the clothes being worth so little on a mild day that the
    difference is under a degree.

    The first is answered by the Body page on K (it was /needs until #1631)
    saying where the warmth is heading. This answers the other three: every
    worn thing the server can see, whether the table knows it, and what it
    is worth. A piece the server has no record of
    cannot appear here at all, and that absence is the answer in the third
    case: ActionListener::OnUpdateEquipment logs 'dropped N item(s) the
    server has no record of' when the client equips something it was handed
    inside its own game, and those are invisible to everything here.
  */
  /*
    WHAT TO CALL A WORN THING.

    The table that ships inside this file is the material and the coverage
    and nothing else: the editor ids are in tools\warmth.json and are left
    out of the installed copy, which is four thousand rows. So the descriptor
    is the name, and it is the better one for this job anyway: 'ClothesFarm02
    :Skyrim.esm' says which plugin a piece came from, and which plugin it came
    from is exactly what is being asked when somebody's clothes are not
    counting.
  */
  function wornName(baseId, row) {
    if (row && row.e) { return String(row.e); }
    try {
      var d = mp.getDescFromId(baseId);
      if (d) { return String(d); }
    } catch (e) { }
    return 'id ' + Number(baseId).toString(16);
  }

  /*
    WHAT SOMEBODY IS ACTUALLY WEARING, for warmth.

    Inventory worn flags and the equipment record disagree. The client dresses
    from equipment; inventory worn is what the server asked for and can lag or
    stay set after somebody took the coat off. #608: no temp difference with
    clothes on or off. Prefer equipment when it is readable (even if empty);
    fall back to inventory worn only when equipment cannot be read.
  */
  function wornEntries(actorId) {
    try {
      var eq = mp.get(actorId, 'equipment');
      if (eq) {
        var ee = (eq.inv && eq.inv.entries) || eq.entries;
        if (ee) {
          var fromEq = [];
          for (var i = 0; i < ee.length; i++) {
            var e = ee[i];
            if (e && e.worn && e.baseId) { fromEq.push(e); }
          }
          return fromEq;
        }
      }
    } catch (e) { }
    try {
      var inv = mp.get(actorId, 'inventory');
      var entries = (inv && inv.entries) || [];
      var out = [];
      for (var j = 0; j < entries.length; j++) {
        var en = entries[j];
        if (en && en.worn && en.baseId) { out.push(en); }
      }
      return out;
    } catch (e2) { return []; }
  }

  function wornList(actorId) {
    var out = [];
    try {
      var entries = wornEntries(actorId);
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e || !e.worn) { continue; }
        var row = wearRow(e.baseId);
        if (!row) {
          out.push({ name: wornName(e.baseId, null), worth: 0, known: false });
          continue;
        }
        var mat = NEEDS.wear.material[row.m];
        if (typeof mat !== 'number') { mat = NEEDS.wear.material.cloth; }
        var worth = 0;
        var parts = String(row.c || '').split(',');
        for (var p = 0; p < parts.length; p++) {
          var w = NEEDS.wear.perPart[parts[p]];
          if (w) { worth += w * mat; }
        }
        out.push({ name: wornName(e.baseId, row),
                   worth: Math.round(worth * 100), known: true });
      }
    } catch (e) { return out; }
    return out;
  }

  /*
    MASTER WEAVER'S HALF OF THE WEATHER (#1398).

    docs/systems/professions/tailor.md: clothing a master tailor makes keeps
    the weather off, and temperature.md says how much: 4 degrees of exposure
    ignored, on top of the clothing table. It does not become fur, so
    insulation() is not touched; the 4 come off what the weather, the wind,
    the night and the height are taking, and never turn them into warmth.

    A woven garment is one whose name starts with NEEDS.wear.woven.mark, which
    the craft writes on it (wovenOutput, beside mp.onCraft). One worn is enough
    and two do not ignore 8. A piece with an enchantment on it is not one: the
    enchanting table lets anybody name a piece, and the engine only enchants a
    plain one, which a woven garment is not.
  */
  function wovenWorn(actorId) {
    var mark = NEEDS.wear.woven.mark;
    var entries = wornEntries(actorId);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || !e.worn || e.enchantmentId) { continue; }
      if (typeof e.name === 'string' && e.name.indexOf(mark) === 0) { return true; }
    }
    return false;
  }

  /* Out in a blizzard or a heavy storm, with no roof over you (#3176). */
  function stormy(n) {
    if (!n || n.roof) { return false; }
    var row = weatherRow(n.sky);
    return !!(row && row.s);
  }

  function weathered(actorId, n) {
    var off = exposure(n);
    if (!(off < 0) || !wovenWorn(actorId)) { return off; }
    return Math.min(0, off + NEEDS.wear.woven.degrees);
  }

  function insulation(actorId) {
    var total = 0;
    /*
      A BAD BURN HALVES WHAT IS WORN (#1383): injury.md, clothing on that part
      counts at half for warmth until it heals. The injury block says which
      parts and how much.
    */
    var burnt = null;
    try {
      var H = g.__thornswoodHurt;
      burnt = (H && H.burntWear) ? H.burntWear(actorId) : null;
    } catch (eBurn) { burnt = null; }
    try {
      var entries = wornEntries(actorId);
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e || !e.worn) { continue; }
        var row = wearRow(e.baseId);
        if (!row) { continue; }
        var mat = NEEDS.wear.material[row.m];
        if (typeof mat !== 'number') { mat = NEEDS.wear.material.cloth; }
        var parts = String(row.c || '').split(',');
        for (var p = 0; p < parts.length; p++) {
          var w = NEEDS.wear.perPart[parts[p]];
          if (w && burnt && (burnt.all || burnt[parts[p]])) { w = w * burnt.counts; }
          if (w) { total += w * mat; }
        }
      }
    } catch (e) { return 0; }
    if (total > NEEDS.wear.most) { total = NEEDS.wear.most; }
    return total;
  }

  /** How much faster working drains rest, by the best rank this person holds. */
  function workMultiplier(actorId) {
    var best = 'novice';
    try {
      var P = g.__thornswoodProgression;
      var C = g.__thornswoodCharacter;
      if (P && C && C.stateOf) {
        var s = C.stateOf(actorId);
        var ranks = (s && s.ranks) || {};
        var order = ['novice', 'advanced', 'expert', 'master'];
        for (var k in ranks) {
          if (!Object.prototype.hasOwnProperty.call(ranks, k)) { continue; }
          if (order.indexOf(ranks[k]) > order.indexOf(best)) { best = ranks[k]; }
        }
      }
    } catch (e) { }
    return NEEDS.workRest[best] || NEEDS.workRest.novice;
  }

  /** What this person is recovering per hour, by where they are resting. */
  function restingGain(actorId, n) {
    if (!n.resting) { return 0; }
    var base = NEEDS.recover[n.resting] || 0;
    if (!base) { return 0; }
    if (bardNear(actorId)) { base += NEEDS.bard; }
    return base;
  }

  /*
    A bard playing where this person is resting.

    Grim's idea and Patrick's yes. Somebody counts as a bard for this when the
    server has seen them playing, they are in the same cell, and it saw them
    in the last few minutes. There is no bard profession in the rulebook to
    read, and inventing one here would be settling a design question that is
    Patrick's.

    PLAYING, NOT SAYING (#1631). This used to be the word /bard, and nothing
    people do is a typed word any more. Patrick's answer on #1631, 4 Oct:
    "instrument emotes require the instrument, so if they do an emote with an
    instrument have that count as /bard, and also add a singing emote for
    people that are only singing". So a bard is somebody whose last animation
    is the emote wheel's Lute, Flute or Drum with that instrument in the pack,
    or its Sing, which needs nothing. The server reads both itself: the
    animation is the engine's lastAnimEvent, the last one the client sent for
    its own character, which the engine clears the moment they move; the
    instrument is the server's own inventory. No line from the client is
    asked or believed. Each tick that sees them playing is the word said
    again, so a bard counts while they play and for BARD_FOR after.
  */
  var BARDS = {};
  var BARD_FOR = 300000;
  /* The wheel's bard emotes by their event, lowercased the way the engine's
     is compared, and the instrument each needs in the pack. Sing needs none.
     The instruments are the Woodwright's, the same three local ids the
     wheel asks for (thornswood-emotes.js, INSTRUMENTS). */
  var BARD_PLAYS = {
    idlelutestart: '1d9b:PlayFluteLuteDrum.esp',
    idleflutestart: 'd62:PlayFluteLuteDrum.esp',
    idledrumstart: '287f:PlayFluteLuteDrum.esp',
    idledialoguehappystart: ''
  };

  /* Does this pack hold one of this record. */
  function carries(actorId, desc) {
    var id = idOf(desc);
    if (!id) { return false; }
    var inv = null;
    try { inv = mp.get(actorId, 'inventory'); } catch (e) { return false; }
    var entries = (inv && inv.entries) || [];
    for (var i = 0; i < entries.length; i++) {
      if (entries[i] && entries[i].baseId === id && entries[i].count > 0) { return true; }
    }
    return false;
  }

  /* Is the server seeing this person play: a bard emote is the last thing
     their client played, they have not moved since, and the instrument it
     needs is in their pack. */
  function playing(actorId) {
    var ev = '';
    try { ev = String(mp.get(actorId, 'lastAnimEvent') || '').toLowerCase(); } catch (e) { return false; }
    if (!ev || !Object.prototype.hasOwnProperty.call(BARD_PLAYS, ev)) { return false; }
    return !BARD_PLAYS[ev] || carries(actorId, BARD_PLAYS[ev]);
  }

  /* Everybody online the server sees playing is a bard from now. Asked by
     the tick, before anybody's meters are settled, so a bard counts for the
     people resting beside them in the same pass. */
  function bardSeen(online) {
    for (var i = 0; i < online.length; i++) {
      if (playing(online[i])) { bard(online[i]); }
    }
  }

  function bardNear(actorId) {
    var myCell = null;
    try { myCell = String(mp.get(actorId, 'worldOrCellDesc') || ''); } catch (e) { return false; }
    if (!myCell) { return false; }
    var now = Date.now();
    for (var id in BARDS) {
      if (!Object.prototype.hasOwnProperty.call(BARDS, id)) { continue; }
      if (now - BARDS[id] > BARD_FOR) { delete BARDS[id]; continue; }
      var who = Number(id);
      if (who === actorId) { continue; }
      var theirs = null;
      try { theirs = String(mp.get(who, 'worldOrCellDesc') || ''); } catch (e) { continue; }
      if (theirs && theirs === myCell) { return true; }
    }
    return false;
  }

  /*
    The actor value changes the three meters add up to, for the client.

    Folded into the same map the skill tree already sends, so nothing new is
    needed on the client at all: thornswood-front.js reads panel.effects and
    sets every name in it. A penalty is a negative number in the same map.
  */
  function effects(actorId, n) {
    var out = {};
    if (!n) { return out; }
    function add(cost) {
      for (var av in cost) {
        if (!Object.prototype.hasOwnProperty.call(cost, av)) { continue; }
        out[av] = (Object.prototype.hasOwnProperty.call(out, av) ? out[av] : 0) + cost[av];
      }
    }
    /*
      A DISEASE READS AS THE METER IT IS CLOSEST TO (#1383). disease.md: ill is
      the weary penalties of that meter and bad is the bad ones, so the meter
      counts as at least that band while it lasts. The injury block answers which, and what a broken or
      crooked limb and an agreed loss add on top.
    */
    var hurt = { floors: {}, add: {} };
    try {
      var H = g.__thornswoodHurt;
      if (H && H.forNeeds) { hurt = H.forNeeds(actorId) || hurt; }
    } catch (eHurt) { }
    var floors = hurt.floors || {};
    var order = ['fine', 'weary', 'bad', 'spent'];
    function atLeast(band, floor) {
      return (floor && order.indexOf(floor) > order.indexOf(band)) ? floor : band;
    }
    var meters = ['food', 'drink', 'rest'];
    for (var i = 0; i < meters.length; i++) {
      var floor = floors[meters[i]];
      add(COST[meters[i]][atLeast(bandOf(n[meters[i]]), floor)] || {});
    }
    // And temperature, which is read as a distance from comfort in either
    // direction rather than as a level. See TEMP_COST. A chill is the cold
    // side's: on top of the heat when somebody chilled stands at a forge.
    var t = tempBand(typeof n.temp === 'number' ? n.temp : NEEDS.comfort);
    if (t.cold || t.name === 'fine') {
      add(TEMP_COST.cold[atLeast(t.name, floors.cold)] || {});
    } else {
      add(TEMP_COST.hot[t.name] || {});
      if (floors.cold) { add(TEMP_COST.cold[floors.cold] || {}); }
    }
    // A blizzard or a heavy storm: 15 per cent slower while out in it (#3176).
    if (stormy(n)) { add({ speedMult: -NEEDS.weather.storm }); }
    add(hurt.add || {});
    // The first two ales: +0.05 melee damage for 5 minutes (#1382).
    if (n.aleHelpUntil && Date.now() < n.aleHelpUntil) { add({ attackDamageMult: NEEDS.ale.help }); }
    // A cooked meal's stamina help: +10% stamina recovery while it lasts (#2682).
    if (n.mealHelp === 'stamina' && Date.now() < (Number(n.mealHelpUntil) || 0)) {
      add({ staminaRateMult: NEEDS.mealHelp.stamina * helpStrength(n) });
    }
    // A burnt meal: -10% stamina recovery while it lasts (#2906).
    if (Date.now() < (Number(n.burntUntil) || 0)) {
      add({ staminaRateMult: NEEDS.cookQuality.burnt.stamina });
    }
    // A hangover: -25% stamina recovery for its 10 minutes (#3153).
    if (Date.now() < (Number(n.hangoverUntil) || 0)) { add(NEEDS.ale.hangover); }
    // Withdrawal: -10% stamina and magicka recovery for its 30 minutes (#3153).
    if (Date.now() < (Number(n.withdrawalUntil) || 0)) { add(NEEDS.drug.withdrawal.cost); }
    return out;
  }

  /** What the panel draws. */
  function view(actorId) {
    var n = settle(actorId);
    var t = tempBand(n.temp);
    return {
      food: Math.round(n.food), drink: Math.round(n.drink), rest: Math.round(n.rest),
      temp: Math.round(n.temp),
      foodBand: bandOf(n.food), drinkBand: bandOf(n.drink), restBand: bandOf(n.rest),
      // Temperature says which way as well as how badly, because "cold" and
      // "hot" are different words on a bar and 34 means nothing on its own.
      tempBand: t.name, tempCold: !!t.cold,
      resting: n.resting || '', place: n.place || '',
      // What logging out where they are now would do (#2246), from the same
      // NEEDS.away row the arrival reads, so the Body page cannot drift.
      away: awayWords(n.resting),
      /*
        WHY THE NUMBER IS WHAT IT IS, added 23 September.

        Patrick, in the world: "temp in general isn't working not just with
        fire", after seeing 51 indoors and 53 to 54 outdoors and reading it
        as backwards. The meter moves toward its target by half the distance
        every three minutes, so almost every number anybody ever sees is
        mid-journey, and a number mid-journey with no target beside it is
        indistinguishable from a broken one. 51 indoors was on its way up to
        58 and 53 outdoors was on its way down to 44, which is the system
        working and looks exactly like the system failing.

        So the target travels with the reading, along with the four things
        that set it. Then the next report is a measurement rather than an
        impression, and a real fault is told apart from a slow one in one
        command.
      */
      tempTarget: Math.round(warmthTarget(actorId, n)),
      roof: !!n.roof, night: !!n.night,
      fireAway: (typeof n.fire === 'number' && n.fire >= 0) ? Math.round(n.fire) : -1,
      fireWorth: Math.round(fireWarmth(n, actorId)),
      exposure: Math.round(weathered(actorId, n)),
      // How much slower a storm makes you right now, 0 when not in one (#3176).
      storm: stormy(n) ? NEEDS.weather.storm : 0,
      cover: Math.round(insulation(actorId) * 100),
      worn: wornList(actorId)
    };
  }

  /*
    THE FOUR BARS AS ONE LINE OF TEXT (#2267), the answer to /needs and
    /need.

    Patrick, 24 September, when the launcher's Settings got "Show the needs
    bars on screen": hide them "so it doesnt show and they can do /needs to
    find it all". #1631 took /needs out on 4 Oct under "buttons, not
    commands", and on 11 Oct Patrick put it back as an exception to that
    rule: for somebody who hid the bars and wants a quick text version of
    them. It is another view of what the bars and the Body page on K already
    show, so it says the same things the bars say, with the same words: the
    three meters as a per cent with their band, Temp as its word and number,
    where the warmth is heading, and where they are resting. The working out
    of the warmth and what is counted as worn stay on the Body page, which
    this names. Nothing here moves a meter: view() settles, the way the K
    panel's read does.
  */
  var REST_SAID = {
    sit: 'sitting', campfire: 'sitting by a fire', rough: 'in a bed nobody can lend you',
    camp: 'in a bed by a fire', inn: 'in a bed you may use', bed: 'in your own bed',
    bedroll: 'in a bedroll',
    // An inn or a temple nobody holds (#2246).
    common: 'in an inn or temple bed nobody holds', commonfire: 'in an inn or temple bed by a fire'
  };

  /* The HUD's word for a temperature, the same steps as tempWord in hudScript. */
  function tempWord(v) {
    if (v < 15) { return 'Freezing'; }
    if (v < 30) { return 'Cold'; }
    if (v < 42) { return 'Chilly'; }
    if (v <= 58) { return 'Fine'; }
    if (v <= 70) { return 'Warm'; }
    if (v <= 85) { return 'Hot'; }
    return 'Burning';
  }

  function textView(actorId) {
    if (inCreation(actorId)) {
      return 'Your needs start once you leave the hall and arrive in your town.';
    }
    var v = view(actorId);
    var heading = (v.tempTarget > v.temp) ? ', warming toward ' + v.tempTarget
                : (v.tempTarget < v.temp) ? ', cooling toward ' + v.tempTarget : '';
    var rest = v.resting ? ' You are resting, ' + (REST_SAID[v.resting] || v.resting) + '.' : '';
    return 'Hunger ' + v.food + '% (' + v.foodBand + '), Thirst ' + v.drink + '% (' + v.drinkBand +
           '), Rest ' + v.rest + '% (' + v.restBand + '), Temp ' + tempWord(v.temp) + ' ' + v.temp +
           heading + '.' + rest + ' The Body page on K says what sets each one.';
  }

  /*
    Where somebody is standing, as far as temperature cares.

    The SERVER CANNOT KNOW THIS. Whether it is snowing on you, whether you are
    in the water and whether there is a fire in front of you are all facts
    about the machine drawing the world, so the client reports them the same
    way it reports each fall of an axe. An unknown word is comfortable rather
    than refused: a client from before this existed says nothing at all and its
    owner simply has no weather.
  */
  function place(actorId, kind, skyHex, night, roof, height, fireAway) {
    kind = String(kind || '').toLowerCase();
    if (kind && typeof NEEDS.place[kind] !== 'number') { return ''; }
    /*
      SETTLE FIRST, THEN CHANGE IT.

      The meter is worked out from elapsed time against the LAST place, so the
      time somebody spent outdoors has to be banked before they are marked as
      indoors. Moving the field first would retroactively apply the new place
      to the whole time they were standing somewhere else.
    */
    var n = settle(actorId);
    var sky = (skyHex && skyHex !== '-') ? String(skyHex).toLowerCase() : '';
    var isNight = String(night) === '1';
    var hasRoof = String(roof) === '1';
    var high = Number(height);
    if (!isFinite(high)) { high = 0; }
    // '-' or nothing means no fire in reach, which is not the same as a fire
    // at zero units.
    var away = (fireAway === undefined || fireAway === null || fireAway === '-')
      ? -1 : Number(fireAway);
    if (!isFinite(away)) { away = -1; }
    try {
      var Ssn = g.__thornswoodSeason;
      if (Ssn && Ssn.skyAdjust) {
        var rolled = Ssn.skyAdjust(actorId, {
          place: kind, roof: hasRoof, high: high, sky: sky
        });
        if (rolled) {
          if (rolled.sky) { sky = rolled.sky; }
          if (rolled.place) { kind = rolled.place; }
        }
      }
    } catch (eSky) { }
    if (n.place === kind && n.sky === sky && !!n.night === isNight &&
        !!n.roof === hasRoof && n.high === high && n.fire === away) {
      boilSay(actorId, n);
      return '';
    }
    moveTo(actorId, n, kind, sky);
    n.night = isNight;
    n.roof = hasRoof;
    n.high = high;
    n.fire = away;
    write(actorId, n);
    // A boil under way finishes, or is lost, on what the client just said
    // about the fire (#1382).
    boilSay(actorId, n);
    // Nothing said for the change itself. Walking indoors is not news; the
    // band crossing that follows it is, and the tick says that.
    return '';
  }

  /*
    THE PLACE AND THE SKY CHANGE HERE, AND ONLY HERE (#3136), on a record
    already settled up to now: place() for what the client says, and the
    tick for a new roll of the sky (the season block's skyAdjust). The record
    is changed and not written; the caller writes it.

    Leaving the rain or the water starts the 3 minutes of wet, from what
    that place was worth with its water (#1382). Going back in ends them.

    Until #3136 the tick changed the place itself, before settling, so the
    stretch since the last settle was charged at the new place, and a roll
    that took the rain away dried somebody at once, with no 3 minutes.
  */
  function moveTo(actorId, n, kind, sky) {
    var wasWet = !!NEEDS.wetPlaces[n.place], nowWet = !!NEEDS.wetPlaces[kind];
    if (wasWet && !nowWet) {
      n.wetFrom = Date.now();
      n.wetPlace = NEEDS.place[n.place] + waterKind(actorId, n);
    } else if (nowWet) {
      n.wetFrom = 0;
      n.wetPlace = null;
    }
    n.place = kind;
    n.sky = sky;
  }

  // ------------------------------------------------------------ the water --
  /*
    COLLECT, BOIL, DRINK (#1382). The game cannot write where water came from
    on a bottle, so the server keeps it: how many bottles from each source
    somebody carries, on the needs record. A bottle bought at an inn was never
    counted here, so it is safe, which is what drink.md says an inn is.
  */
  function waterOwn(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  function waterHeld(v) {
    var out = {};
    if (!v || typeof v !== 'object') { return out; }
    for (var k in NEEDS.waterSource) {
      if (!waterOwn(NEEDS.waterSource, k) || !waterOwn(v, k)) { continue; }
      var c = Math.floor(Number(v[k]) || 0);
      if (c > 0) { out[k] = c; }
    }
    return out;
  }

  function wellsUsed(v) {
    var out = {};
    if (!v || typeof v !== 'object') { return out; }
    var keep = Date.now() - NEEDS.wellCooldownMinutes * 60000;
    for (var k in v) {
      if (waterOwn(v, k) && typeof v[k] === 'number' && v[k] > keep) { out[k] = v[k]; }
    }
    return out;
  }

  var waterIds = null;
  function waterId(which) {
    if (!waterIds) {
      waterIds = {};
      try { waterIds.empty = idOf(NEEDS.waterItems.empty) || 0; } catch (e) { waterIds.empty = 0; }
      try { waterIds.full = idOf(NEEDS.waterItems.full) || 0; } catch (e) { waterIds.full = 0; }
    }
    return waterIds[which] || 0;
  }
  function isWaterItem(baseId) { return !!baseId && baseId === waterId('full'); }

  function nearFire(n) {
    var d = Number(n && n.fire);
    return isFinite(d) && d >= 0 && d < (NEEDS.fire.reach || 1);
  }

  function unboiledHeld(n) {
    var c = 0;
    for (var i = 0; i < NEEDS.unboiled.length; i++) { c += (n.water && n.water[NEEDS.unboiled[i]]) || 0; }
    return c;
  }

  /*
    Fill one empty bottle at a well somebody activated. wellKey is the
    activated reference, so the cooldown is per well and per person.
  */
  function fillAtWell(actorId, wellKey) {
    var n = settle(actorId);
    if (waterOwn(n.wellAt, wellKey)) {
      var left = Math.ceil((n.wellAt[wellKey] + NEEDS.wellCooldownMinutes * 60000 - Date.now()) / 60000);
      return 'You have drawn from this well today. Try another well, or wait ' +
             left + (left === 1 ? ' minute.' : ' minutes.');
    }
    var refused = fillBottle(actorId);
    if (refused !== null) { return refused; }
    n.water.well = (n.water.well || 0) + 1;
    n.wellAt[wellKey] = Date.now();
    write(actorId, n);
    return 'You fill a bottle at the well. The water is clean.';
  }

  /*
    An empty bottle swapped for a full one. Answers null when it filled, else
    what to tell them, '' when the bottles are not known at all.
  */
  function fillBottle(actorId) {
    var empty = waterId('empty'), full = waterId('full');
    if (!empty || !full) { return ''; }
    if (typeof takeItemById !== 'function' || !takeItemById(actorId, empty, 1)) {
      return 'You need an empty bottle to draw water.';
    }
    if (typeof addItem !== 'function' || !addItem(actorId, NEEDS.waterItems.full, 1)) {
      if (typeof addItem === 'function') { addItem(actorId, NEEDS.waterItems.empty, 1); }
      return 'The bottle would not fill.';
    }
    return null;
  }

  // At the water bucket by a river or a lake (#1382): river water, to boil.
  function fillAtRiver(actorId) {
    var n = settle(actorId);
    var refused = fillBottle(actorId);
    if (refused !== null) { return refused; }
    n.water.river = (n.water.river || 0) + 1;
    write(actorId, n);
    return 'You fill a bottle from the water. Boil it before you drink it.';
  }

  /*
    Something was activated (mp.onActivate). A well activator fills a bottle;
    a cooking spot starts boiling whatever unboiled water is carried. Answers
    a line, or '' when this press is none of the water's business. Never
    refuses anything: the cooking menu opens the way it always has.
  */
  function activatedWater(actorId, refrDesc, baseDesc, benchKeyword) {
    if (baseDesc && NEEDS.wellActivators.indexOf(baseDesc) !== -1) {
      return fillAtWell(actorId, String(refrDesc || baseDesc));
    }
    if (baseDesc && NEEDS.riverActivators.indexOf(baseDesc) !== -1) {
      return fillAtRiver(actorId);
    }
    if (benchKeyword && benchKeyword === NEEDS.cookKeyword) {
      var n = settle(actorId);
      if (!unboiledHeld(n) || typeof n.boilFrom === 'number') { return ''; }
      n.boilFrom = Date.now();
      n.boilFire = nearFire(n);
      write(actorId, n);
      return 'You set your water over the fire. Stay by it for a minute.';
    }
    return '';
  }

  // A boil under way: done after a minute at the fire, lost if they left it.
  // Writes and answers a line when something changed, or ''.
  function boilCheck(actorId, n) {
    if (typeof n.boilFrom !== 'number') { return ''; }
    if (n.boilFire && !nearFire(n)) {
      n.boilFrom = null;
      n.boilFire = false;
      write(actorId, n);
      return 'You left the fire, and the water did not boil.';
    }
    if (Date.now() - n.boilFrom < NEEDS.boilSeconds * 1000) { return ''; }
    var moved = unboiledHeld(n);
    for (var i = 0; i < NEEDS.unboiled.length; i++) { delete n.water[NEEDS.unboiled[i]]; }
    if (moved) { n.water.boiled = (n.water.boiled || 0) + moved; }
    n.boilFrom = null;
    n.boilFire = false;
    write(actorId, n);
    // A hair dye's steep can have spent the last unboiled bottle first
    // (#2675): with nothing boiled there is nothing to say.
    return moved ? 'The water has boiled. It is safe to drink.' : '';
  }

  /*
    EVERYTHING AT THE FIRE, in one order, wherever it is settled from (#2675):
    a hair dye steeping there first, then the boil. The steep spends its
    bottle through spendWater, which writes the record, so the boil reads the
    record again rather than writing back the one it was handed. Answers the
    lines and the record as it now is. boilSay and a drink both come here, so
    a drink before the next place report cannot boil the bottle a finished
    steep was about to take.
  */
  function fireSettle(actorId, n) {
    var lines = [];
    var D = g.__thornswoodHairDye;
    if (D && D.fireCheck) {
      var dyeLine = '';
      try { dyeLine = D.fireCheck(actorId, nearFire(n)) || ''; } catch (eDye) { log('the hair dye steep threw:', eDye); }
      if (dyeLine) { lines.push(dyeLine); n = settle(actorId); }
    }
    var line = boilCheck(actorId, n);
    if (line) { lines.push(line); }
    return { lines: lines, n: n };
  }

  function boilSay(actorId, n) {
    var lines = fireSettle(actorId, n).lines;
    for (var i = 0; i < lines.length; i++) {
      if (typeof say === 'function') { try { say(actorId, lines[i]); } catch (e) { } }
    }
    return lines.join(' ');
  }

  /*
    ONE BOTTLE OUT OF THE LEDGER, by the rule a drink uses: the worst source
    carried first, never a guess in anybody's favour. Answers the source, or
    'safe' for a bottle the ledger never counted (an inn's). A drink and a
    hair dye's steep (#2675) both spend through here, so the count of bottles
    by source stays the count of bottles carried.
  */
  function spendBottle(n) {
    for (var i = 0; i < NEEDS.waterOrder.length; i++) {
      var src = NEEDS.waterOrder[i];
      if (n.water[src] > 0) {
        n.water[src]--;
        if (!n.water[src]) { delete n.water[src]; }
        return src;
      }
    }
    return 'safe';
  }

  /* Bottles of water used up by something other than a drink (#2675). */
  function spendWater(actorId, count) {
    var n = settle(actorId);
    var k = Math.max(0, Math.floor(Number(count) || 0));
    var spent = [];
    for (var i = 0; i < k; i++) { spent.push(spendBottle(n)); }
    if (k) { write(actorId, n); }
    return spent;
  }

  /* Whether the client last said a fire is in reach, without settling (#2675). */
  function fireNear(actorId) { return nearFire(read(actorId)); }

  function drankWater(actorId) {
    var atFire = fireSettle(actorId, settle(actorId));
    var n = atFire.n;
    var first = atFire.lines.join(' ');
    var src = spendBottle(n);
    if (src !== 'safe') { write(actorId, n); }
    var row = NEEDS.waterSource[src];
    var line = ate(actorId, 'drink', row.thirst);
    if (row.fouled) {
      var H = g.__thornswoodHurt;
      if (H && H.exposed) { H.exposed(actorId, 'fouled', row.fouled); }
    }
    var said = row.fouled ? 'The water tastes of where it came from.' : 'Clean water.';
    return [first, said, line].filter(function (x) { return !!x; }).join(' ');
  }

  // ------------------------------------------------------------ the verbs --

  /** Something was eaten or drunk. Answers a line worth saying, or ''. */
  function ate(actorId, kind, amount) {
    var n = settle(actorId);
    var was = { food: bandOf(n.food), drink: bandOf(n.drink), rest: bandOf(n.rest) };
    if (kind === 'ale') {
      n.drink = clamp(n.drink + NEEDS.ale.drink);
      n.rest = clamp(n.rest + NEEDS.ale.rest);
    } else if (kind === 'drink') {
      n.drink = clamp(n.drink + (Number(amount) || NEEDS.drink.def));
    } else {
      return meal(actorId, { food: amount }).line;
    }
    write(actorId, n);
    return crossed(actorId, was, n);
  }

  /*
    A MEAL, ALL OF IT IN ONE PLACE (#1382). docs/systems/food.md: "Eating
    takes 8 seconds. Another meal in that window does nothing. At 90 hunger
    or above, another meal does not raise the meter and starts food sickness
    instead." row is what the meal is worth: food, and for a group a soup's
    drink or raw meat's sick. A meal refused inside the 8 seconds gives
    nothing at all, so a soup's thirst and raw meat's risk are decided here
    with the hunger rather than after it. Answers { taken, full, line }: taken
    is false only inside the 8 seconds, and full is true when the meal sat
    badly on a full stomach and raised nothing.
  */
  function meal(actorId, row) {
    var n = settle(actorId);
    var was = { food: bandOf(n.food), drink: bandOf(n.drink), rest: bandOf(n.rest) };
    var ateAt = Date.now();
    if (n.eatUntil && ateAt < n.eatUntil) { return { taken: false, line: '' }; }
    n.eatUntil = ateAt + NEEDS.meal.eatSeconds * 1000;
    var hurt = g.__thornswoodHurt;
    if (n.food >= NEEDS.meal.fullAt) {
      // Full: the meter does not rise, and the meal starts food sickness.
      write(actorId, n);
      if (hurt && hurt.exposed) { hurt.exposed(actorId, 'food', 'full'); }
      return { taken: true, full: true, line: 'You are already full. It sits badly.' };
    }
    // A row's food of 0 is no hunger at all (spoiled food, #3163), not the default.
    n.food = clamp(n.food + (row.food === 0 ? 0 : (Number(row.food) || NEEDS.food.def)));
    if (row.drink) { n.drink = clamp(n.drink + Number(row.drink)); }
    write(actorId, n);
    if (row.sick && hurt && hurt.exposed) { hurt.exposed(actorId, 'food', row.sick); }
    return { taken: true, line: crossed(actorId, was, n) };
  }

  /*
    A drug went down (#1382): the window starts again from now, and one more
    crash is owed when it ends. See NEEDS.drug.
  */
  function dosed(actorId) {
    var n = settle(actorId);
    var now = Date.now();
    n.drugUntil = now + NEEDS.drug.holdMinutes * 60000;
    n.drugCrash = (Number(n.drugCrash) || 0) + 1;
    // Counted toward withdrawal (#3153).
    n.doses = dosesOfDay(n.doses, now).concat([now]);
    n.look = lookNow(n, now);
    n.drugged = true;
    write(actorId, n);
  }

  /*
    THE DOSES OF THE LAST DAY (#3153): when each went down, in order, the ones
    older than NEEDS.drug.withdrawal.dayHours before now let go. Kept on the
    needs record so a withdrawal is counted across logins.
  */
  function dosesOfDay(list, now) {
    var from = now - NEEDS.drug.withdrawal.dayHours * 3600000;
    var out = [];
    if (!Array.isArray(list)) { return out; }
    for (var i = 0; i < list.length; i++) {
      var t = Number(list[i]);
      if (t > from && t <= now) { out.push(t); }
    }
    return out;
  }

  /* The doses as stored, numbers only: dosed() is what lets old ones go. */
  function dosesKept(list) {
    var out = [];
    if (!Array.isArray(list)) { return out; }
    for (var i = 0; i < list.length; i++) {
      var t = Number(list[i]);
      if (t > 0 && isFinite(t)) { out.push(t); }
    }
    return out;
  }

  /* How many of the doses fall in the day that ends with the last one. */
  function usesOfDay(list) {
    if (!list || !list.length) { return 0; }
    var last = list[list.length - 1];
    var from = last - NEEDS.drug.withdrawal.dayHours * 3600000;
    var count = 0;
    for (var i = 0; i < list.length; i++) { if (list[i] > from) { count++; } }
    return count;
  }

  /*
    WHAT THE SCREEN SHOWS (#3153). Patrick, 22 Oct 2026: "I also want visual
    affects" for drunk, high, hangover and withdrawal. One at a time, because
    Skyrim keeps one cross fade modifier: the high over being drunk, because
    it is the shorter and sharper of the two and the drunk is still there
    when it ends, and either of those over an after-effect. The HUD script
    hands the word to the front plugin, which draws the content plugin's
    record for it.
  */
  function lookNow(n, now) {
    if (n.drugUntil > now) { return 'high'; }
    if (n.drunk) { return 'drunk'; }
    if (n.withdrawalUntil > now) { return 'withdrawal'; }
    if (n.hangoverUntil > now) { return 'hangover'; }
    return '';
  }

  /*
    DRUNK (#1382): the third ale or more, and the last still counting. See
    NEEDS.ale.drunkFrom.
  */
  function drunkNow(n, now) {
    return (Number(n.ale) || 0) >= NEEDS.ale.drunkFrom && typeof n.aleAt === 'number' &&
      (now - n.aleAt) <= NEEDS.ale.sober * 60000;
  }

  /*
    A tea went down (#1382): the same, with the tea's own window and crash.
    See NEEDS.tea.
  */
  function steeped(actorId) {
    var n = settle(actorId);
    n.teaUntil = Date.now() + NEEDS.tea.holdMinutes * 60000;
    n.teaCrash = (Number(n.teaCrash) || 0) + 1;
    write(actorId, n);
  }

  /*
    A REMEDY ENDS A HANGOVER (#1382). docs/systems/drink.md: hung over "until
    you sleep or drink a remedy an alchemist made". The remedy an alchemist
    makes is the Physicker's Remedy, used from the wounds panel, so the
    panel asks here whether there is a hangover to clear and clears it.
  */
  function hungOver(actorId) {
    var n = read(actorId);
    return !!(n && n.hangoverUntil > Date.now());
  }

  function soberUp(actorId) {
    var n = settle(actorId);
    var now = Date.now();
    if (!(n.hangoverUntil > now)) { return false; }
    n.hangoverUntil = 0;
    n.look = lookNow(n, now);
    write(actorId, n);
    pushEffects(actorId);
    hangoverCare(actorId);
    return true;
  }

  /* The injury block's line and look prompt row, for a hangover (careOf). */
  function hangoverCare(actorId) {
    var hurtC = g.__thornswoodHurt;
    if (hurtC && hurtC.careChanged) { hurtC.careChanged(actorId); }
  }

  /** Sitting down, or getting up. kind is '' to stop. */
  function resting(actorId, kind) {
    var n = settle(actorId);
    kind = String(kind || '');
    if (kind && !NEEDS.recover[kind]) { return ''; }
    if (n.resting === kind) { return ''; }
    n.resting = kind;
    write(actorId, n);
    if (!kind) { return ''; }
    var extra = bardNear(actorId) ? ' The music helps.' : '';
    return 'You settle down to rest.' + extra;
  }

  /*
    A piece of work was done, so it costs rest. See NEEDS.work.

    BY THE RANK OF THE WORK (#4955). professions.md: "A swing of your own
    work also costs rest, by the rank you are climbing". key is what the work
    was counted under, the same key creditWork hands the rules (a class verb
    such as 'mine', a class, a half or a school), and the cost is the rank
    held in that one. It used to walk every rank the character held and
    charge the highest, so a Master Miner working their novice half paid the
    master's 0.6 rather than 1.5. Work in something they hold no rank in is
    novice work.

    Answers a line when the cost crossed a band, because getting tired enough
    to matter is worth being told about and every swing before that is not.
  */
  function worked(actorId, key) {
    var n = settle(actorId);
    var was = { food: bandOf(n.food), drink: bandOf(n.drink), rest: bandOf(n.rest),
                temp: tempBand(n.temp).name };
    var rank = 'novice';
    var P = g.__thornswoodProgression;
    var C = g.__thornswoodCharacter;
    if (P && C && C.stateOf && key) {
      var s = C.stateOf(actorId);
      var held = s ? P.rankOf(s, P.classFor(key) || key) : null;
      if (held) { rank = held; }
    }
    var cost = NEEDS.work[rank];
    if (typeof cost !== 'number') { cost = NEEDS.work.novice; }
    n.rest = clamp(n.rest - cost);
    n.worked = Date.now();
    write(actorId, n);
    return crossed(actorId, was, n);
  }

  /** The server saw them playing. See bardNear and bardSeen. */
  function bard(actorId) {
    BARDS[actorId] = Date.now();
  }

  /*
    They logged out in a bed, so they come back rested. Blade's bonus, and
    exhaustion.md: "Logging out in a real bed fills rest to 100 when you come
    back, and puts 25 back on hunger and on thirst."

    Called by settle at somebody's arrival (see here, above settle), on the
    meters it has just brought up to now and with how long they were away.
    What a night gives is NEEDS.away's row for where they were resting when
    they were last seen (#2246), and it counts when they were away at least
    NEEDS.sleptFor. Answers the line to say, or ''. n is changed in place and
    settle writes it.

    The time away is settled first, the ordinary way: hunger and thirst fell
    while they were gone and the 25 is put back on what is left, as the page
    says. The first version of this read the meters without settling them, so
    a night away would have cost no hunger at all.

    #1606: this was written and exported and nothing ever called it. Its
    comment named the character block's first sight of somebody as the
    caller, and that call was never written; the first commit of this
    repository already has it without one.
  */
  function arrived(actorId, n, away) {
    if (!(away >= NEEDS.sleptFor)) { return ''; }
    var row = awayRow(n.resting);
    var rest = Number(row.rest) || 0, food = Number(row.food) || 0, drink = Number(row.drink) || 0;
    if (!(rest > 0) && !(food > 0) && !(drink > 0)) { return ''; }
    if (n.rest < rest) { n.rest = clamp(rest); }
    n.food = clamp(n.food + food);
    n.drink = clamp(n.drink + drink);
    n.resting = '';
    return n.rest >= 100 ? 'You slept well. You are rested.' : 'You slept, though not well.';
  }

  /*
    A meter after the time away: down by what the clock took, and never under
    the row's floor unless it was already there (#2246).
  */
  function awayDrain(v, took, floor) {
    var after = clamp(v - took);
    if (floor > 0 && v > floor && after < floor) { after = floor; }
    return v <= floor ? clamp(v) : after;
  }

  /*
    NEEDS.away's row for a kind of rest, or up for somebody who was resting
    nowhere. A kind the table does not name (#1392's bedroll) is up: it was
    never given anything for the time away.
  */
  function awayRow(kind) {
    kind = String(kind || '');
    if (kind && Object.prototype.hasOwnProperty.call(NEEDS.away, kind)) { return NEEDS.away[kind]; }
    return NEEDS.away.up;
  }

  /*
    What logging out now would do, in words, for the Body page on K (#2246).
    Worked out from the same NEEDS.away row that settle and arrived read at
    the arrival, so a change of numbers changes the page with it.
  */
  function awayWords(kind) {
    var row = awayRow(kind);
    var drain = Number(row.drain), floor = Number(row.floor) || 0;
    if (!(drain >= 0)) { drain = 1; }
    var words;
    if (drain <= 0) {
      words = 'Log out now and nothing runs down while you are away.';
    } else {
      words = 'Log out now and hunger, thirst and rest fall at ' +
        (drain >= 1 ? 'the full pace' : (drain === 0.5 ? 'half the pace' : Math.round(drain * 100) + ' per cent of the pace')) +
        ' while you are away' +
        (floor > 0 ? ', and the time away takes none of them below ' + floor + '.' : '.');
    }
    var rest = Number(row.rest) || 0, food = Number(row.food) || 0, drink = Number(row.drink) || 0;
    var gives = [];
    if (rest >= 100) { gives.push('rest is full'); } else if (rest > 0) { gives.push('rest is at least ' + rest); }
    if (food > 0 && food === drink) { gives.push(food + ' goes back on hunger and thirst'); }
    else {
      if (food > 0) { gives.push(food + ' goes back on hunger'); }
      if (drink > 0) { gives.push(drink + ' goes back on thirst'); }
    }
    if (gives.length) {
      words += ' Away ' + Math.round(NEEDS.sleptFor / 60000) + ' minutes or more and ' +
        gives.join(' and ') + ' when you come back.';
    }
    return words;
  }

  /** Too tired to make anything. See CRAFT_REST. */
  function tooTiredToCraft(actorId) {
    var n = settle(actorId);
    return n.rest < CRAFT_REST;
  }

  /*
    The line a craft is refused with when tooTiredToCraft says so, or ''
    (#1676). exhaustion.md: "Under 15, crafting is refused." Every way of
    making something asks this one: a bench's own menu (mp.onCraft), a key
    cut at a forge, and a kiln burned by pressing it. Mining, chopping,
    fishing and the other class verbs do not.
  */
  function craftRefusal(actorId) {
    if (!tooTiredToCraft(actorId)) { return ''; }
    return 'You are too tired to make anything: your Rest is under ' + CRAFT_REST + '. ' +
           'Sit down, or lie down in a bed, first.';
  }

  /*
    A band crossing is the only thing worth interrupting somebody for.

    The same rule the seam and the chopping block settled on: a line every time
    a number moves is a wall of text over the thing you are trying to watch. A
    meter that has dropped a band has changed what the character can do, and
    that is news; a meter that went from 61 to 60 is not.
  */
  /*
    ================= AND THE BAND HAS TO REACH THE CHARACTER ==============

    Patrick, 23 September: "I also don't think the different levels are
    actually doing any of the defects".

    He is right and the penalties were never the problem: TEMP_COST and COST
    are real and correct, and effects() adds them up properly. They ride to
    the client on the skills panel, because the client applies every actor
    value in panel.effects and a penalty is a negative number in the same
    map. And the panel is only written when the CHARACTER changes: a rank, a
    class, a point spent.

    Getting cold is not a character change. So somebody could walk from Fine
    into Weary, Bad and Spent and the numbers on their actor never moved,
    because nothing wrote the panel. The whole system was computed every
    twenty seconds and thrown away.

    So a band change asks the character block to redraw. It is the one call
    that exists for exactly this, it already holds back a write that would
    not change anything, and a band change is at most a handful of times an
    evening per person.
  */
  function pushEffects(actorId) {
    try {
      var c = g.__thornswoodCharacter;
      if (!c || !c.stateOf || !c.writeState) { return; }
      var s = c.stateOf(actorId);
      if (!s) { return; }
      // redraw, because the rules state has not changed and the panel
      // signature would hold the write back. What changed is underneath it.
      c.writeState(actorId, s, true);
    } catch (e) { }
  }

  function crossed(actorId, was, n) {
    var say = [];
    var now = { food: bandOf(n.food), drink: bandOf(n.drink), rest: bandOf(n.rest) };
    /*
      THE TEMPERATURE BAND IS IN HERE TOO, and it is the one that moves most.
      was.temp is undefined for a caller that did not measure it, and an
      undefined never equals a name, so the first tick after this shipped
      pushes once and then only on a real change.
    */
    var tempNow = tempBand(n.temp).name;
    var moved = (was.food !== now.food) || (was.drink !== now.drink) ||
                (was.rest !== now.rest) || (was.temp !== tempNow);
    if (moved) { pushEffects(actorId); }
    var words = {
      food: { weary: 'You are getting hungry.', bad: 'You are hungry.', spent: 'You are starving.', fine: 'You have eaten enough.' },
      drink: { weary: 'You are getting thirsty.', bad: 'You are thirsty.', spent: 'You are parched.', fine: 'Your thirst is gone.' },
      rest: { weary: 'You are tiring.', bad: 'You are tired.', spent: 'You are exhausted.', fine: 'You feel rested.' }
    };
    var order = ['fine', 'weary', 'bad', 'spent'];
    for (var k in words) {
      if (!Object.prototype.hasOwnProperty.call(words, k)) { continue; }
      if (was[k] === now[k]) { continue; }
      // Only say it when it got worse, or when it came all the way back to
      // fine. Every step of recovery is a sentence nobody asked for.
      if (order.indexOf(now[k]) > order.indexOf(was[k]) || now[k] === 'fine') {
        say.push(words[k][now[k]]);
      }
    }
    return say.join(' ');
  }

  // --------------------------------------------------------------- the tick

  /*
    Every twenty seconds, for everybody online.

    The meters do not need this: settle works the arithmetic out from elapsed
    time whenever anybody asks. What this is for is NOTICING, so somebody who
    has been standing still for an hour is told they are hungry rather than
    finding out when they next open the panel.

    IT IS ALSO WHAT REDRAWS THE HUD, which is why it used to be a minute and is
    not any more. settle is the only thing that writes the property the HUD
    reads, so at a minute the temperature number moved once a minute: walk up
    to a fire and the screen sits there saying Fine 50 for the best part of a
    minute before anything happens, which reads as broken whatever the
    arithmetic is doing underneath. Twenty seconds is three reads per person
    per minute and the bar visibly climbs.
  */
  var TICK_MS = 20000;

  function tick() {
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return; }
    // Whoever has left arrives again at their next settle (#1606).
    for (var h in here) {
      if (Object.prototype.hasOwnProperty.call(here, h) && online.indexOf(Number(h)) === -1) {
        delete here[h];
      }
    }
    bardSeen(online);
    for (var i = 0; i < online.length; i++) {
      var who = online[i];
      try {
        var before = read(who);
        if (!before) { settle(who); continue; }
        var was = { food: bandOf(before.food), drink: bandOf(before.drink),
                    rest: bandOf(before.rest), temp: tempBand(before.temp).name };
        // Settled first, at the place the time was spent in, and then the
        // sky's new roll moves them (#3136). See moveTo.
        var n = settle(who, Date.now());
        try {
          var Ssn = g.__thornswoodSeason;
          if (Ssn && Ssn.skyAdjust) {
            var rolled = Ssn.skyAdjust(who, n);
            var toSky = (rolled && rolled.sky) ? rolled.sky : n.sky;
            var toPlace = (rolled && rolled.place) ? rolled.place : n.place;
            if (rolled && (toSky !== n.sky || toPlace !== n.place)) {
              moveTo(who, n, toPlace, toSky);
              write(who, n);
            }
          }
        } catch (eSky) { }
        // The ale help running out changes the character, not a band (#1382).
        if (n.aleHelpUntil && Date.now() >= n.aleHelpUntil) {
          n.aleHelpUntil = 0;
          write(who, n);
          pushEffects(who);
        }
        // And a cooked meal's help running out (#2682).
        if (n.mealHelpUntil && Date.now() >= n.mealHelpUntil) {
          n.mealHelp = '';
          n.mealHelpUntil = 0;
          n.mealFeast = false;
          write(who, n);
          pushEffects(who);
        }
        // And a burnt meal's slow stamina (#2906).
        if (n.burntUntil && Date.now() >= n.burntUntil) {
          n.burntUntil = 0;
          write(who, n);
          pushEffects(who);
        }
        // And a hangover or withdrawal running out (#3153). A hangover over
        // is also nothing left for a remedy to tend.
        if (n.hangoverUntil && Date.now() >= n.hangoverUntil) {
          n.hangoverUntil = 0;
          write(who, n);
          pushEffects(who);
          hangoverCare(who);
        }
        if (n.withdrawalUntil && Date.now() >= n.withdrawalUntil) {
          n.withdrawalUntil = 0;
          write(who, n);
          pushEffects(who);
        }
        var line = crossed(who, was, n);
        if (line) {
          try { notify(who, line); } catch (e) { }
          try { say(who, line); } catch (e) { }
        }
      } catch (e) { }
    }
  }

  /*
    ===================== THE FOUR BARS ON SCREEN, AND WHY THEY ARE HERE =====

    Patrick, 22 September: "There is no indicator for the hunger food or
    exhasution on screen", and then "the temp stuff should also have a hud
    element".

    He is right and a meter nobody can see is only a punishment: you start
    missing swings and nothing on the screen says why.

    IT BUILDS ITSELF AND NEEDS NO SHIP. This is an updateOwner script, so it
    travels with the gamemode: deploying the server puts the HUD on everybody
    without a launcher release or a new overlay file. It creates its own
    element in the overlay document and calls into no page, so a client whose
    overlay predates this still draws it.

    EDGE TRIGGERED ON A SIGNATURE, not on the raw value. updateOwner runs
    EVERY FRAME (see the note over SWING_PROPERTY), and these numbers move
    continuously, so a naive script would rebuild the HTML sixty times a
    second forever. The signature is the ROUNDED numbers and the bands, so it
    changes about once a minute and costs one string compare the rest of the
    time.

    QUIET WHEN THERE IS NOTHING TO SAY. A bar that is fine is dimmed almost to
    nothing; the HUD only draws attention when something is actually wrong.
    Four bars shouting all the time is four bars nobody reads.
  */
  /*
    THE HTML IS BUILT HERE, NOT IN THE BROWSER, and that is the important
    choice in this function.

    An updateOwner script is JavaScript that runs on the client, so it can do
    the work itself and hand the overlay one finished string. The first
    version built the markup inside a string inside a string, four levels of
    quoting deep, which is unreadable and is exactly where this kind of code
    breaks silently. Now there is one level and JSON.stringify does all of it.

    THE ICONS ARE INLINE SVG for the same reason the HUD builds its own
    element: no file has to be shipped, no path has to resolve, and a client
    that has never seen this before draws it correctly the first time.
  */
  function hudScript() {
    /*
      BIGGER, SOLID, AND ON A BACKING, because the first version could not be
      read.

      Patrick, 23 September, looking at it in a night scene: "the indicators
      are too small and hard to see with the color they are", "that's all
      trasparent", "the water drop icon for water its like purple and not
      blue".

      Three separate mistakes, all mine. The text was 12px with 96px bars. The
      healthy state was drawn at 0.38 opacity, which is almost nothing over a
      dark scene and is where the washed out colours came from: a blue at a
      third opacity over near black is not blue any more. And there was no
      backing at all, so every colour was fighting whatever happened to be
      behind it.

      So: half again the size, a dark panel behind it, and opacity that never
      goes below readable. Quiet is done with COLOUR now, not by fading the
      whole row out, which was the thing that made it unreadable.

      AND HALF AGAIN ON TOP OF THAT. Patrick, looking at the 15px version on
      his own screen, 23 September: "The indicator area is still to small it
      all needs to be like 1.5x the current size". So every measurement in
      here is the 15px one multiplied by 1.5 and rounded: text 22px, bars
      198x16, icons 28px, and the padding and gaps to match. The anchor stays
      where it is, because the panel grows up and to the right from the bottom
      left corner and moving it would only push it into the compass.

      ONE STRIP UNDER THE BARS, SIZED BY THE HUD (#2247). Djinn on dev,
      26 September: "The survival UI box blocks the magicka bar. It needs to
      be resized and moved." It did: four rows of 22px, about 514 by 193
      pixels at 1920x1080 from the bottom left corner, and the bars people
      see sit right there. Measured on 11 Oct from the collection's own
      files, not guessed:

        TrueHUD's player widget is on and hides the game's own three bars
        (Data\MCM\Config\TrueHUD\settings.ini: bEnablePlayerWidget 1,
        bPlayerWidgetHideVanillaBars 1, not combined, bar width 245). Its
        movie is 1280x720 (TrueHUD.swf's header), shown whole and centred
        (BSScaleformManager's default, kShowAll), and TrueHUD places each bar
        at that stage size times the setting (PlayerWidget.cpp LoadConfig,
        TrueHUD_PlayerWidget.as): magicka from x 84.5 to 329.5 centred on
        y 676.8, health centred on x 640, stamina ending at x 1195.5, all at
        y 676.8, and the enchantment charge meter centred on 640, 698.4. A
        bar's frame is 18 high and its flash 19.2 (LargeBarFrame and
        LargeBarOutlineFlashTexture in TrueHUD_Assets0.swf), so nothing of
        the three reaches below y 686.4, and the charge meter starts right
        of x 570.

        SkyHUD's hudmenu (SkyHUD.bsa, meters locked at the game's places,
        skyhud.txt) puts the game's own bars higher, between y 610 and 640
        (magicka x 118 to 411), with nothing of the HUD below 640 on the
        left. Those are what show if TrueHUD's widget is ever off.

      So the bars are one strip of four in the band below all of that: the
      stage's y 698 to 718, from x 10 to 550, which is clear of every bar
      either mod draws and of the charge meter. And every size is in the
      HUD's own pixels, --ts, which is the screen's height over 720 or its
      width over 1280, whichever is smaller (that is what kShowAll does), so
      the strip keeps the same place against the bars at 1280x720, 1080p,
      1440p, 4K, 16:10 and ultrawide. The row's words stay (Hunger, Thirst,
      Rest, Temp), smaller: 10 of the HUD's pixels, 15px at 1080p and 20px at
      1440p. tests\test-hud.js works the strip out at each of those screens
      against the measured bars.
    */
    var HUD_PX = 'min(0.078125vw,0.1388889vh)';
    var CSS = '--ts:' + HUD_PX + ';' +
              'position:fixed;left:calc(50vw - 630 * var(--ts));bottom:calc(50vh - 358 * var(--ts));' +
              'width:calc(540 * var(--ts));height:calc(20 * var(--ts));box-sizing:border-box;' +
              'display:flex;align-items:center;white-space:nowrap;z-index:2147483500;' +
              'pointer-events:none;font-family:Georgia,serif;font-size:calc(10 * var(--ts));' +
              'line-height:1;color:#efe4cc;' +
              'background:rgba(12,10,8,.62);border:calc(1 * var(--ts)) solid rgba(0,0,0,.65);' +
              'border-radius:calc(4 * var(--ts));padding:0 calc(2 * var(--ts));' +
              'text-shadow:0 1px 3px rgba(0,0,0,.95)';
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    if (!v || typeof v !== "object") { return; }',
      '    var st = ctx.state;',
      '    if (!st) { return; }',
      /*
        THE LOOK, HANDED TO THE FRONT PLUGIN (#1382, #3153): drunk, high,
        hangover, withdrawal or nothing (lookNow), and the plugin draws the
        screen effect for it. Edge triggered, and only marked as handed over
        once the plugin's hook is there to take it, so a hook that loads after
        this script first runs still gets told.
      */
      '    var look = v.creating ? "" : String(v.look || "");',
      '    if (st.thornswoodLook !== look && typeof globalThis !== "undefined" && globalThis.thornswoodLook) {',
      '      globalThis.thornswoodLook(look);',
      '      st.thornswoodLook = look;',
      '    }',
      /*
        IN CREATION THE BARS COME OFF, once, and stay off. settle() writes
        creating while the chargen stage is appearance or choosing. The
        signature is a word nothing else produces, so the first reading after
        the home is picked is different from it and draws the bars again.
      */
      '    if (v.creating) {',
      '      if (st.thornswoodHud === "creating") { return; }',
      '      st.thornswoodHud = "creating";',
      '      try { ctx.sp.browser.executeJavaScript("(function(){try{var d=document.getElementById(\'ts-hud\');if(d&&d.parentNode){d.parentNode.removeChild(d);}}catch(e){}})();"); } catch (e) { }',
      '      return;',
      '    }',
      // Rounded, because the raw numbers move every frame and the screen does
      // not. This is the whole of what stops a per-frame redraw.
      '    var food = Math.round(Number(v.food));',
      '    var drink = Math.round(Number(v.drink));',
      '    var rest = Math.round(Number(v.rest));',
      '    var temp = Math.round(Number(v.temp));',
      '    if (!isFinite(food) || !isFinite(drink) || !isFinite(rest)) { return; }',
      '    if (!isFinite(temp)) { temp = 50; }',
      /*
        DRUNK AND HIGH ARE IN THE SIGNATURE (#3143), so the icon comes and
        goes the moment either does, even when no meter moved.
      */
      '    var drunk = !!v.drunk;',
      '    var high = !!v.drugged;',
      '    var sig = food + "|" + drink + "|" + rest + "|" + temp + "|" + (drunk ? "d" : "") + (high ? "h" : "");',
      '    if (st.thornswoodHud === sig) { return; }',
      '    st.thornswoodHud = sig;',
      '',
      /*
      FOUR SHAPES THAT CANNOT BE MISTAKEN FOR EACH OTHER, which the first set
      could.

      Patrick: "why is temp a water drop and the food icon seems weird too".
      He was looking at a real bug. The old flame was
      "M10 18a5 5 0 0 0 5-5c0-4-5-11-5-11S5 9 5 13a5 5 0 0 0 5 5z" and the old
      droplet was "M10 2C10 2 4 9 4 12.5A6 6 0 0 0 16 12.5C16 9 10 2 10 2z":
      the same teardrop, one of them upside down. At fourteen pixels they were
      indistinguishable, so Temp genuinely did look like a second water drop.
      The drumstick was three disconnected strokes and read as nothing at all.

      An apple, a droplet, a crescent and a THERMOMETER now: four outlines
      with different silhouettes, which is the only property that matters at
      this size. The thermometer is also the right picture for a reading that
      goes both ways, where a flame could only ever mean hot.
    */
    '    var ICON = {',
      '      food: "M10 7c3.2 0 5.2 2.4 5.2 5.6 0 3.2-2.3 5.9-5.2 5.9s-5.2-2.7-5.2-5.9C4.8 9.4 6.8 7 10 7z M10 7V3.6 M10 4.6c1.6-1.4 3.2-1.4 4 -1.2 .2 1.4-.6 2.8-2.2 3.2",',
      '      drink: "M10 2.4c0 0-5.6 6.6-5.6 10A5.6 5.6 0 0 0 15.6 12.4C15.6 9 10 2.4 10 2.4z",',
      '      rest: "M15.2 12.9A6.4 6.4 0 1 1 7.4 5.1a5.3 5.3 0 0 0 7.8 7.8z",',
      '      temp: "M8.2 11.8V4.6a1.8 1.8 0 0 1 3.6 0v7.2a3.4 3.4 0 1 1-3.6 0z M10 7.4v5.4"',
      '    };',
      '',
      /*
        One row. The readout is given rather than worked out, because Temp's
        is a plain number and the other three are percentages.

        Nothing is dimmed below 0.85. Quiet is done with colour: a healthy bar
        is its own calm colour and a failing one turns red, which reads at a
        glance without making the whole row disappear.
      */
      // A size in the HUD's own pixels; see the note over CSS.
      '    function u(n) { return "calc(" + n + " * var(--ts))"; }',
      // Each word's own width, so the strip is 540 of the HUD's pixels every time.
      '    var LABEL_W = { food: 34, drink: 30, rest: 22, temp: 26 };',
      '    function row(kind, label, fill, col, readout) {',
      '      var pct = Math.max(0, Math.min(100, Math.round(fill)));',
      '      var svg = \'<svg viewBox="0 0 20 20" fill="none" \' +',
      '        \'stroke="\' + col + \'" stroke-width="1.9" stroke-linecap="round" \' +',
      '        \'stroke-linejoin="round" style="width:\' + u(12) + \';height:\' + u(12) + \';flex:none;margin-right:\' + u(3) + \'">\' +',
      '        \'<path d="\' + ICON[kind] + \'"/></svg>\';',
      '      var name = \'<span style="display:inline-block;flex:none;width:\' + u(LABEL_W[kind]) + \';margin-right:\' + u(3) + \'">\' + label + \'</span>\';',
      '      var track = \'<span style="display:inline-block;flex:none;width:\' + u(36) + \';height:\' + u(5) + \';\' +',
      '        \'background:rgba(0,0,0,.72);border:\' + u(1) + \' solid rgba(255,255,255,.22);\' +',
      '        \'border-radius:\' + u(2) + \';box-sizing:border-box;overflow:hidden">\' +',
      '        \'<span style="display:block;height:100%;width:\' + pct + \'%;\' +',
      '        \'background:\' + col + \'"></span></span>\';',
      // Wide enough for the longest readout there is, "Freezing 100", so the
      // strip does not change width every time the weather does.
      '      var num = \'<span style="display:inline-block;flex:none;width:\' + u(kind === "temp" ? 70 : 28) + \';margin-left:\' + u(4) + \';\' +',
      '        \'color:\' + col + \';font-variant-numeric:tabular-nums">\' + readout + \'</span>\';',
      '      return \'<div style="display:flex;align-items:center;flex:none;margin:0 \' + u(4.5) + \'">\' +',
      '             svg + name + track + num + \'</div>\';',
      '    }',
      '',
      /*
        A meter's colour by how bad it is. Its own colour while it is fine,
        amber once it matters, red once it is serious. This is what replaced
        fading the row out.
      */
      '    function tone(v, good) {',
      '      return v >= 50 ? good : (v >= 25 ? "#e0a040" : "#e0645a");',
      '    }',
      '',
      /*
        TEMPERATURE IS A NUMBER AND A COLOUR, NOT A PERCENTAGE.

        Patrick: "heat shouldnt be a percentage to it should be a number plus
        a color to reflect hot, cold, cmoftroable, anbd the ionbetweens", and
        "instead of heat it should say Temp".

        A percentage was the wrong shape twice over: it said 20% for freezing
        AND 20% for overheating, which are opposite states, and a percentage
        of what was never answerable. So the reading is the meter itself, 0 is
        frozen and 100 is baking, the bar fills left to right across that
        range, and the colour carries the meaning: blue cold, green
        comfortable, orange warm, red hot, with a step either side of comfort
        for the in betweens.
      */
      '    function tempTone(v) {',
      '      if (v < 15) { return "#5ab4ff"; }',
      '      if (v < 30) { return "#7fc7e8"; }',
      '      if (v < 42) { return "#a9d6c2"; }',
      '      if (v <= 58) { return "#8fb85e"; }',
      '      if (v <= 70) { return "#d8c15e"; }',
      '      if (v <= 85) { return "#e0a040"; }',
      '      return "#e0645a";',
      '    }',
      '    function tempWord(v) {',
      '      if (v < 15) { return "Freezing"; }',
      '      if (v < 30) { return "Cold"; }',
      '      if (v < 42) { return "Chilly"; }',
      '      if (v <= 58) { return "Fine"; }',
      '      if (v <= 70) { return "Warm"; }',
      '      if (v <= 85) { return "Hot"; }',
      '      return "Burning";',
      '    }',
      '',
      '    var html = row("food", "Hunger", food, tone(food, "#d8b43a"), food + "%") +',
      '               row("drink", "Thirst", drink, tone(drink, "#4fa8e0"), drink + "%") +',
      '               row("rest", "Rest", rest, tone(rest, "#8fb85e"), rest + "%") +',
      '               row("temp", "Temp", temp, tempTone(temp),',
      '                   tempWord(temp) + " " + temp);',
      '',
      /*
        DRUNK AND HIGH, AN ICON EACH, ONLY WHILE IT APPLIES (#3143).

        Patrick, 22 October, on his report page: "An icon that shows only
        while drunk or high", not a fifth bar. Drunk is the server's own
        answer (NEEDS.ale.drunkFrom, the third ale until a sleep or the 45
        minutes), and high is a drug's window being open (NEEDS.drug, the
        10 minutes skooma or any of the six drugs holds the rest drain at
        zero). Both ride on the needs record, so nothing is worked out here.

        A tankard for drunk and a four point star for high, in their own
        small panel sitting on the strip's left end. It has to sit there:
        the strip's 540 pixels are all used by the four rows (S3d), and the
        corner above the strip's left end, x 10 to 49 and y 679 to 697 of
        the HUD's pixels with both icons up, is left of TrueHUD's magicka
        bar (from x 64.5) and below SkyHUD's (to y 640), so it covers none
        of them. tests\test-hud.js works that out at every screen it knows.
        It is a child of the strip, so taking the strip off in creation takes
        it off too.
      */
      '    var MARK = {',
      '      drunk: "M5 7h8v8.6a1.6 1.6 0 0 1-1.6 1.6H6.6A1.6 1.6 0 0 1 5 15.6z M13 9h1.8a1.8 1.8 0 0 1 1.8 1.8v1.6a1.8 1.8 0 0 1-1.8 1.8H13 M4.8 7c-.3-1.7 1.1-3 2.6-2.6.7-1.3 2.8-1.5 3.6-.3 1.4-.4 2.7.7 2.4 2.9",',
      '      high: "M10 2.6l1.8 5.6 5.6 1.8-5.6 1.8L10 17.4l-1.8-5.6L2.6 10l5.6-1.8z"',
      '    };',
      '    var marks = [];',
      '    if (drunk) { marks.push(["drunk", "#e3b04b"]); }',
      '    if (high) { marks.push(["high", "#c58cf0"]); }',
      '    if (marks.length) {',
      '      var icons = "";',
      '      for (var m = 0; m < marks.length; m++) {',
      '        icons += \'<svg viewBox="0 0 20 20" fill="none" stroke="\' + marks[m][1] + \'" stroke-width="1.9" \' +',
      '          \'stroke-linecap="round" stroke-linejoin="round" style="width:\' + u(14) + \';height:\' + u(14) + \';flex:none;margin-left:\' + u(m ? 3 : 0) + \'">\' +',
      '          \'<path d="\' + MARK[marks[m][0]] + \'"/></svg>\';',
      '      }',
      '      html += \'<div id="ts-hud-marks" style="position:absolute;left:\' + u(-1) + \';bottom:calc(100% + 2 * var(--ts));\' +',
      '        \'width:\' + u(8 + marks.length * 14 + (marks.length - 1) * 3) + \';height:\' + u(18) + \';box-sizing:border-box;\' +',
      '        \'display:flex;align-items:center;padding:0 \' + u(3) + \';background:rgba(12,10,8,.62);\' +',
      '        \'border:\' + u(1) + \' solid rgba(0,0,0,.65);border-radius:\' + u(4) + \'">\' + icons + \'</div>\';',
      '    }',
      '',
      '    var src = "(function(){try{" +',
      '      "var d=document.getElementById(\'ts-hud\');" +',
      '      "if(!d){d=document.createElement(\'div\');d.id=\'ts-hud\';" +',
      '      "d.style.cssText=" + ' + JSON.stringify(JSON.stringify(CSS)) + ' + ";" +',
      '      "document.body.appendChild(d);}" +',
      '      "d.innerHTML=" + JSON.stringify(html) + ";" +',
      '      "}catch(e){}})();";',
      '    try { ctx.sp.browser.executeJavaScript(src); } catch (e) { }',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  /*
    =============== FIRE SPREADING FROM PERSON TO PERSON ====================

    Patrick, 23 September: "when people catch fire it should be able to spread
    to other people if they ade close enough".

    NEITHER END CAN DO THIS ALONE. The client knows it is standing in a fire
    and can set itself alight; it cannot see where anybody else is standing,
    because SkyMP's other people are actors it has no roster for. The server
    knows exactly where everybody is and cannot see a fire at all. So the
    client says "I am burning" over the chat socket, this finds the neighbours,
    and the property below tells their clients to catch.

    THE PROPERTY IS THE ONLY WAY TO REACH A CLIENT. There is no message type
    for "you are on fire", the same way there is none for "your pick broke",
    and an updateOwner script is the one channel that ships with the gamemode
    and needs no launcher release.
  */
  var BURN_PROPERTY = 'thornswoodBurn';
  var burning = {};        // actorId -> when they last said they were alight

  /** The client says it started or stopped burning. */
  function setBurning(actorId, on) {
    if (on) { burning[actorId] = Date.now(); }
    else { delete burning[actorId]; }
  }

  /** Tell one person's client to catch fire for a while. */
  function catchFire(actorId, ms, why) {
    try {
      mp.set(actorId, BURN_PROPERTY, {
        ms: Number(ms) || NEEDS.burn.catches,
        why: String(why || ''),
        at: Date.now()
      });
    } catch (e) { /* somebody without the property still has the fire itself */ }
  }

  function burnTick() {
    var now = Date.now();
    var alight = [];
    for (var id in burning) {
      if (!Object.prototype.hasOwnProperty.call(burning, id)) { continue; }
      // A client that stops reporting has gone, crashed or stopped burning
      // without saying so. Two of its own beats is enough to let go.
      if (now - burning[id] > NEEDS.burn.every * 3) { delete burning[id]; continue; }
      alight.push(Number(id));
    }
    if (!alight.length) { return; }

    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return; }
    if (online.length < 2) { return; }

    var reach = NEEDS.burn.spread * NEEDS.burn.spread;
    for (var i = 0; i < alight.length; i++) {
      var who = alight[i];
      var herePos = null, hereCell = '';
      try {
        herePos = mp.get(who, 'pos');
        hereCell = String(mp.get(who, 'worldOrCellDesc') || '');
      } catch (e) { continue; }
      if (!herePos) { continue; }
      for (var j = 0; j < online.length; j++) {
        var them = online[j];
        if (them === who) { continue; }
        // Already alight, so there is nothing to catch.
        if (burning[them]) { continue; }
        try {
          if (String(mp.get(them, 'worldOrCellDesc') || '') !== hereCell) { continue; }
          var p = mp.get(them, 'pos');
          if (!p) { continue; }
          var dx = p[0] - herePos[0], dy = p[1] - herePos[1], dz = p[2] - herePos[2];
          if ((dx * dx + dy * dy + dz * dz) > reach) { continue; }
        } catch (e) { continue; }
        catchFire(them, NEEDS.burn.catches, 'caught');
        nlog('fire spread from', who.toString(16), 'to', them.toString(16));
      }
    }
  }

  /*
    What a client does when it is told it caught fire.

    updateOwner runs EVERY FRAME (see the note over SWING_PROPERTY in this
    file), so this is edge triggered on the stamp like every other one: the
    same value twice is the same frame twice and does nothing.

    It calls into the plugin rather than doing the burning itself, because the
    plugin already owns the shader and the damage for standing in a fire and
    two things setting somebody alight independently would fight over turning
    it off. A client with no plugin still gets the corner message.
  */
  function burnScript() {
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    if (!v || !v.at) { return; }',
      '    var st = ctx.state;',
      '    if (!st) { return; }',
      '    if (st.thornswoodBurnAt === v.at) { return; }',
      '    st.thornswoodBurnAt = v.at;',
      '    var ms = Number(v.ms) || 5000;',
      '    try {',
      '      if (typeof globalThis !== "undefined" && globalThis.thornswoodCatchFire) {',
      '        globalThis.thornswoodCatchFire(ms);',
      '      }',
      '    } catch (e) { }',
      '    try { ctx.sp.Debug.notification("You have caught fire."); } catch (e) { }',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  try {
    mp.makeProperty(BURN_PROPERTY, {
      isVisibleByOwner: true,
      isVisibleByNeighbors: false,
      updateOwner: burnScript(),
      updateNeighbor: ''
    });
  } catch (e) {
    // Already made by a previous load. The script cannot be changed after the
    // fact, so a changed one needs a restart, which a deploy is.
  }

  if (g.__thornswoodBurnTimer) { try { clearInterval(g.__thornswoodBurnTimer); } catch (e) { } }
  g.__thornswoodBurnTimer = setInterval(guard('burnTick', burnTick), NEEDS.burn.every);

  try {
    mp.makeProperty(NEEDS_PROPERTY, {
      // Visible to the owner now, because the HUD is drawn from this. Still
      // nothing to a neighbour: how hungry somebody is is their business.
      isVisibleByOwner: true,
      isVisibleByNeighbors: false,
      updateOwner: hudScript(),
      updateNeighbor: ''
    });
  } catch (e) {
    // Already made by a previous load, which is what a hot reload looks like.
    // The script cannot be changed after the fact, so a changed HUD needs a
    // server restart, which a deploy is.
  }

  if (g.__thornswoodNeedsTimer) { try { clearInterval(g.__thornswoodNeedsTimer); } catch (e) { } }
  g.__thornswoodNeedsTimer = setInterval(guard('needsTick', tick), TICK_MS);

  g.__thornswoodNeeds = {
    NEEDS: NEEDS, COST: COST, TEMP_COST: TEMP_COST, CRAFT_REST: CRAFT_REST,
    bandOf: bandOf, tempBand: tempBand, consumed: consumed, kindOf: foodKind, groupOf: foodGroup,
    // A swallow the engine saw, from mp.onEatItem (#3136).
    eaten: eaten,
    // Water at a well and over a cooking fire, from mp.onActivate (#1382).
    activatedWater: activatedWater, drankWater: drankWater,
    // A bottle used up by a hair dye's steep, and the fire it steeps at (#2675).
    spendWater: spendWater, fireNear: fireNear,
    waterItem: function () { return NEEDS.waterItems.full; },
    // The potion window (#1382), asked by mp.onEatItem before the engine applies it.
    potionScale: potionScale,
    // What the engine applies of a swallowed record: 0 for a food whose own
    // magic is taken away (#2682), else the potion window's scale.
    effectScale: effectScale, stripped: stripped, mealHelpOf: mealHelpOf,
    // How a cook comes out, and the records it can come out as (#2906).
    cookedAs: cookedAs, fineOf: fineOf, isFine: isFine, burntMeal: burntMeal,
    settle: settle, view: view, effects: effects,
    // The bars as a line of text, for /needs (#2267).
    textView: textView,
    ate: ate, resting: resting, worked: worked, bard: bard,
    place: place, tooTiredToCraft: tooTiredToCraft, craftRefusal: craftRefusal,
    setBurning: setBurning, catchFire: catchFire,
    fresh: fresh, clamp: clamp,
    // The bard the server sees playing (#1631).
    playing: playing, bardSeen: bardSeen,
    // The meters as last settled, without settling them again (#1383).
    read: read,
    // One pass of the minute tick, for the harnesses (#1382).
    tick: tick,
    // The hangover, for the physicker's remedy in the wounds panel (#1382).
    hungOver: hungOver, soberUp: soberUp,
    // What logging out now would do, in the Body page's words (#2246).
    awayWords: awayWords
  };

  nlog('ready: food empties in', Math.round(100 / NEEDS.drain.food) + 'h,',
       'drink in', Math.round(100 / NEEDS.drain.drink) + 'h,',
       'rest in', Math.round(100 / NEEDS.drain.rest) + 'h');
})();
// ==== end thornswood needs ====

