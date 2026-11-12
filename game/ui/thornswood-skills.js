'use strict';
/*
  Your character: class, profession, skill tree, and while you are new, your
  home. The panel behind K, and the whole of character creation.

  Same rule as the emote wheel next door: nothing calls loadUrl. There is one
  browser and one page, so a page of its own would replace the chat, the names
  above heads and the whole front. This mounts itself at the end of the body,
  where React is not looking, and hides rather than unmounts.

  THE SECOND LOOK, 20 September. The first cut drew Patrick's wireframe as it
  was drawn: three round tabs, a list, a line across to a sub-list. He said
  the wireframe was a rough draft and not the thing, so this is the thing: a
  menu in the shape of the game's own, a framed panel over a darkened screen,
  a section list down the left with what you already are under each name, the
  section itself on the right, and one Confirm at the bottom. Plain sentences
  in it, not labels in capitals.

  CREATION IS THE SAME PANEL. A new character stands in the hall and the
  server opens this with two more sections, Home and Review. While creating
  every card is a soft choice: a click marks it on the page and sends
  nothing, another click replaces it, and the section list reads the choice
  in gold. Review, last in the list, shows every choice on one page and has
  the one button, Begin, lit once a home is chosen. Confirm sends them all,
  one pick each, profession, class, and the town last, because the town is
  the pick that ends creation on the server. A home is the one choice that
  has to be made before leaving the hall; class and profession can be left
  for later with the last card in each of those sections and picked in the
  world from this same panel, one Confirm at a time. There is no Close
  button while creating (Escape and K still shut it, and the server's
  reminder opens it again). The panel closes itself on the home's answer.

  NOTHING HERE DECIDES ANYTHING. It reads what the server says this character
  is and sends what was picked. Every rule in the rulebook, one class only,
  one profession, novice in your sister half, two secondary professions at
  most, ranks, spell points, is the server's to enforce. A client that decided
  any of it would be a client anybody could edit. What the server refuses
  comes back as a note under the panel, and as a line in the chat. "Choose
  later", a soft choice and a marked spell are marks on this page until
  something sends them: Confirm in Review while creating, Learn in the spell
  book in the world. "later" is never sent and is a mark on this page and
  nothing else, because leaving a choice unmade changes nothing.

  THE SPELLS ARE REAL NOW, 20 September. A marked spell used to be a mark and
  no more. It is a pick like any other: Learn sends one 'skills:pick spell
  <name>' per mark and waits, and in creation the marks go out with Confirm
  in Review, after the profession, because a spell needs the profession that
  owns it. What is yours, how many points you hold and your rank in each
  school are read from what the server sent and are never worked out here.

  NOTHING REDRAWS FOR NOTHING, 20 September. The server writes the property
  on every answer, on every refresh and on every reminder while somebody is
  still choosing, so the same panel arrives again and again. The first cut
  tore the section list and the body down and rebuilt them on each arrival,
  and every click did the same, with 90 millisecond colour transitions on the
  rebuilt cards: the boxes flashed. Now draw() compares what it would draw
  with what it drew last, as JSON, and does nothing when they match; the
  status line and the work counters on the progress lines are each their own
  smaller redraw, written in place; and there are no transitions and no
  hover rules, for the same reason the character choice page has none (see
  thornswood-select.js: its first three cuts died the moment the mouse moved
  over them). The cursor still turns into a hand over anything clickable; a
  cursor rule restyles nothing.

  THE CONTRACT with thornswood-front.js, unchanged from the first cut:
    window.thornswoodSkills = { open, close, toggle, isOpen, setData, takeOn, setKey }
    setKey(name)    SkillsKey's name, K unless it is bound elsewhere (#1919)
    page -> plugin  'skills:ready' | 'skills:opened' | 'skills:closed' |
                    'skills:refresh' | 'skills:pick <words>' |
                    'skills:switch' (Change character, #3128)
    the plugin turns 'skills:pick X' into the chat line '/pick X'

  THE CONTRACT with the server, agreed 20 September, written down here
  because the two halves were written at the same time and did not match, so
  nothing drew. What setData is handed is the whole stored state with this
  panel's view nested under .panel, and these are the fields this page reads:

    progress: { '<key>': { next: '<the rank being climbed to>',
                           done: <number>, need: <number> } }
      One entry per half, school or class verb that can still climb, under
      the same keys as ranks. A key at master, or one that cannot climb, is
      left out entirely rather than sent with a null, and the whole field is
      left out when there is nothing to say.

    note: { text: '<the refusal, in plain words>', at: <ms>,
            about: '<class|profession|spell|town|spend|perk>' }
      about says which pick the refusal answers, so the panel clears that
      pick and only that one. A note with no about is still shown.

    book: { halves: [ { key, name, how, rank, open, total,
                        families: [ { name, open, total } ], why } ],
            none: '<sentence>' }
      The recipe book, counted by the server out of its own recipe table. how
      is 'own', 'sister' or 'taught'. why replaces families when there is
      nothing open, and none replaces the halves when there are none. The
      field is left out entirely for a mage with no craft half taught to
      them, and while creating, and the section is not drawn without it.

    spells: { '<spell name>': true }     what the character actually holds
    spellPoints: <number>                what is left to spend

    college: { gain: <number>, school: '<taught school>' | null,
               opens: <ms>, hours: <number>, halls: [ '<a hall, in words>' ] }
      A semester at the College (#1387), sent to anybody magic is open to: a
      mage, or somebody a Master mage taught. opens is when the next semester
      opens on the server's clock, 0 when one is open now. A semester is
      taken by pressing E at a study desk in one of the halls (Patrick, 22
      October 2026), and the server answers in the chat: this page sends
      nothing for it.

    apprentice: { took: [ { id, name, half, kind } ], by: [ { id, name, half, kind, stands } ],
                  mastered: [ '<half>' ], sister: { half, rank } | null, used: <n>, of: <n> }
      Masters and apprentices (#1634), sent to anybody with a profession.
      took is who you took on, by is who took you on, kind is 'sister' or
      'outside', and id is the form id in hex. Each row has End, which sends
      '/apprentice end <id> <half>' or '/apprentice leave <half>' through
      window.thornswoodNet.say, the way the property page's Stop does. The
      look prompt's K hands takeOn the person under the crosshair,
      { id, name, halves: [ { h, k } ] }, and Take on sends
      '/apprentice <id> <half>'. The server answers in the chat and by
      rewriting this.

    hairDye: { dyes: [ { id, name, count } ], steeping: { name, left } | null }
      Hair dye (#2675), sent only while you carry a dye or one is steeping.
      Dye my hair sends '/hairdye self <id>' through window.thornswoodNet.say.
      The look prompt's K hands dyeFor the person under the crosshair,
      { id, name }, and Offer to dye sends '/hairdye offer <id> <dye>': they
      answer on their own prompt. The server answers in the chat and by
      rewriting this.

    alchemy: { eaten: [ { name, effects: [ '<effect>' ] | null, other, known, of } ],
               recipes: [ { with: [ '<ingredient>' ], makes: [ '<effect>' ], times } ] }
      The Alchemy journal (#3142), sent only once the character has eaten an
      ingredient or brewed a mix. eaten is every ingredient tasted, with the
      effects of it the character knows: known of of are known, effects
      names the ones a brew here can make and other counts the rest. effects
      is null when the server cannot find the ingredient's record. recipes
      is every mix brewed, and how many times. Nothing on it is sent.

    staff: { points: <number>, rank: '<Bladebinder rank>',
             mine: [ '<spell desc>' ], spells: [ [ desc, name, rank ] ] }
      An Enchanter's staff spells (#1128), sent to an Enchanter and nobody
      else. Drawn like the spell book: a mark needs a staff spell point, the
      rank, and a staff spell of the rank below already unlocked; Unlock
      sends 'skills:pick staffspell <desc>' for each mark. A refusal comes
      back as a note about 'staffspell'.
    tree: { '<sub-skill key>': <0..5> }  points in the tree, placed and spent
    points: <number>                     free tree points
    placed: { '<sub-skill key>': <0..5> } the part of tree that was placed at
                                          creation and cannot be moved
    perkClocks: { '<perk key>': { ready: <ms>, until: <ms> } }
      The filled perks that wait between firings (#1385), only in the world.
      ready is when it may fire again by the server's clock, 0 for never;
      until is there on Font of Magic while it runs. Drawn beside the perk.
      Font of Magic is the one perk a person starts: its Use button sends
      'skills:pick perk fontofmagic', and a refusal comes back as a note
      about 'perk'.

    weave: 'warmth' | 'armour'
      What a Master Weaver's next garments carry (#1398), sent only to
      somebody who holds the perk, and only in the world. Drawn under the
      perk on their own profession card; a press on the other one sends
      'skills:pick weave <key>', and a refusal comes back as a note about
      'weave'.

    property: [ { name, mine: <bool>, locked, keyed, master (#2254), b, by,
                  rent: { amount, every, owed } | null, before, owes (#3893),
                  sleep: [ { pid, name } ], farm, days, reach } ]
      The property page (#1637, #1603), sent once somebody holds a building
      or a farm or carries a key to one, and left out otherwise: the page is
      drawn from whether this arrived. mine is a place you hold, b is its
      building id, and sleep is tonight's guests there; Stop beside a guest
      sends '/sleephere stop <pid> <b>' through window.thornswoodNet.say.
      A farm row has farm, days and reach and nothing else. owes is rent
      still owed on a place you no longer hold, and before the same on one
      you hold again (#3893); a row with owes and no key is that alone.

    body: { food, drink, rest, temp, foodBand, drinkBand, restBand, tempBand,
            resting, place, roof, night, fireAway, fireWorth, tempTarget,
            exposure, cover, worn: [ { name, worth, known } ] }
      The Body page (#1631), the needs block's view, sent with every panel
      in the world and never while creating. What /needs used to say: the
      four meters and their bands, where you are resting, the warmth with
      its target and what sets it, and what the server counts as worn. It
      reads as of the panel's last arrival; Read again sends 'skills:refresh'
      for a new one. Nothing on it is picked or sent.

    firstSteps: { town: '<the town>', steps: [ { key, name, text, done } ] }
      A new character's first steps (#3166), sent from the arrival until the
      Cook's errand is done or the page is put away, and never while
      creating. key is pick, cook, board, work or back; the server ticks
      each one when it sees it done, and the words are its own. The page is
      first in the list while it is there and opens on it once. Put this
      away sends 'skills:pick firststeps hide', and the answer is the panel
      written again without it.

    officePage: { jarls: [ { hold, where, offices: { court | steward | guard:
                    { role, label, holders: [ { pid, name, was, chosen } ], people: [ { pid, name } ] } } } ],
                  toHold: [ { office, hold, where, role, by } ],
                  clash: [ { hold, where } ], courtOf: [ { hold, where } ],
                  stewardOf: [ { hold, where } ], guardOf: [ { hold, where, jail } ],
                  steward: <bool>, staff: <bool>,
                  door: { name, by, hold, where, ours, staff, rent: { amount, every, owed } | null } | null,
                  boards: [ { hold, where } ] }
      The offices (#1638), sent to anybody who holds one or is staff, and to
      nobody else.
      Every office is a Discord role on the account (#2551): jarls are the
      holds whose Jarl role it holds, each with its Court, Steward and Guard:
      holders (by a character in the world, or by profile with no name) and
      people, the ones in the world who could be named, by name with the
      profile id the button sends. clash are the holds whose Jarl role
      another account holds too, so it does not act as their Jarl. courtOf,
      stewardOf and guardOf are the offices it was given. steward: it keeps a
      hold (Steward of it, or its Jarl), so it evicts, sets rent and moves
      its own hold's board; boards are those boards only. door is the door
      the steward opened in the last minute; door.where is the
      town whose hold the building is in (null for none), and door.ours is
      true when this character keeps it. staff (#2551, Patrick, 17 Oct): staff
      hold no office, but end claims and set rent at any building, so they
      get the door card at every door, with door.staff true where they act
      as staff rather than as its steward; the server logs each press for
      staff. The boards stay a steward's. An office is one
      character's (Patrick, 16 Oct): a holder row is the character that
      holds it, or chosen false for an account none of whose characters
      does yet, and toHold are the offices this account's roles give that
      this character does not hold, with by the character that does, and
      Hold it here sends /office hold <office> <hold>.
      Its buttons send the server's own lines through the chat line, the way
      the property page's Stop does: /office <court|steward|guard> <hold>
      <pid> (Name) and -<pid> (Remove), /evict, /rent <gold>, /rent - and
      /board move <hold>. The answers come back in the chat,
      and the page is written again.
*/

(function () {
  if (window.thornswoodSkills) return;

  // ------------------------------------------------------------ the table --
  /*
    From the rulebook of 20 September. The names and the rules are the
    server's; the sentences are this file's, because the server sends keys and
    a person reads sentences. If the server ever sends a table it replaces
    this one wholesale.
  */
  var DATA = {
    start: {
      title: 'First steps',
      lead: 'Your first hour in the town you chose. Each step ticks itself when the server sees it done, in any order.',
      rows: []
    },
    'class': {
      title: 'Class',
      lead: 'One class, for good. It is the one kind of work only you can do. Everything else you buy, trade for, or ask a friend to do.',
      later: 'You can pick your class in the world, from this panel. One class, for good, when you do.',
      rows: [
        { key: 'hunter', name: 'Hunter', desc: 'The only ones who can loot an animal they have brought down. Hides, meat and horn come from a hunter or from nobody.' },
        { key: 'fisher', name: 'Fisher', desc: 'The only ones who can take fish from the water. Every fish on every table was caught by one of you.' },
        { key: 'gatherer', name: 'Gatherer', desc: 'The only ones who can harvest flora and loose materials out of the world. Herbs, mushrooms, moss, the makings of every potion.' },
        { key: 'miner', name: 'Miner', desc: 'The only ones who can work an ore vein. Every ingot in Skyrim starts with a miner and a pickaxe.' },
        { key: 'farmer', name: 'Farmer', desc: 'The only ones who can plant and harvest crops. Grain, vegetables and the bread that comes of them.' }
      ]
    },
    profession: {
      title: 'Profession',
      lead: 'One profession, and one half of it to make your own. You know the novice work of the other half from the start. A Master of another profession can teach you their basics, and you may take that up twice.',
      later: 'You can pick your profession in the world, from this panel.',
      rows: [
        { key: 'warrior', name: 'Warrior', desc: 'Arms, and the people who carry them.',
          subs: [{ key: 'bulwark', name: 'Bulwark', desc: 'Shields, heavy armour, holding the line' },
                 { key: 'berserker', name: 'Berserker', desc: 'Two handed, dual wield, ending the fight' }],
          perk: 'At Master, Warlord: teach novice combat to non-warriors, and the master-tier manoeuvres.' },
        { key: 'mage', name: 'Mage', desc: 'Two schools of magic, and spells learned by the point.', pick: 2,
          subs: [{ key: 'destruction', name: 'Destruction' }, { key: 'restoration', name: 'Restoration' },
                 { key: 'alteration', name: 'Alteration' }, { key: 'conjuration', name: 'Conjuration' },
                 { key: 'illusion', name: 'Illusion' }],
          perk: 'At Master, Archmage: a third school, and the authority to take on apprentices who are not mages.' },
        { key: 'alchemist', name: 'Alchemist', desc: 'What goes into a bottle, and what it does to whoever drinks it.',
          subs: [{ key: 'blightbrewer', name: 'Blightbrewer', desc: 'Poisons and harm' },
                 { key: 'physicker', name: 'Physicker', desc: 'Medicine and restoration' }],
          perk: 'At Master, Master Chemist: two potions from every batch.' },
        { key: 'cook', name: 'Cook', desc: 'The hearth, and everything that comes off it.',
          subs: [{ key: 'hearthcook', name: 'Hearthcook', desc: 'Dinners, meats, stews' },
                 { key: 'confectioner', name: 'Confectioner', desc: 'Desserts, breads, sweets' }],
          perk: 'At Master, Grand Chef: two dishes from every batch.' },
        { key: 'smith', name: 'Smith', desc: 'Iron and steel, and the forge that shapes them.',
          subs: [{ key: 'platewright', name: 'Platewright', desc: 'Armour' },
                 { key: 'edgewright', name: 'Edgewright', desc: 'Weapons' }],
          perk: 'At Master, Mastercraft: temper to Legendary, past the ordinary limit.' },
        { key: 'enchanter', name: 'Enchanter', desc: 'Souls, and what they are bound into.',
          subs: [{ key: 'bladebinder', name: 'Bladebinder', desc: 'Weapon enchantments' },
                 { key: 'wardweaver', name: 'Wardweaver', desc: 'Armour and apparel' }],
          perk: 'At Master, Twin Souls: two enchantments on one item.' },
        { key: 'tailor', name: 'Tailor', desc: 'Cloth, thread and the people who wear them.',
          subs: [{ key: 'liverywright', name: 'Liverywright', desc: 'Robes, uniforms, faction dress' },
                 { key: 'haberdasher', name: 'Haberdasher', desc: 'Common and fine clothing' }],
          perk: 'At Master, Master Weaver: clothing that hides armour or turns the weather, without the weight.' },
        { key: 'woodworker', name: 'Woodworker', desc: 'Timber, from the felling to the finished thing.',
          subs: [{ key: 'charburner', name: 'Charburner', desc: 'Firewood, coke, campfires' },
                 { key: 'woodwright', name: 'Woodwright', desc: 'Bows, arrows, instruments' }],
          perk: 'At Master, Master Carver: campfires and kilns give their full warmth.' }
      ]
    },
    tree: {
      title: 'Skill tree',
      lead: 'Fifteen skills across health, magicka and stamina. A point goes in one at a time, and filling one grants its perk.',
      rows: [
        { key: 'health', name: 'Health', subs: [
            { key: 'vitality', name: 'Vitality', desc: 'Most health', perk: 'Cheat Death: once a day, the blow that would kill you leaves you at 1 health.' },
            { key: 'fortitude', name: 'Fortitude', desc: 'Regeneration', perk: 'Troll’s Blood: during a fight, health returns at 2 a second.' },
            { key: 'might', name: 'Might', desc: 'Melee damage', perk: 'Devastating Blow: a power attack deals 25% more.',
              gate: [{ weight: 45, might: 5 }, { weight: 30, might: 3 }] },
            { key: 'resilience', name: 'Resilience', desc: 'Armour', perk: 'Unshakeable: nothing staggers you while you block.' },
            { key: 'toughness', name: 'Toughness', desc: 'Poison and disease', perk: 'Purified Blood: disease does not take, and poison deals 25%.' }] },
        { key: 'magicka', name: 'Magicka', subs: [
            { key: 'capacity', name: 'Capacity', desc: 'Most magicka', perk: 'Archmage’s Vessel: drop below a tenth of magicka and it returns to half, once a day.' },
            { key: 'clarity', name: 'Clarity', desc: 'Regeneration', perk: 'Leyline Attunement: magicka still returns while you cast, at half the usual rate.' },
            { key: 'potency', name: 'Potency', desc: 'Spell effect, in the schools you hold', perk: 'Overcharge: one spell in five deals double, or holds twice as long.' },
            { key: 'ward', name: 'Ward', desc: 'Magic resistance', perk: 'Spellbreaker: 20% of the magicka in a spell that hits you is added to yours.' },
            { key: 'efficiency', name: 'Efficiency', desc: 'Cost, in the schools you hold', perk: 'Font of Magic: once a day, 15 seconds where a spell costs nothing. Use starts it.' }] },
        { key: 'stamina', name: 'Stamina', subs: [
            { key: 'endurance', name: 'Endurance', desc: 'Most stamina', perk: 'Tireless: a sprint, a power attack and a shield bash cost half stamina.' },
            { key: 'vigor', name: 'Vigor', desc: 'Regeneration', perk: 'Second Wind: when stamina hits 0 it fills, once every 5 minutes.' },
            { key: 'agility', name: 'Agility', desc: 'Speed', perk: 'Windwalker: +4 speed, and a fall deals no damage.' },
            { key: 'burden', name: 'Burden', desc: 'Carry weight', perk: 'Pack Mule: being overloaded does not slow you.' },
            { key: 'precision', name: 'Precision', desc: 'Critical chance, which the game ignores', perk: 'Lethal Aim: an arrow ignores half the armour it hits.' }] }
      ]
    },
    /*
      The spell book. The names are Skyrim's own spells, sorted into the
      mage's four ranks (the game's Apprentice and Adept tiers both sit
      under Advanced). The list of names is this page's; everything about a
      person is the server's. Which spells are yours comes from mine.spells,
      how many points you hold from mine.spellPoints, and the rank in each
      school from mine.ranks. A spell the server lists is drawn as yours and
      cannot be unmarked; the rest are marks until they are sent.
    */
    spells: {
      title: 'Spell book',
      lead: 'The spells of your two schools, by rank. A spell costs one point; points come with each rank and with a semester at the College.',
      ranks: [{ key: 'novice', name: 'Novice' }, { key: 'advanced', name: 'Advanced' },
              { key: 'expert', name: 'Expert' }, { key: 'master', name: 'Master' }],
      schools: {
        destruction: { novice: ['Flames', 'Frostbite', 'Sparks'],
                       advanced: ['Firebolt', 'Ice Spike', 'Lightning Bolt', 'Fireball', 'Ice Storm', 'Chain Lightning', 'Flame Cloak', 'Frost Cloak', 'Lightning Cloak'],
                       expert: ['Incinerate', 'Icy Spear', 'Thunderbolt', 'Wall of Flames', 'Wall of Frost', 'Wall of Storms'],
                       master: ['Fire Storm', 'Blizzard', 'Lightning Storm'] },
        restoration: { novice: ['Healing', 'Lesser Ward'],
                       advanced: ['Healing Hands', 'Fast Healing', 'Steadfast Ward', 'Turn Undead', 'Close Wounds', 'Heal Other', 'Greater Ward', 'Repel Lesser Undead'],
                       expert: ['Grand Healing', 'Circle of Protection', 'Repel Undead', 'Turn Greater Undead'],
                       master: ['Guardian Circle', 'Bane of the Undead'] },
        alteration:  { novice: ['Candlelight', 'Oakflesh'],
                       advanced: ['Magelight', 'Stoneflesh', 'Detect Life', 'Ironflesh', 'Telekinesis', 'Waterbreathing'],
                       expert: ['Ebonyflesh', 'Paralyze', 'Detect Dead'],
                       master: ['Dragonhide', 'Mass Paralysis'] },
        conjuration: { novice: ['Conjure Familiar', 'Raise Zombie', 'Bound Sword'],
                       advanced: ['Conjure Flame Atronach', 'Reanimate Corpse', 'Bound Battleaxe', 'Soul Trap', 'Conjure Frost Atronach', 'Banish Daedra', 'Revenant', 'Bound Bow'],
                       expert: ['Conjure Storm Atronach', 'Dread Zombie', 'Conjure Dremora Lord', 'Expel Daedra', 'Command Daedra'],
                       master: ['Dead Thrall', 'Flame Thrall', 'Frost Thrall', 'Storm Thrall'] },
        illusion:    { novice: ['Courage', 'Clairvoyance', 'Fury'],
                       advanced: ['Calm', 'Fear', 'Muffle', 'Frenzy', 'Rally', 'Invisibility'],
                       expert: ['Pacify', 'Rout', 'Call to Arms'],
                       master: ['Harmony', 'Hysteria', 'Mayhem'] }
      }
    },
    /*
      The recipe book. Everything in it is the server's: this table holds the
      title and the one sentence over the page and nothing else, because what
      a half can make is read out of the game's own records by
      tools\Build-RecipeTable.ps1 and counted by the server, and a list of
      families typed here would be a second opinion nobody asked for.

      It is counts and not a list on purpose. The server's table holds 1,728
      recipes and this page is a browser drawn over a running Skyrim, so what
      arrives is the families and how many of each are open. Patrick, 21
      September: "don't be very specific because for like tailor there are
      hundreds of clothing items".
    */
    /*
      An Enchanter's staff spells (#1128). The list, the points and the rank
      are all the server's, under mine.staff; this is the title and the one
      sentence over the page.
    */
    staff: {
      title: 'Staff spells',
      lead: 'The spells you can bind into a staff, by rank. Unlocking one costs a staff spell point and needs no tome. Your Bladebinder rank decides how high you can go, and each rank above Novice needs a staff spell of the rank below first.',
      rows: []   // the server sends the spells
    },
    recipes: {
      title: 'Recipe book',
      /*
        The lead names the rule and not a rank. It said "the novice work of
        your sister half" until 21 September, which is the same wrong copy
        howYouHoldIt was keeping: a sister half climbs when a Master of it
        takes somebody on, and the server sends the rank it actually holds
        them at. Each column says how far its own half goes, read off what
        arrived, so this line has no business naming a rung.
      */
      lead: 'What you can make right now, by the kind of thing it is. Your own half, your sister half, and anything a Master taught you, each as far as your rank in it reaches. Recipes Skyrim keeps behind a perk, a spell or something you have to be holding are not counted as open.',
      rows: []   // the server sends the halves and their families
    },
    /*
      The profession guides (#3165): a page per profession, which is
      Patrick's answer A on the issue. The facts are GUIDES below, built out
      of the server's own tables; the sentences are GUIDE_TEXT.
    */
    guides: {
      title: 'Profession guides',
      lead: 'Every profession, one page each: what it makes, where its materials come from, and how it ranks up. Pick one to read it.',
      rows: []
    },
    /*
      A semester at the College (#1387). How many points, which school and
      when the next one opens are all the server's, under mine.college; this
      is the title and the one sentence over the page.
    */
    college: {
      title: 'College',
      lead: 'Press E at a study desk in one of the halls of the College of Winterhold, and the College hands you spell points, once a semester.',
      rows: []
    },
    /*
      Masters and apprentices (#1634). Who is whose is the server's, under
      mine.apprentice; this is the title and the sentence over the page.
    */
    apprentice: {
      title: 'Masters and apprentices',
      lead: 'A Master can take you on in your sister half, so it climbs past novice, or teach you the novice work of a half from another profession, twice in a life. Either of you can end it here.',
      rows: []
    },
    /*
      Hair dye (#2675). What you carry is the server's, under mine.hairDye;
      this is the title and the sentence over the page.
    */
    hairdye: {
      title: 'Hair dye',
      lead: 'A dye you carry colours your own hair, or the hair of somebody in front of you once they say yes. Each one is used up.',
      rows: []
    },
    /*
      The Alchemy journal (#3142). What was eaten and brewed is the server's,
      under mine.alchemy; this is the title and the sentence over the page.
    */
    alchemy: {
      title: 'Alchemy journal',
      lead: 'Every ingredient you have eaten and what you know of it, and every mix you have brewed. Your character remembers all of it at any alchemy lab. An ingredient goes in a brew only once you have eaten it, and eating teaches its first effect; a brew teaches the effects its ingredients share.',
      rows: []
    },
    /*
      The property page (#1637, #1603). What you hold and carry a key to is
      the server's, under mine.property; this is the title and nothing else,
      because the page draws its own line over the cards.
    */
    property: {
      title: 'Property',
      rows: []
    },
    /*
      The offices (#1638). Who holds what, and what is at the door, are the
      server's, under mine.officePage; this is the title
      and the one sentence over the page.
    */
    /*
      The Body page (#1631). The numbers are the server's, under mine.body;
      this is the title and the sentence over the page.
    */
    body: {
      title: 'Body',
      lead: 'Hunger, thirst, rest and warmth, as the server counts them, and why your warmth is what it is. The four bars at the bottom left show the same meters as you play.',
      rows: []
    },
    office: {
      title: 'Office',
      lead: 'The offices your Discord roles give you. The Jarl of a hold names its Court, its Steward and its Guards. A steward ends a claim and sets the rent at a door, and moves their hold\'s notice board. A guard keeps the cells of their hold\'s jail. The Court, the Guards, the Steward and the Jarl take anything out of their hold\'s drop box. Staff hold no office, but end a claim and set the rent at any door, raise a rank, check a stuck recipe and give back a lost item, and each press is logged for staff.',
      rows: []
    },
    home: {
      title: 'Home',
      lead: 'The town you start in. You arrive at a quiet spot in or near it, not in its inn.',
      rows: []   // the server sends the towns while you are new
    },
    review: {
      title: 'Review',
      lead: 'What you have chosen. Confirm sends all of it to the server and takes you to your home town. A profession without its half, or a mage short of two schools, is not sent; it can be picked in the world.',
      rows: []   // drawn from the choices, not from a table
    }
  };
  var REVIEW = DATA.review;   // kept beside a table the server might send without it

  /*
    The hold each town is in, from the town list the server sends (#2622).
    Until 17 Oct this was a table of inns, because a new character arrived
    in the inn; since #2622 they arrive at the town's start spot, so the card
    names the hold instead, the same name the welcome line says.
  */
  function holdOf(key) {
    var towns = (mine && mine.towns) || [];
    for (var i = 0; i < towns.length; i++) if (towns[i].key === key) return towns[i].hold || '';
    return '';
  }

  var RANK_NAMES = { novice: 'Novice', advanced: 'Advanced', expert: 'Expert', master: 'Master' };
  var CAP = 5;             // points that fill a skill; the server's LIMITS.skillCap, mirrored for the pips

  /*
    THE PROFESSION GUIDES (#3165). What each profession makes, where its
    materials come from and the numbers of the ladder, built by
    scripts/dev/Build-ProfessionGuides.js out of game/data/recipes.json (the
    rows the recipe book counts), game/data/mine-buildings.json,
    game/data/hunts.json and the gamemode's BENCH_ACCESS, MANEUVERS and
    tuning. It rides in this file rather than on the panel the server sends,
    because it is the same for everybody and the panel is sent on every
    write; what is a person's own on the page, their profession and rank, is
    read from that panel as everything else here is.

      ladder:   { per: { advanced, expert, master }, rest: { <rank>: n },
                  craftRest, party (a percent), perSpell, perRank, toolUses }
      professions: { <key>: { halves: { <half>: { count, race, first: [ name ],
                       families: [ [ family, novice, advanced, expert, master ] ],
                       benches: [ [ bench, lowest rank ] ],
                       maneuvers: [ [ name, rank, stamina, seconds ] ] } },
                     materials: [ [ name, recipes, class, rank, bench, [ from ],
                                    [ where ], more places ] ] } }

    Run the script after any of those change; game/tests/test-3165-profession-guides.js
    runs it with --check and fails while this block is stale.
  */
  // ==== PROFESSION_GUIDES ====
  /* Built by scripts/dev/Build-ProfessionGuides.js out of game/data and game/gamemode.js. Do not hand edit. */
  var GUIDES = {"ladder":{"per":{"advanced":100,"expert":250,"master":600},"rest":{"novice":1.5,"advanced":1.2,"expert":0.9,"master":0.6},"craftRest":15,"party":15,"perSpell":5,"perRank":10,"toolUses":50},"professions":{"warrior":{"halves":{"bulwark":{"count":0,"families":[],"first":[],"race":0,"benches":[],"maneuvers":[["Set","novice",15,45],["Plant","advanced",20,60],["Cover","expert",25,90],["Wall","master",40,180]]},"berserker":{"count":0,"families":[],"first":[],"race":0,"benches":[],"maneuvers":[["Rush","novice",15,30],["Heavy","advanced",20,45],["Break","expert",25,60],["Wreck","master",40,120]]}},"materials":[]},"mage":{"halves":{},"materials":[]},"alchemist":{"halves":{"blightbrewer":{"count":0,"families":[],"first":[],"race":0,"benches":[["Alchemy lab","novice"]]},"physicker":{"count":12,"families":[["Other food and drink",3,3,3,1],["Other goods",1,1,0,0]],"first":["Potion of Minor Healing","Poultice"],"race":0,"benches":[["Alchemy lab","novice"]]}},"materials":[["Blue Mountain Flower",4,"gatherer","advanced","",[],[],0],["Eye of Sabre Cat",3,"hunter","novice","",[],["Sabre Cat","Vale Sabre Cat","Animal Gladiator"],1],["Mudcrab Chitin",3,"hunter","novice","",[],["Mudcrab"],0],["Swamp Fungal Pod",3,"gatherer","advanced","",[],[],0],["Wheat",3,"farmer","advanced","",[],[],0],["Blisterwort",2,"gatherer","expert","",[],[],0],["Snowberries",2,"gatherer","advanced","",[],[],0],["White Cap",2,"gatherer","novice","",[],[],0],["Creep Cluster",1,"gatherer","novice","",[],[],0],["Fire Salts",1,"miner","expert","",[],[],0]]},"cook":{"halves":{"hearthcook":{"count":64,"families":[["Other food and drink",7,9,0,0],["Stews",5,2,4,1],["Meat dishes",7,3,0,1],["Soups",4,2,3,0],["Bread",0,4,0,0],["Vegetable dishes",3,1,0,0],["Cheese",0,3,0,0],["Fish dishes",2,0,0,0],["Chowders",1,0,0,0],["Crab dishes",1,0,0,0],["Ingredients",0,0,0,1]],"first":["First Planting Mead","Beef Stew","Cabbage Soup","Cooked Beef"],"race":0,"benches":[["Cookpot","novice"],["Grain mill","novice"],["Oven","novice"]]},"confectioner":{"count":12,"families":[["Desserts",1,10,1,0]],"first":["Apple Dumpling"],"race":0,"benches":[["Oven","novice"]]}},"materials":[["Salt Pile",46,"miner","novice","",[],[],0],["Butter",23,"farmer","novice","",[],[],0],["Sack of Flour",19,"farmer","advanced","Grain mill",["Wheat"],[],0],["Garlic",16,"gatherer","novice","",[],[],0],["Frost Mirriam",12,"gatherer","novice","",[],[],0],["Lavender",8,"gatherer","novice","",[],[],0],["Chicken's Egg",7,"farmer","novice","",[],[],0],["Juniper Berries",7,"gatherer","novice","",[],[],0],["Snowberries",7,"gatherer","advanced","",[],[],0],["Elves Ear",6,"gatherer","expert","",[],[],0]]},"smith":{"halves":{"platewright":{"count":244,"families":[["Body armour",21,51,11,7],["Helmets",9,21,8,5],["Gauntlets",12,18,6,5],["Armoured boots",8,16,6,5],["Shields",2,9,3,2],["Ingots",11,0,0,0],["Other armour and clothing",2,1,0,0],["Leather",2,0,0,0],["Hats and hoods",0,1,0,0],["Other goods",1,0,0,0],["Robes and body wear",0,1,0,0]],"first":["Fur Armor","Corundum Ingot","Ancient Nord Gauntlets","Fur Helmet"],"race":13,"benches":[["Forge","novice"],["Smelter","novice"],["Tanning rack","novice"],["Skyforge","advanced"]]},"edgewright":{"count":83,"families":[["Swords",1,7,3,2],["War axes",2,6,3,2],["Battleaxes",1,5,2,2],["Greatswords",1,5,2,2],["Maces",2,4,2,2],["Daggers",1,4,2,2],["Warhammers",1,4,2,2],["Other goods",8,0,0,0],["Other weapons",1,0,0,0]],"first":["Alembic","Iron War Axe","Iron Battleaxe","Iron Dagger"],"race":1,"benches":[["Forge","novice"],["Skyforge","advanced"]]}},"materials":[["Leather Strips",284,"hunter","novice","Tanning rack",["Leather"],[],0],["Iron Ingot",174,"miner","novice","Smelter",["Iron Ore"],["Raven Rock Mine","Halted Stream Camp","Fort Fellhammer Mines"],43],["Steel Ingot",134,"miner","advanced","Smelter",["Corundum Ore","Iron Ore"],["Knifepoint Mine","Dead Drop Mine","Goldenrock Mine"],18],["Leather",80,"hunter","novice","Tanning rack",[],[],0],["Corundum Ingot",41,"miner","advanced","Smelter",["Corundum Ore"],["Knifepoint Mine","Dead Drop Mine","Goldenrock Mine"],18],["Refined Moonstone",30,"miner","expert","Smelter",["Moonstone Ore"],["Soljund's Sinkhole","Mzulft","Mzulft Boilery"],11],["Quicksilver Ingot",25,"miner","advanced","Smelter",["Quicksilver Ore"],["Quicksilver Mine","Blind Cliff Bastion","Altar of Thrond Cave"],10],["Ebony Ingot",21,"miner","master","Smelter",["Ebony Ore"],["Gloombound Mine","Raven Rock Mine","Redbelly Mine"],1],["Orichalcum Ingot",17,"miner","advanced","Smelter",["Orichalcum Ore"],["Bilegulch Mine","Dushnikh Mine","Mor Khazgur Mine"],5],["Netch Leather",16,"hunter","advanced","",[],["Betty Netch","Bull Netch"],0]]},"enchanter":{"halves":{"bladebinder":{"count":13,"families":[["Staves",3,6,4,0]],"first":["Staff of Flames"],"race":0,"benches":[["Arcane enchanter","novice"],["Staff enchanter","novice"]]},"wardweaver":{"count":0,"families":[],"first":[],"race":0,"benches":[["Arcane enchanter","novice"]]}},"materials":[["Heart Stone",13,"miner","master","",[],["Coldcinder Cave","Broken Tusk Mine","Fort Frostmoth"],1],["Unenchanted Destruction Staff",10,"","","",[],[],0],["Unenchanted Restoration Staff",2,"","","",[],[],0],["Unenchanted Conjuration Staff",1,"","","",[],[],0]]},"tailor":{"halves":{"liverywright":{"count":82,"families":[["Robes and body wear",38,0,5,3],["Hats and hoods",15,0,0,1],["Other armour and clothing",0,10,0,0],["Shoes and light boots",7,0,0,0],["Gloves",3,0,0,0]],"first":["Black Robes","Black Cowl","Boots"],"race":2,"benches":[["Forge","novice"],["Loom","novice"],["Tanning rack","advanced"]]},"haberdasher":{"count":171,"families":[["Robes and body wear",43,2,0,3],["Shoes and light boots",31,1,1,6],["Hats and hoods",23,6,1,2],["Other armour and clothing",2,12,6,0],["Other goods",13,4,0,0],["Gloves",6,1,2,6]],"first":["Belted Tunic","Chef's Hat","Boots","Bandage"],"race":23,"benches":[["Forge","novice"],["Loom","novice"],["Tanning rack","novice"]]}},"materials":[["Thread",164,"gatherer","novice","Loom",["Tundra Cotton"],[],0],["Leather",104,"hunter","novice","Tanning rack",[],[],0],["Leather Strips",60,"hunter","novice","Tanning rack",["Leather"],[],0],["Linen Wrap",39,"","","",[],[],0],["Troll Fat",32,"hunter","advanced","",[],["Frost Troll","Troll","Snow Troll"],2],["Fur Plate",19,"hunter","novice","Tanning rack",[],[],0],["Gold Ingot",7,"miner","expert","Smelter",["Gold Ore"],["Kolskeggr Mine","Frossel","Darkshade"],14],["Common Soul Gem",5,"","","",[],[],0],["Dwarven Metal Ingot",4,"","","",[],[],0],["Ebony Ingot",4,"miner","master","Smelter",["Ebony Ore"],["Gloombound Mine","Raven Rock Mine","Redbelly Mine"],1]]},"woodworker":{"halves":{"charburner":{"count":5,"families":[["Other goods",2,1,1,1]],"first":["Poor Charcoal"],"race":0,"benches":[["Charcoal kiln","novice"]]},"woodwright":{"count":45,"families":[["Other goods",15,0,1,1],["Arrows and bolts",3,5,3,2],["Bows",0,3,5,2],["Other weapons",3,0,0,0],["Greatswords",0,2,0,0]],"first":["Bar Stool","Drum","Dwarven Arrow"],"race":3,"benches":[["Charcoal kiln","novice"],["Forge","novice"],["Woodworking bench","novice"],["Dawnguard bench","advanced"],["Skyforge","advanced"]]}},"materials":[["Firewood",37,"woodworker","novice","",[],[],0],["Leather Strips",13,"hunter","novice","Tanning rack",["Leather"],[],0],["Iron Ingot",10,"miner","novice","Smelter",["Iron Ore"],["Raven Rock Mine","Halted Stream Camp","Fort Fellhammer Mines"],43],["Steel Ingot",10,"miner","advanced","Smelter",["Corundum Ore","Iron Ore"],["Knifepoint Mine","Dead Drop Mine","Goldenrock Mine"],18],["Tundra Cotton",6,"gatherer","novice","",[],[],0],["Dwarven Metal Ingot",4,"","","",[],[],0],["Refined Moonstone",4,"miner","expert","Smelter",["Moonstone Ore"],["Soljund's Sinkhole","Mzulft","Mzulft Boilery"],11],["Quicksilver Ingot",3,"miner","advanced","Smelter",["Quicksilver Ore"],["Quicksilver Mine","Blind Cliff Bastion","Altar of Thrond Cave"],10],["Chaurus Chitin",2,"hunter","expert","",[],["Chaurus","Frozen Chaurus","Chaurus Hunter"],3],["Ebony Ingot",2,"miner","master","Smelter",["Ebony Ore"],["Gloombound Mine","Raven Rock Mine","Redbelly Mine"],1]]}}};
  // ==== end PROFESSION_GUIDES ====

  /*
    The page's own sentences around those facts, one set per profession:
    makes, for a half with no recipe rows to count (it says what the work
    is instead); climb, what counts as a piece of work; and where, what the
    materials list cannot say because no recipe names it (charcoal, a
    handle, an alchemist's ingredients). Each is what docs/systems/professions
    says the server does, craft says whether the bench rules of the ladder
    (rest under which nothing is made) apply, and sister replaces the line
    about the sister half where it climbs on something other than recipes.
  */
  var GUIDE_TEXT = {
    warrior: {
      craft: false,
      makes: {
        bulwark: 'Nothing at a bench. A Bulwark holds the line, and each rank gives one more maneuver on the maneuver key.',
        berserker: 'Nothing at a bench. A Berserker breaks the line, and each rank gives one more maneuver on the maneuver key.'
      },
      climb: 'A kill counts on your half: anything that is not a person, brought down by you. A chicken is 1 piece of work, a bear 4, a giant 8 and a dragon 16. A person killed by a person counts for nothing, and no other profession is credited for a kill.',
      where: 'A warrior needs no materials of their own. A Smith makes the arms and armour, and a Tailor the clothes under them.',
      sister: 'Your sister half stays at Novice, and its Novice maneuver opens only when a Master of it takes you on.'
    },
    mage: {
      craft: false,
      makes: 'Spells, not things. You hold two schools and learn spells by the point on the Spell book page. At Master you pick a third school.',
      climb: 'Casting is not counted. A spell learned is {perSpell} work in its school, and a rank gained anywhere else, in the other school or in a class, is {perRank} work in every school you hold. A semester at the College of Winterhold hands you spell points as well.',
      where: 'A mage needs no materials to learn a spell. The College page on this panel says when the next semester opens.'
    },
    alchemist: {
      craft: true,
      makes: {
        blightbrewer: 'Poisons, mixed at the alchemy lab. Skyrim has no alchemy recipes: a brew is whatever its ingredients share.',
        physicker: 'Medicine, mixed at the alchemy lab. Skyrim has no alchemy recipes: a brew is whatever its ingredients share.'
      },
      climb: 'A successful batch at the alchemy lab is one piece of work. Master Chemist, at Master, makes two from one batch, and that is still one piece.',
      where: 'Ingredients are a Gatherer\'s plants, a Hunter\'s parts, and the salts a Miner pulls from the quarry at Expert and Master. Or buy them from somebody who has them.'
    },
    cook: {
      craft: true,
      climb: 'A successful meal or dessert at your bench is one piece of work. Grand Chef, at Master, makes two from one batch, and that is still one piece.'
    },
    smith: {
      craft: true,
      climb: 'Every craft that goes through at a bench of your half is one piece of work.',
      where: 'A forge or a skyforge burns one charcoal for each piece, which a Charburner makes at the kiln. A war axe, a battleaxe, a warhammer or a mace takes one Tool Handle as well, also a Charburner\'s.'
    },
    enchanter: {
      craft: true,
      makes: {
        wardweaver: 'Enchantments on armour and clothing, at the arcane enchanter. Learn one by breaking an item down, then put it on a piece. There are no recipe rows to count.'
      },
      climb: 'Every staff made, and every enchantment put on a piece at the arcane enchanter, is one piece of work. Staff spells are unlocked on the Staff spells page, with the points each Bladebinder rank hands you.',
      where: 'A soul gem holds the soul an enchantment is made from. A Miner brings the heart stone a staff is bound around.'
    },
    tailor: {
      craft: true,
      climb: 'Every garment or piece made at a bench of your half is one piece of work.'
    },
    woodworker: {
      craft: true,
      climb: 'Every craft at a bench of your half is one piece of work. So is every load of logs split at a chopping block with the woodcutter\'s axe, and that piece counts on Woodwright.',
      where: 'Firewood is split at a chopping block with the woodcutter\'s axe a Woodworker is handed with the profession. The axe lasts {toolUses} uses, and a Smith makes the next one.'
    }
  };
  // The class whose work an input rests on, as a person says it.
  var GUIDE_WHO = { miner: 'Miner', hunter: 'Hunter', gatherer: 'Gatherer', farmer: 'Farmer', fisher: 'Fisher', woodworker: 'Woodworker' };
  // What each maneuver does, from the table on docs/systems/professions/warrior.md.
  var GUIDE_MANEUVER = {
    Set: 'a block costs half the stamina for 8 seconds',
    Plant: 'nothing staggers you for 8 seconds',
    Cover: 'one person within 3 metres takes 20% less damage while you block',
    Wall: 'you and your party within 3 metres take 20% less damage for 10 seconds',
    Rush: '+4 speed for 5 seconds',
    Heavy: 'the next power attack within 8 seconds deals 25% more',
    Break: 'the next hit within 8 seconds staggers',
    Wreck: 'the next power attack within 8 seconds deals 50% more and staggers'
  };
  var guideAt = '';        // the profession the guides page is on; '' is your own, or the first

  // ---------------------------------------------------------------- state --
  // Profession first, then class, then the tree, and the home last while
  // creating: Patrick's order, 20 September. The home is the last thing
  // because confirming it is what ends creation.
  var sections = ['profession', 'class', 'tree'];   // 'home' and 'review' are added while creating
  var section = 'profession';
  var rowAt = 0;
  var mine = null;         // what the server says this character is: the panel view
  var picked = {};         // section -> { row: key, subs: [keys] } chosen in the panel, not yet sent
  var later = {};          // section -> true when "Choose later" was clicked; this page's mark only
  var marked = {};         // spell name -> true, marked in the spell book; this page's mark only, nothing is sent
  var markedStaff = {};    // staff spell desc -> true, marked on the staff page; the same, for an Enchanter
  var pending = [];        // picks sent and not yet answered, oldest first: [{ section, words, at }]
  var status = '';         // the line under the panel
  var statusKind = '';     // '' | 'ok' | 'no'
  var wasCreating = false;
  var closing = false;     // creation is over and the panel is on its way shut
  var tableGen = 0;        // bumped when a table arrives from the server, so a redraw is forced
  var drawnKey = '';       // JSON of what head, nav and body were last drawn from
  var footKey = '';        // the same for the foot
  var keyName = 'K';       // SkillsKey as bound, until the front says otherwise (#1919)
  var progRows = [];       // the value half of each progress line on the page, in order
  var progKey = '';        // the same for those lines: their words, so a tick writes once
  var candidate = null;    // who the look prompt's K opened the page on: { id, name, halves: [{ h, k }] } (#1634)
  var endArmed = null;     // an End pressed once, waiting for the second press: { key, at }
  var apprSent = null;     // an End sent and not yet answered: { key, name, at }
  var dyeTarget = null;    // who the look prompt's K opened Hair dye on: { id, name } (#2675)

  // ------------------------------------------------------------------ css --
  /*
    No transitions and no :hover, on purpose; see the head of the file. The
    lit card is lit by a click or a key and nothing else.

    The panel is a fixed 1120 by 700 box for a 1920 by 1080 screen, scaled up
    by fit() on a bigger one, and never wider than the viewport less 24px a
    side on a smaller one. The flexible grid column is minmax(0,1fr) and every
    row spanning it has min-width:0, so nothing inside can push the foot past
    the panel's edge: the buttons sit inside the panel's padding whatever the
    status line says.
  */
  var css = [
    '#ts-skills{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;',
    'background:radial-gradient(ellipse at center,rgba(0,0,0,.50) 0%,rgba(0,0,0,.72) 100%);',
    'font-family:"Palatino Linotype",Palatino,Georgia,serif;color:#d9cfb4;user-select:none;pointer-events:auto}',
    '#ts-skills.gone{display:none}',
    '#ts-skills *{box-sizing:border-box}',
    '#ts-skills .panel{width:1120px;max-width:calc(100vw - 48px);height:700px;max-height:calc(100vh - 48px);display:grid;',
    'grid-template-columns:250px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto;',
    'background:rgba(11,10,8,.94);border:1px solid rgba(198,170,109,.42);outline:1px solid rgba(198,170,109,.14);outline-offset:4px;',
    'box-shadow:0 24px 80px rgba(0,0,0,.7);position:relative}',
    // head
    '#ts-skills .head{grid-column:1/3;min-width:0;display:flex;align-items:flex-end;justify-content:space-between;gap:32px;',
    'padding:22px 32px 16px;border-bottom:1px solid rgba(198,170,109,.22)}',
    '#ts-skills .eyebrow{font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:rgba(198,170,109,.75);margin-bottom:6px}',
    '#ts-skills .title{font-size:26px;color:#f6e9c8;line-height:1.1;white-space:nowrap}',
    '#ts-skills .who{flex:0 1 560px;min-width:0;text-align:right;font-size:13.5px;color:#d9cfb4;line-height:1.5}',
    '#ts-skills .who .dim{color:rgba(217,207,180,.6);font-style:italic}',
    '#ts-skills .who .pts{color:#e9d19b}',
    // nav: the first row's text sits 22px under the head line, level with the body's lead,
    // and 32px in from the panel's edge, level with the head and the body
    '#ts-skills .nav{grid-column:1;min-width:0;border-right:1px solid rgba(198,170,109,.22);padding:8px 0;overflow:auto}',
    '#ts-skills .navrow{padding:14px 20px 13px 29px;border-left:3px solid transparent;cursor:pointer}',
    '#ts-skills .navrow.on{border-left-color:#e9d19b;background:rgba(120,94,44,.24)}',
    '#ts-skills .navrow .k{font-size:16px;color:#d9cfb4;letter-spacing:.02em}',
    '#ts-skills .navrow.on .k{color:#f6e9c8}',
    '#ts-skills .navrow .v{font-size:12.5px;color:rgba(217,207,180,.58);font-style:italic;margin-top:3px}',
    '#ts-skills .navrow .v.set{color:#9fcf92;font-style:normal}',
    '#ts-skills .navrow .v.need{color:#e9d19b}',
    '#ts-skills .navrow .v.chosen{color:#e9d19b;font-style:normal}',   // a soft choice while creating, gold like .tag.gold
    // body
    '#ts-skills .body{grid-column:2;min-width:0;padding:22px 32px 18px;overflow:auto}',
    '#ts-skills .lead{font-size:13.5px;line-height:1.55;color:rgba(217,207,180,.66);font-style:italic;margin:0 0 16px;max-width:680px}',
    '#ts-skills .cards{display:grid;grid-template-columns:1fr;gap:9px}',
    '#ts-skills .cards.three{grid-template-columns:repeat(3,1fr)}',
    '#ts-skills .card{border:1px solid rgba(198,170,109,.30);background:rgba(0,0,0,.20);padding:13px 18px 12px;position:relative;cursor:pointer}',
    '#ts-skills .card.at{border-color:rgba(198,170,109,.55);box-shadow:inset 3px 0 0 0 #c6aa6d}',
    '#ts-skills .card.mine{border-color:rgba(160,205,150,.85);background:rgba(120,170,115,.13)}',
    '#ts-skills .card.off{opacity:.42}',
    '#ts-skills .card.chosen{border-color:#e9d19b;background:rgba(201,162,75,.16)}',
    '#ts-skills .spell.on{background:rgba(201,162,75,.16)}',
    '#ts-skills .spell.mine{background:rgba(120,170,115,.11)}',
    '#ts-skills .skill.full{background:rgba(120,170,115,.11)}',
    '#ts-skills .skill.full .sn{color:#9fcf92}',
    '#ts-skills .skill.full .pip.lit{background:#7fb877;border-color:#9fcf92}',
    '#ts-skills .skill.some .pip.lit{background:#c6aa6d;border-color:#e9d19b}',
    '#ts-skills .card.later{border-style:dashed}',
    '#ts-skills .card .name{font-size:16.5px;color:#f6e9c8;display:flex;align-items:baseline;gap:12px}',
    '#ts-skills .card .desc{font-size:13px;line-height:1.5;color:rgba(217,207,180,.78);margin-top:4px}',
    '#ts-skills .card .inn{font-size:12.5px;color:rgba(217,207,180,.6);font-style:italic;margin-top:3px}',
    '#ts-skills .card .guest{display:flex;align-items:center;gap:12px;font-size:13px;color:#d9cfb4;margin-top:5px}',
    '#ts-skills .card .guest .stop{border:1px solid rgba(198,170,109,.55);color:#e9d19b;padding:1px 9px;font-size:11.5px;cursor:pointer}',
    // Take on and End on Masters and apprentices (#1634); End asks twice, in Close Skyrim's colours.
    '#ts-skills .card .act{flex:0 0 auto;margin-left:auto;border:1px solid rgba(198,170,109,.55);color:#e9d19b;padding:1px 9px;',
    'font-size:11.5px;white-space:nowrap;cursor:pointer}',
    '#ts-skills .card .act.armed{border-color:#e9a27a;color:#f6c9b0;background:rgba(120,40,30,.45)}',
    // The Office page (#1638): its rows are guest rows, and these wrap.
    '#ts-skills .card .guest.wrap{flex-wrap:wrap;gap:8px}',
    '#ts-skills .card .guest .who{flex:1;min-width:160px}',
    '#ts-skills .card .guest .dim{color:rgba(217,207,180,.5)}',
    '#ts-skills .card .guest input{width:80px;font-family:inherit;font-size:13px;color:#d9cfb4;background:rgba(0,0,0,.25);border:1px solid rgba(198,170,109,.42);padding:1px 6px}',
    '#ts-skills .tag{margin-left:auto;font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:#9fcf92;white-space:nowrap}',
    '#ts-skills .tag.gold{color:#e9d19b}',
    '#ts-skills .tag.dim{color:rgba(217,207,180,.5)}',
    // halves and schools inside an open profession card
    '#ts-skills .halves{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:11px}',
    '#ts-skills .halves.five{grid-template-columns:repeat(5,1fr)}',
    // the profession guides' tabs (#3165): eight professions, four to a row
    '#ts-skills .halves.eight{grid-template-columns:repeat(4,1fr);margin:0 0 16px}',
    '#ts-skills .guidehead{margin-top:18px}',
    '#ts-skills .guideline{font-size:13px;line-height:1.55;color:rgba(217,207,180,.78);margin:6px 0 0;max-width:680px}',
    '#ts-skills .half{border:1px solid rgba(198,170,109,.32);padding:9px 12px;background:rgba(0,0,0,.22);cursor:pointer}',
    '#ts-skills .half.on{border-color:#e9d19b;background:rgba(201,162,75,.20)}',
    '#ts-skills .half.mine{border-color:rgba(160,205,150,.85);background:rgba(120,170,115,.13)}',
    '#ts-skills .half .hn{font-size:14.5px;color:#f6e9c8}',
    '#ts-skills .half .hd{font-size:12px;color:rgba(217,207,180,.66);margin-top:2px}',
    '#ts-skills .half .hr{font-size:11px;color:#9fcf92;letter-spacing:.12em;text-transform:uppercase;margin-top:4px}',
    '#ts-skills .perk{font-size:12.5px;line-height:1.5;color:rgba(198,170,109,.85);margin-top:10px;padding-top:8px;border-top:1px solid rgba(198,170,109,.18)}',
    // the tree
    '#ts-skills .cols{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}',
    '#ts-skills .colhead{font-size:11.5px;letter-spacing:.24em;text-transform:uppercase;color:rgba(198,170,109,.85);',
    'padding-bottom:8px;border-bottom:1px solid rgba(198,170,109,.22);margin-bottom:6px}',
    '#ts-skills .skill{display:grid;grid-template-columns:1fr auto auto;grid-template-rows:auto auto;column-gap:10px;align-items:center;',
    'padding:9px 6px 8px;border:1px solid transparent}',
    '#ts-skills .skill.at{border-color:transparent;box-shadow:inset 3px 0 0 0 rgba(198,170,109,.75)}',
    '#ts-skills .skill .sn{font-size:15px;color:#f6e9c8}',
    '#ts-skills .skill .sd{grid-column:1/4;font-size:12px;color:rgba(217,207,180,.6);line-height:1.45;margin-top:3px}',
    '#ts-skills .skill .sd.lit{color:#9fcf92}',
    '#ts-skills .pips{display:flex;gap:4px}',
    '#ts-skills .pip{width:10px;height:10px;border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.2)}',
    '#ts-skills .pip.lit{background:#c6aa6d;border-color:#e9d19b}',
    // A point that came with your class or profession rather than one you
    // spent: green, which in this panel is what is already yours. Written at
    // the same weight as the .some and .full pip rules above and after them,
    // so it wins the tie whatever the rest of the row is.
    '#ts-skills .skill.some .pip.given,#ts-skills .skill.full .pip.given,#ts-skills .skill .pip.given{',
    'background:#7fb877;border-color:#9fcf92}',
    // how far off the next rank is, one line per half, above the tree. Words
    // and a number, never a bar: a bar with no number on it says nothing.
    '#ts-skills .progress{max-width:680px;margin:0 0 16px;padding-bottom:12px;border-bottom:1px solid rgba(198,170,109,.18)}',
    '#ts-skills .prow{display:flex;align-items:baseline;gap:18px;padding:4px 0}',
    '#ts-skills .prow .pk{flex:0 0 150px;font-size:11.5px;letter-spacing:.24em;text-transform:uppercase;color:rgba(198,170,109,.85)}',
    '#ts-skills .prow .pv{flex:1 1 auto;min-width:0;font-size:14px;color:#d9cfb4}',
    '#ts-skills .plus{width:26px;height:26px;border:1px solid rgba(198,170,109,.55);color:#e9d19b;display:grid;place-items:center;',
    'font-size:18px;line-height:1;background:rgba(0,0,0,.25);cursor:pointer}',
    '#ts-skills .plus.off{opacity:.25;pointer-events:none}',
    // A filled perk a person starts (Font of Magic): under the perk's words.
    '#ts-skills .skill .use{grid-column:1/4;justify-self:start;margin-top:6px;padding:3px 14px;border:1px solid rgba(198,170,109,.55);',
    'color:#e9d19b;background:rgba(0,0,0,.25);font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;cursor:pointer}',
    '#ts-skills .skill .use.off{opacity:.35;pointer-events:none}',
    // foot: the hint on the left takes what is left and wraps; the buttons never shrink
    '#ts-skills .foot{grid-column:1/3;min-width:0;display:flex;align-items:center;justify-content:space-between;gap:24px;',
    'padding:14px 32px;border-top:1px solid rgba(198,170,109,.22)}',
    '#ts-skills .status{flex:1 1 auto;min-width:0;font-size:13.5px;line-height:1.4;color:rgba(217,207,180,.7);font-style:italic;min-height:1.4em}',
    '#ts-skills .status.ok{color:#9fcf92;font-style:normal}',
    '#ts-skills .status.no{color:#d9a27a;font-style:normal}',
    '#ts-skills .btns{flex:0 0 auto;display:flex;gap:10px;align-items:stretch}',
    '#ts-skills .tsbtn{display:inline-flex;align-items:center;justify-content:center;gap:10px;height:40px;padding:0 24px;',
    'border:1px solid rgba(198,170,109,.55);font-size:13px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;',
    'color:#e9d19b;background:rgba(0,0,0,.25);font-family:inherit;cursor:pointer}',
    '#ts-skills .tsbtn.primary{background:#c6aa6d;border-color:#e9d19b;color:#1b1205}',
    '#ts-skills .tsbtn.primary.off{opacity:.35;pointer-events:none}',
    // Close Skyrim once it is armed, the colours of the character page's own
    // Close the game when it asks the second time (thornswood-select.js).
    '#ts-skills .tsbtn.danger{border-color:#e9a27a;color:#f6c9b0;background:rgba(120,40,30,.45)}',
    // The buttons are .tsbtn, not .btn, and the name matters: the front's own
    // stylesheet (build.js, in this same document) carries an unscoped .btn
    // rule with width 50px, height 50px and margin 20px. Our rules are scoped
    // under #ts-skills and win on every property they set, but a property
    // they do not set comes through from theirs, and on 20 September that
    // gave Confirm a 50px box with five letters showing. A class name nobody
    // else uses is the only rule that holds against a stylesheet we do not
    // write.
    // review, while creating: one row per choice, the key on the left
    '#ts-skills .review{max-width:680px;margin:2px 0 18px}',
    '#ts-skills .rrow{display:flex;align-items:baseline;gap:24px;padding:11px 0;border-bottom:1px solid rgba(198,170,109,.18)}',
    '#ts-skills .rrow .rk{flex:0 0 150px;font-size:11.5px;letter-spacing:.24em;text-transform:uppercase;color:rgba(198,170,109,.85)}',
    '#ts-skills .rrow .rv{flex:1 1 auto;min-width:0;font-size:16px;color:#f6e9c8}',
    '#ts-skills .rrow .rv.chosen{color:#e9d19b}',
    '#ts-skills .rrow .rv.set{color:#9fcf92}',
    '#ts-skills .rrow .rv.dim{color:rgba(217,207,180,.58);font-style:italic}',
    '#ts-skills .rrow .rv.need{color:#e9d19b;font-style:italic}',
    // the spell book
    '#ts-skills .spellbar{display:flex;justify-content:space-between;align-items:baseline;gap:16px;margin:0 0 12px}',
    '#ts-skills .spellpts{font-size:14px;color:#e9d19b}',
    '#ts-skills .spellnote{font-size:12px;font-style:italic;color:rgba(217,207,180,.55)}',
    '#ts-skills .spellcols{grid-template-columns:repeat(2,minmax(0,1fr))}',
    // the school's name on the left, the server's rank in it on the right
    '#ts-skills .spellcols .colhead{display:flex;align-items:baseline;justify-content:space-between;gap:10px}',
    '#ts-skills .rankhead{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:rgba(217,207,180,.5);margin:10px 0 4px}',
    '#ts-skills .spell{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 10px;',
    'border:1px solid transparent;cursor:pointer}',
    '#ts-skills .spell.at{border-color:transparent;box-shadow:inset 3px 0 0 0 rgba(198,170,109,.75)}',
    '#ts-skills .spell.on .spellname{color:#f6e9c8}',
    '#ts-skills .spell.mine .spellname{color:#9fcf92}',
    '#ts-skills .spellname{font-size:14px}',
    '#ts-skills .spell.shut .spellname{color:rgba(217,207,180,.38)}',
    '#ts-skills .spell.shut{cursor:default}',
    // the recipe book, written against the spell book's rules above so the two
    // sections read as one panel: the same two columns, the same column head
    // with a rank on the right, the same row height. Nothing here is
    // clickable, so no cursor rule and no lit row.
    '#ts-skills .bookcols{grid-template-columns:repeat(2,minmax(0,1fr))}',
    // Two halves is everybody; the third and fourth columns are a character a
    // Master has taught, which the rulebook allows twice, so four is the most
    // there can ever be and three across fits them without a second row.
    '#ts-skills .bookcols.wide{grid-template-columns:repeat(3,minmax(0,1fr))}',
    '#ts-skills .bookcols .colhead{display:flex;align-items:baseline;justify-content:space-between;gap:10px}',
    '#ts-skills .bookhow{font-size:12px;font-style:italic;color:rgba(217,207,180,.58);line-height:1.45;margin:8px 0 2px}',
    '#ts-skills .bookopen{font-size:13px;color:#e9d19b;margin:0 0 6px}',
    '#ts-skills .bookrow{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 10px}',
    '#ts-skills .bookrow .bn{font-size:14px;color:#f6e9c8}',
    '#ts-skills .bookrow .bv{font-size:12.5px;color:rgba(217,207,180,.66);white-space:nowrap}',
    '#ts-skills .bookwhy{font-size:12.5px;line-height:1.5;color:rgba(217,207,180,.7);margin:8px 0 0}',
    /*
      Scrollbars, here and everywhere else in this window.

      The browser's own is a white strip down the side of a dark panel, which
      in a dark room reads as a fault rather than as a control: Patrick called
      it a flash bang on 20 September, and said it is in all the menus rather
      than only this one. Every page in the game is drawn in one document, so
      these rules are written without a page in front of them and the whole
      window matches, the front's own pages included. They are the same rules
      the character choice at the main menu carries, because that page is up
      before this one is loaded.
    */
    '::-webkit-scrollbar{width:10px;height:10px}',
    '::-webkit-scrollbar-track{background:rgba(0,0,0,.25)}',
    '::-webkit-scrollbar-thumb{background:rgba(198,170,109,.35);border:2px solid transparent;',
    'background-clip:padding-box;border-radius:6px}',
    '::-webkit-scrollbar-thumb:active{background:rgba(233,209,155,.55);background-clip:padding-box}',
    '::-webkit-scrollbar-corner{background:transparent}',
    // the K, drawn as a key cap beside Close
    '#ts-skills .key{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;',
    'border:1px solid rgba(233,209,155,.55);border-bottom-width:2px;border-radius:3px;background:rgba(0,0,0,.35);',
    'font-size:11px;letter-spacing:0;line-height:1;color:#e9d19b}'
  ].join('');

  var style = document.createElement('style');
  style.id = 'ts-skills-css';
  style.textContent = css;
  document.head.appendChild(style);

  // ----------------------------------------------------------------- dom --
  var root = document.createElement('div');
  root.id = 'ts-skills';
  root.className = 'gone';
  root.innerHTML =
    '<div class="panel">' +
      '<div class="head"><div><div class="eyebrow">Thornswood</div><div class="title"></div></div><div class="who"></div></div>' +
      '<div class="nav"></div>' +
      '<div class="body"></div>' +
      '<div class="foot"><div class="status"></div><div class="btns">' +
        '<div class="tsbtn ghost" data-act="switch">Change character</div>' +
        '<div class="tsbtn ghost" data-act="help">Help</div>' +
        '<div class="tsbtn ghost" data-act="settings">Settings</div>' +
        '<div class="tsbtn ghost" data-act="close"><span>Close</span><span class="key">K</span></div>' +
        '<div class="tsbtn primary" data-act="confirm">Confirm</div>' +
      '</div></div>' +
    '</div>';
  document.body.appendChild(root);

  var elTitle = root.querySelector('.title');
  var elWho = root.querySelector('.who');
  var elNav = root.querySelector('.nav');
  var elBody = root.querySelector('.body');
  var elStatus = root.querySelector('.status');
  var elConfirm = root.querySelector('[data-act="confirm"]');
  var elClose = root.querySelector('[data-act="close"]');
  // Help (#1633), beside Close: the help panel, and this one put down. Never
  // while creating, where this panel is the whole of what there is to do.
  var elHelp = root.querySelector('[data-act="help"]');
  // Change character (#3128), beside Help and never while creating: the
  // front waits ten seconds with the character out of combat and standing
  // still, then takes the game to the character choice. Pressed again, it
  // stops the wait.
  var elSwitch = root.querySelector('[data-act="switch"]');
  // Settings beside it (#3126), and never while creating either.
  var elSettings = root.querySelector('[data-act="settings"]');
  // The word inside the Close button, so drawFoot can say Close Skyrim while
  // creating without rebuilding the button or losing its key cap.
  var elCloseLabel = elClose.querySelector('span');
  // And its K key cap, which is hidden while creating: there the button
  // closes Skyrim, and K never does. See closeButton.
  var elCloseKey = elClose.querySelector('.key');
  var elPanel = root.querySelector('.panel');

  /*
    Laid out for 1920x1080 and scaled up from there: at 3440x1440 the first
    cut was a postage stamp. The scale is the smaller of the two ratios, so
    the scaled box is at most 1120/1920 of the width and 700/1080 of the
    height, and never meets the edge: 1920x1080 and 2560x1080 draw it as is,
    3440x1440 draws it at 1.333 (1493 by 933), 2000x837 is below 1 and draws
    it as is, 700 tall in 837.
  */
  function fit() {
    try {
      var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      if (!isFinite(s) || s < 1) s = 1;
      elPanel.style.transformOrigin = 'center center';
      elPanel.style.transform = 'scale(' + Math.min(s, 2.4).toFixed(3) + ')';
    } catch (e) { }
  }
  window.addEventListener('resize', fit);

  function tell(what, extra) {
    try {
      window.skyrimPlatform.sendMessage('thornswood-front', 'skills:' + what + (extra ? ' ' + extra : ''));
    } catch (e) { }
  }

  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined && text !== null) d.textContent = text;
    return d;
  }
  function cap(s) { s = String(s || ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function nameOf(sec, key) {
    var rows = DATA[sec] ? DATA[sec].rows : [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].key === key) return rows[i].name;
      var subs = rows[i].subs || [];
      for (var j = 0; j < subs.length; j++) if (subs[j].key === key) return subs[j].name;
    }
    return cap(key);
  }
  function creating() { return !!(mine && mine.creating); }
  function isMage() {
    if (mine && mine.profession) return mine.profession === 'mage';
    // Nothing confirmed yet: the Mage card lit while creating counts, so the
    // book is there to read before the profession is sent.
    var p = picked.profession;
    return !!(creating() && p && p.row === 'mage');
  }
  /* The schools the spell book shows: the server's, or the ones lit on the Mage card. */
  function bookSchools() {
    if (mine && mine.profession) return mine.profession === 'mage' ? (mine.schools || []).slice() : [];
    var p = picked.profession;
    return (creating() && p && p.row === 'mage') ? (p.subs || []).slice() : [];
  }
  /*
    THE RECIPE BOOK, WHICH IS THE SERVER'S ANSWER AND NOT THIS PAGE'S.

    The server sends it whole, under mine.book:

      book: { halves: [ { key, name, how, rank, open, total,
                          families: [ { name, open, total } ], why } ],
              none: '<the sentence for a character with no half at all>' }

    how is 'own', 'sister' or 'taught', which is the three ways classes.md
    lets somebody stand in a half. why is there instead of families when
    there is nothing open, and it is the server's sentence: five of the
    fourteen halves own no recipe in the whole game, and which five and why
    is a fact about the build rather than an opinion of this page's.

    The field is absent for a mage with no craft half taught to them, which
    is how the section knows not to draw itself at all. Anything else, a
    shape this page does not recognise included, reads as no book and the
    section stays away rather than drawing a wrong one.
  */
  function recipeBook() {
    var got = mine && mine.book;
    if (!got || typeof got !== 'object' || Array.isArray(got)) { return null; }
    if (!Array.isArray(got.halves)) { return null; }
    return got;
  }
  function recipeHalves() {
    var book = recipeBook();
    if (!book) { return []; }
    var out = [];
    for (var i = 0; i < book.halves.length; i++) {
      var h = book.halves[i];
      if (h && typeof h === 'object' && h.name) { out.push(h); }
    }
    return out;
  }
  /*
    The one line under a half's name saying why it is yours, and how far it
    goes. "24 of 302" under a sister half with no explanation reads as a page
    that is broken rather than a rule that is working, so the rule is said.

    IT READS THE RANK THE SERVER SENT AND NEVER A CEILING OF ITS OWN. Until
    21 September this said "Its novice work is yours for nothing, and no
    further" whatever the server sent, which was a second copy of a rule the
    server deliberately refused to keep. tools\gamemode.js bookView sends each
    half at P.rankOf, and the comment over that line says why in as many words:
    rankUp lets a sister half climb when a Master of it takes the person on, so
    writing novice into the reader would be wrong for the one character the
    rule was written for. The client kept the copy anyway.

    What it looked like: a Smith/Edgewright whose Master Platewright took them
    on has ranks.platewright advanced, and the server sends
    { how: 'sister', rank: 'advanced', open: 415, total: 771 }. The column drew
    the tag "Advanced", then "Its novice work is yours for nothing, and no
    further", then "415 of 771 open", three lines in a row that cannot all be
    true, and the middle one told somebody who had earned advanced sister work
    that they did not have it.
  */
  function howYouHoldIt(how, rank) {
    var at = RANK_NAMES[rank] || (rank ? cap(String(rank)) : 'Novice');
    if (how === 'sister') {
      if (rank && rank !== 'novice') {
        return 'Your sister half. A Master of it took you on, so it is yours up to ' + at + '.';
      }
      return 'Your sister half. Its novice work is yours for nothing, and it goes further only if a Master of it takes you on.';
    }
    if (how === 'taught') {
      if (rank && rank !== 'novice') {
        return 'Taught to you by a Master of another profession, and yours up to ' + at + '.';
      }
      return 'Taught to you by a Master of another profession. Novice work, and it never goes past it.';
    }
    return 'Your own half. It opens as your rank climbs.';
  }

  /*
    Which spells are open to you, and why one is not.

    Two rules, Patrick's, 20 September: a spell of a rank above Novice needs
    your rank in that school to have reached it, and it needs at least one
    spell of the rank below already in your book. So during creation, when
    nobody has a rank in anything, only Novice spells can be marked. The
    first cut let a Conjuration Advanced spell be marked with no Novice one
    under it, which is what he caught.

    A spell already marked on this page counts as one you have for the rank
    below, so marking Flames opens Advanced Destruction the moment the rank
    allows it. The server grants nothing from here yet; this is the shape of
    the rule, and the rules themselves stay the server's.
  */
  var RANK_ORDER = ['novice', 'advanced', 'expert', 'master'];
  function rankIndex(key) {
    var i = RANK_ORDER.indexOf(String(key || 'novice'));
    return i < 0 ? 0 : i;
  }
  /* The rank this character has reached in that school. The server's, or Novice. */
  function schoolRank(school) { return rankOf(school) || 'novice'; }
  /*
    The spells the server says are yours, by name.

    It sends them as { Flames: true }. A list of names, or the stored
    { points: 2, known: [...] } shape, reads the same way here: what arrives
    is the server's to name, and this page only reads it. A shape it does not
    know reads as no spells, which draws an empty book rather than a wrong one.
  */
  function knownOf(view) {
    var out = {};
    var got = view && view.spells;
    if (!got || typeof got !== 'object') return out;
    var list = null;
    if (Array.isArray(got)) list = got;
    else if (Array.isArray(got.known)) list = got.known;
    if (list) {
      for (var i = 0; i < list.length; i++) if (list[i]) out[String(list[i])] = true;
      return out;
    }
    for (var k in got) if (got[k] === true) out[k] = true;
    return out;
  }
  function knownSpells() { return knownOf(mine); }
  /* Does the book hold a spell of that rank in that school, granted or marked. */
  function holdsRank(school, rankKey) {
    var book = DATA.spells;
    if (!book || !book.schools[school]) return false;
    var have = knownSpells();
    var names = book.schools[school][rankKey] || [];
    for (var i = 0; i < names.length; i++) {
      if (have[names[i]] || marked[names[i]]) return true;
    }
    return false;
  }
  /*
    Empty when the spell is open, otherwise the short reason it is not, in
    the words a person would use.
  */
  function lockedBecause(school, rankKey) {
    var want = rankIndex(rankKey);
    if (want === 0) return '';
    if (want > rankIndex(schoolRank(school))) {
      return 'needs ' + (RANK_NAMES[rankKey] || cap(rankKey)) + ' ' + cap(school);
    }
    var below = RANK_ORDER[want - 1];
    if (!holdsRank(school, below)) {
      return 'needs a ' + (RANK_NAMES[below] || below).toLowerCase() + ' spell first';
    }
    return '';
  }

  /*
    Spell points: the server's number, or the rulebook's two while there is
    no character yet, or nothing at all.

    The server sends it as mine.spellPoints, or as the points on mine.spells
    when what arrives is the stored shape. While creating it has said
    nothing, because there is nobody to say it about, so the two the
    rulebook gives a new mage stand in: "A mage picks two schools, then two
    starting spells" (site\data\site\classes.md).

    In the world there is no standing in. A mage the server has sent no
    number for reads as no number: null, and every line that would print one
    checks for it and prints nothing instead. This used to fall back to two
    whatever the character was, so a Master with three spells read "2 of 2
    spell points left", which is the page inventing the one thing it must
    never invent. Nothing is spent here either; a mark holds a point on this
    page until a pick is answered.
  */
  var STARTING_SPELL_POINTS = 2;   // the rulebook's, classes.md: two starting spells
  function spellPoints() {
    /*
      WHILE CREATING, THE SERVER'S NUMBER IS ABOUT SOMEBODY WHO HAS NOT
      CHOSEN YET, AND THAT IS WHY IT HAD TO BE IGNORED HERE.

      Patrick, 22 September: mages "got their points after creation but had 0
      during creation". Exactly that. The server sends spellPoints on every
      panel, out of the rules, and the rules are right: a character with no
      profession is not a mage and has no points, so during creation it sends
      0. Nobody is a mage until Confirm.

      The fallback below was written for this and could never fire, because it
      only answers when the server has said NOTHING and the server always says
      something. So the book drew with no points, and a mage picked their two
      starting spells by not being able to.

      bookSchools right underneath already reads the lit Mage card while
      creating rather than the server's empty answer. This is the same
      question about the same card and now it is answered the same way. Once
      the profession is confirmed, mine.profession is set, isMage stops
      reading the card, and the server's number is the only one used: a Master
      with three spells must never be told they have two.
    */
    if (creating() && !(mine && mine.profession) && isMage()) return STARTING_SPELL_POINTS;
    if (mine && mine.spellPoints !== undefined && mine.spellPoints !== null) return Number(mine.spellPoints) || 0;
    var got = mine && mine.spells;
    if (got && typeof got === 'object' && !Array.isArray(got) && got.points !== undefined && got.points !== null) {
      return Number(got.points) || 0;
    }
    return creating() ? STARTING_SPELL_POINTS : null;
  }
  function markedCount() { return markedNames().length; }
  /*
    What is left after the marks, or null when there is no number to count
    down from. Every caller has to tell null from 0: null is the server
    saying nothing and a mark is still allowed, 0 is the server saying none
    and a mark is not.
  */
  function pointsLeft() {
    var p = spellPoints();
    if (p === null) return null;
    return Math.max(0, p - markedCount());
  }
  /*
    The marked spells, in the order the book draws them, which is the order
    they are sent in. Read off the book rather than off the marks, so a mark
    left behind by a school that is no longer yours counts for nothing and is
    never sent.
  */
  function markedNames() {
    var out = [];
    bookRows().forEach(function (r) { if (marked[r.name] && out.indexOf(r.name) < 0) out.push(r.name); });
    return out;
  }
  /*
    Mark or unmark a spell; a mark needs a point and an open rank. True when
    something changed.

    Unmarking can shut a rank above it, so anything that is no longer open
    loses its mark with it: marking Flames, then Firebolt, then unmarking
    Flames must not leave Firebolt marked under nothing.
  */
  function toggleMark(school, rankKey, name) {
    // A spell the server has granted is not a mark and never comes off.
    if (knownSpells()[name]) { status = name + ' is yours already.'; statusKind = 'no'; return false; }
    if (marked[name]) { marked[name] = false; tidyMarks(); return true; }
    var why = lockedBecause(school, rankKey);
    if (why) { status = cap(name) + ' ' + why + '.'; statusKind = 'no'; return false; }
    // null is the server saying nothing about points, and a mark it has not
    // ruled on goes on the page: the server is the one that refuses it.
    var left = pointsLeft();
    if (left !== null && left <= 0) { status = 'No spell points left. Unmark one to mark another.'; statusKind = 'no'; return false; }
    marked[name] = true;
    return true;
  }

  /* Drop any mark that is no longer open, until nothing more falls. */
  function tidyMarks() {
    var book = DATA.spells;
    if (!book) return;
    var again = true;
    while (again) {
      again = false;
      bookSchools().forEach(function (sc) {
        var byRank = book.schools[sc] || {};
        book.ranks.forEach(function (r) {
          (byRank[r.key] || []).forEach(function (nm) {
            if (marked[nm] && lockedBecause(sc, r.key)) { marked[nm] = false; again = true; }
          });
        });
      });
    }
  }
  /* First steps (#3166): the server's, under mine.firstSteps, or null when there are none. */
  function startView() {
    var got = mine && mine.firstSteps;
    if (!got || typeof got !== 'object' || Array.isArray(got) || !Array.isArray(got.steps)) return null;
    return got;
  }
  var startOpened = false;   // the page opens on First steps once, the first time it arrives
  /* Hair dye (#2675): the server's, under mine.hairDye, or null when you carry none. */
  function dyeView() {
    var got = mine && mine.hairDye;
    if (!got || typeof got !== 'object' || Array.isArray(got)) return null;
    return got;
  }
  function dyeList() {
    var v = dyeView();
    return (v && Array.isArray(v.dyes)) ? v.dyes.filter(function (d) {
      return d && typeof d.id === 'string' && /^[a-z0-9-]+$/.test(d.id);
    }) : [];
  }
  /* Masters and apprentices (#1634): the server's, under mine.apprentice, or null with no profession. */
  function apprView() {
    var got = mine && mine.apprentice;
    if (!got || typeof got !== 'object' || Array.isArray(got)) return null;
    return got;
  }
  function apprList(field) {
    var v = apprView();
    return (v && Array.isArray(v[field])) ? v[field] : [];
  }
  /* A school or Bladebinder: ending it leaves the spells learned from it (Patrick, on #1388). */
  function spellHalf(key) {
    var r = rowOf('profession', 'mage');
    var schools = r ? (r.subs || []).map(function (s) { return s.key; }) : [];
    return schools.indexOf(key) >= 0 || key === 'bladebinder';
  }
  /* The College page (#1387): the server's, under mine.college, or null when magic is not open to them. */
  function collegeView() {
    var got = mine && mine.college;
    if (!got || typeof got !== 'object' || Array.isArray(got)) return null;
    return got;
  }
  /* The Alchemy journal (#3142): the server's, under mine.alchemy, or null with nothing on it. */
  function alchemyView() {
    var got = mine && mine.alchemy;
    if (!got || typeof got !== 'object' || Array.isArray(got)) return null;
    return got;
  }
  function alchemyList(field) {
    var v = alchemyView();
    return (v && Array.isArray(v[field])) ? v[field].filter(function (r) { return r && typeof r === 'object'; }) : [];
  }
  /* The Body page (#1631): the server's, under mine.body, or null while creating. */
  function bodyView() {
    var got = mine && mine.body;
    if (!got || typeof got !== 'object' || Array.isArray(got)) return null;
    return got;
  }
  /* The meters that are not fine, in a word each, for the section list. */
  function bodyWorries(v) {
    var out = [];
    if (!v) return out;
    var words = { food: 'hungry', drink: 'thirsty', rest: 'tired' };
    for (var k in words) if (v[k + 'Band'] && v[k + 'Band'] !== 'fine') out.push(words[k]);
    if (v.tempBand && v.tempBand !== 'fine') out.push(tempWord(v.temp).toLowerCase());
    return out;
  }
  /* The word the bars at the bottom left give a reading (hudScript in the
     needs block), so the page and the bar never call one number two things. */
  function tempWord(t) {
    t = Number(t) || 0;
    if (t < 15) return 'Freezing';
    if (t < 30) return 'Cold';
    if (t < 42) return 'Chilly';
    if (t <= 58) return 'Fine';
    if (t <= 70) return 'Warm';
    if (t <= 85) return 'Hot';
    return 'Burning';
  }

  /* The Office page (#1638): the server's, under mine.officePage, or null for somebody with no office. */
  function officePage() {
    var got = mine && mine.officePage;
    if (!got || typeof got !== 'object' || Array.isArray(got)) return null;
    return got;
  }
  /* When a semester opens, as a time on this machine's clock: today, tomorrow, or the date. */
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                'September', 'October', 'November', 'December'];
  function whenOpens(ms) {
    var d = new Date(ms);
    var t = new Date();
    var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    var day = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    var then = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (then === day) return 'today at ' + hm;
    if (then === day + 86400000) return 'tomorrow at ' + hm;
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' at ' + hm;
  }
  /*
    THE STAFF SPELL PAGE, an Enchanter's spell book (#1128). The same three
    rules as the spell book above, over the Bladebinder rank the server sends
    instead of a school's: a staff spell point, the rank, and a staff spell of
    the rank below already unlocked or marked (Novice needs none). Everything
    here is read off mine.staff; a shape this page does not know reads as no
    page, and the section is not drawn.
  */
  function staffBook() {
    var got = mine && mine.staff;
    if (!got || typeof got !== 'object' || Array.isArray(got)) return null;
    if (!Array.isArray(got.spells) || !Array.isArray(got.mine)) return null;
    return got;
  }
  /* Every staff spell, flat, in the order the server sent them: [{ desc, name, rank }]. */
  function staffRows() {
    var book = staffBook();
    var out = [];
    if (!book) return out;
    book.spells.forEach(function (r) {
      if (Array.isArray(r) && r[0] && r[1] && RANK_NAMES[r[2]]) out.push({ desc: String(r[0]), name: String(r[1]), rank: String(r[2]) });
    });
    return out;
  }
  function staffMine() {
    var out = {};
    var book = staffBook();
    if (book) book.mine.forEach(function (d) { out[String(d)] = true; });
    return out;
  }
  /* Holds a staff spell of that rank, unlocked or marked. */
  function holdsStaffRank(rankKey) {
    var have = staffMine();
    var list = staffRows();
    for (var i = 0; i < list.length; i++) {
      if (list[i].rank === rankKey && (have[list[i].desc] || markedStaff[list[i].desc])) return true;
    }
    return false;
  }
  /* Empty when the rank is open, otherwise the short reason it is not. */
  function staffLocked(rankKey) {
    var want = rankIndex(rankKey);
    if (want === 0) return '';
    var book = staffBook();
    if (want > rankIndex(book && book.rank)) return 'needs ' + (RANK_NAMES[rankKey] || cap(rankKey)) + ' Bladebinder';
    var below = RANK_ORDER[want - 1];
    if (!holdsStaffRank(below)) return 'needs a ' + (RANK_NAMES[below] || below).toLowerCase() + ' staff spell first';
    return '';
  }
  /* The server's staff spell points, or null when it has said nothing. */
  function staffPoints() {
    var book = staffBook();
    if (!book || book.points === undefined || book.points === null) return null;
    return Number(book.points) || 0;
  }
  /* The weapon line on the Might row: what each weight needs, and what you hold. */
  function gateLine(gate, have) {
    var bits = [];
    for (var i = gate.length - 1; i >= 0; i--) {
      bits.push('weapons weighing ' + gate[i].weight + (i > 0 ? ' to ' + (gate[i - 1].weight - 1) : ' or more') + ' need Might ' + gate[i].might);
    }
    var ok = 0;
    for (var j = 0; j < gate.length; j++) { if (have >= gate[j].might) { ok = gate[j].might; break; } }
    var holds = !ok ? 'You can wield neither yet.' : (ok >= gate[0].might ? 'You can wield any of them.' : 'You can wield the first, not the second.');
    return 'Strength: ' + bits.join(', and ') + '. ' + holds;
  }

  /* The marked staff spells, in the order the page draws them, which is the order they are sent in. */
  function markedStaffDescs() {
    var out = [];
    staffRows().forEach(function (r) { if (markedStaff[r.desc] && out.indexOf(r.desc) < 0) out.push(r.desc); });
    return out;
  }
  function staffLeft() {
    var p = staffPoints();
    if (p === null) return null;
    return Math.max(0, p - markedStaffDescs().length);
  }
  function staffNameOf(desc) {
    var list = staffRows();
    for (var i = 0; i < list.length; i++) if (list[i].desc === desc) return list[i].name;
    return desc;
  }
  /* Mark or unmark a staff spell; the same rules as toggleMark. True when something changed. */
  function toggleStaff(desc, rankKey, name) {
    if (staffMine()[desc]) { status = name + ' is unlocked already.'; statusKind = 'no'; return false; }
    if (markedStaff[desc]) { markedStaff[desc] = false; tidyStaff(); return true; }
    var why = staffLocked(rankKey);
    if (why) { status = cap(name) + ' ' + why + '.'; statusKind = 'no'; return false; }
    var left = staffLeft();
    if (left !== null && left <= 0) { status = 'No staff spell points left. Unmark one to mark another.'; statusKind = 'no'; return false; }
    markedStaff[desc] = true;
    return true;
  }
  /* Drop any staff mark that is no longer open, until nothing more falls. */
  function tidyStaff() {
    var again = true;
    while (again) {
      again = false;
      staffRows().forEach(function (r) {
        if (markedStaff[r.desc] && staffLocked(r.rank)) { markedStaff[r.desc] = false; again = true; }
      });
    }
  }

  function rows() { return DATA[section] ? DATA[section].rows : []; }
  function titleOf(sec) { return DATA[sec] ? DATA[sec].title : cap(sec); }
  function rowOf(sec, key) {
    var rs = DATA[sec] ? DATA[sec].rows : [];
    for (var i = 0; i < rs.length; i++) if (rs[i].key === key) return rs[i];
    return null;
  }

  // ----------------------------------------------------- what you already are --
  function haveClass() { return !!(mine && mine['class']); }
  function haveProf() { return !!(mine && mine.profession); }
  function haveHome() { return !!(mine && mine.home); }
  function rankOf(key) { return (mine && mine.ranks && mine.ranks[key]) || ''; }
  function ownHalves() {
    if (!mine) return [];
    if (mine.half) return [mine.half];
    return (mine.schools || []).slice();
  }
  function summary() {
    var bits = [];
    if (haveClass()) bits.push(nameOf('class', mine['class']));
    if (haveProf()) {
      var halves = ownHalves().map(function (h) { return nameOf('profession', h); });
      bits.push(nameOf('profession', mine.profession) + (halves.length ? ', ' + halves.join(' and ') : ''));
    }
    return bits.join(' · ');
  }
  /*
    The points that were placed at creation, per the contract's mine.placed.
    They came with the class and profession that were chosen, they are part
    of mine.tree like any other point, and they are not yours to move.

    Read against the tree, so a number for a skill that holds fewer points
    than the server says were placed counts only as far as the pips go, and
    a number for a skill that is not in the tree counts for nothing.
  */
  function placedAt(key) {
    var got = mine && mine.placed;
    if (!got || typeof got !== 'object') return 0;
    var n = Number(got[key]);
    if (!isFinite(n) || n <= 0) return 0;
    var have = Number((mine.tree || {})[key]) || 0;
    return Math.min(Math.floor(n), have, CAP);
  }
  function placedTotal() {
    var total = 0;
    var attrs = (DATA.tree && DATA.tree.rows) || [];
    for (var i = 0; i < attrs.length; i++) {
      var subs = attrs[i].subs || [];
      for (var j = 0; j < subs.length; j++) total += placedAt(subs[j].key);
    }
    return total;
  }
  function topRank() {
    var best = '';
    var own = ownHalves();
    for (var i = 0; i < own.length; i++) {
      var r = rankOf(own[i]);
      if (!best || ['novice', 'advanced', 'expert', 'master'].indexOf(r) > ['novice', 'advanced', 'expert', 'master'].indexOf(best)) best = r;
    }
    return best;
  }

  /*
    How far off the next rank is, when the server sends it, and silence when
    it does not.

    The contract, at the head of this file:

      progress: { '<key>': { next: '<the rank being climbed to>',
                             done: <number>, need: <number> } }

    One entry per half, school or class verb that can still climb, under the
    same keys as ranks, so 'platewright' and 'hunter' and 'destruction' all
    read the same way. The remainder drawn is need less done. How much work a
    rank takes is the server's number and is nowhere on this page, and an
    entry without a next rank or without the numbers draws no line at all,
    because a line reading "Advanced in 0 more" would be this page inventing
    one. A field that is not an object draws nothing and throws nothing.

    left and unit are the shape this page asked for before the contract was
    agreed. They are still read, so a server that has not caught up draws a
    line rather than nothing; the contract does not send them.
  */
  function labelOf(key) {
    var n = nameOf('profession', key);
    return n !== cap(key) ? n : nameOf('class', key);
  }
  function progressLines() {
    var out = [];
    var got = mine && mine.progress;
    if (!got || typeof got !== 'object') return out;
    for (var k in got) {
      var p = got[k];
      if (!p || typeof p !== 'object') continue;
      var next = p.next ? (RANK_NAMES[p.next] || cap(p.next)) : '';
      if (!next) continue;
      var left = null;
      if (p.need !== undefined && p.need !== null) left = Number(p.need) - (Number(p.done) || 0);
      else if (p.left !== undefined && p.left !== null) left = Number(p.left);
      if (left === null || !isFinite(left)) continue;
      out.push({ k: labelOf(k),
                 t: left > 0 ? next + ' in ' + left + ' more' + (p.unit ? ' ' + p.unit : '') : next + ' earned' });
    }
    return out;
  }
  /*
    Which lines there are and in what order, and not a single one of their
    numbers. This is what decides a rebuild; the numbers are written into the
    lines in place (see drawProgress), because a work counter ticking every
    time somebody swings a hammer must not tear the panel down under
    somebody who is reading it.
  */
  function progressShape() {
    return progressLines().map(function (p) { return p.k; });
  }

  /*
    "Choose later" is offered while creating, in Class and Profession, and
    only while that one is still unset. Home never has it: a home is the one
    choice that has to be made before leaving the hall. In the world there is
    no later to choose; the cards are there and they send as they always did.
  */
  function laterOffered(sec) {
    if (!creating()) return false;
    if (sec === 'class') return !haveClass();
    if (sec === 'profession') return !haveProf();
    return false;
  }
  /*
    Soft choices, while creating. A click marks a card on this page and
    sends nothing; Begin, in Review, sends them all. These read the marks,
    for the section list and for Review, and say whether a profession is
    whole: its half picked, or both schools for a mage.
  */
  function choose(sec, row, subs) { picked[sec] = { row: row, subs: subs || [] }; later[sec] = false; }
  function chooseLater(sec) { later[sec] = true; picked[sec] = null; }
  function softProf() {
    var p = picked.profession;
    var r = (p && p.row) ? rowOf('profession', p.row) : null;
    if (!r) return null;
    var want = r.pick || 1;
    var subs = (p.subs || []).map(function (h) { return nameOf('profession', h); });
    if (subs.length >= want) return { t: r.name + ', ' + subs.join(' and '), c: 'chosen', whole: true };
    return { t: r.name + ', ' + (want > 1 ? subs.length + ' of ' + want + ' schools' : 'no half yet'), c: 'need', whole: false };
  }
  function softClass() {
    var p = picked['class'];
    var r = (p && p.row) ? rowOf('class', p.row) : null;
    return r ? { t: r.name, c: 'chosen' } : null;
  }
  function softHome() {
    var p = picked.home;
    var towns = (mine && mine.towns) || [];
    for (var i = 0; i < towns.length; i++) {
      if (p && towns[i].key === p.row) return { t: towns[i].name, hold: towns[i].hold || '', c: 'chosen' };
    }
    return null;
  }
  function countRows() {
    if (section === 'home') return ((mine && mine.towns) || []).length;
    if (section === 'tree') return 15;
    if (section === 'spells') return bookRows().length;
    if (section === 'staff') return staffRows().length;
    // The College page is a page to read: the semester is the desk's.
    if (section === 'college') return 0;
    // Masters and apprentices: its buttons are on its cards.
    if (section === 'apprentice') return 0;
    // Hair dye: its buttons are on its cards.
    if (section === 'hairdye') return 0;
    // First steps: what is true, and one button.
    if (section === 'start') return 0;
    // Nothing in the recipe book is picked, marked or sent, so there is no
    // row for the arrow keys to walk. Left and right still move sections.
    if (section === 'recipes') return 0;
    // The guides are read, not picked: the profession is chosen on its tab.
    if (section === 'guides') return 0;
    // Nothing on the property page is picked, marked or sent either. It is a
    // list of what is already true.
    if (section === 'property') return 0;
    // The Office page is buttons beside what is true; nothing is marked.
    if (section === 'office') return 0;
    // The Body page is what is true, and one button to read it again.
    if (section === 'body') return 0;
    // The Alchemy journal is what is true, and nothing on it is sent.
    if (section === 'alchemy') return 0;
    return rows().length + (laterOffered(section) ? 1 : 0);
  }
  /* Another section: the top row, and the status line back to the hint. */
  function goTo(sec) { section = sec; rowAt = 0; status = ''; statusKind = ''; }

  // ------------------------------------------------------------------ draw --
  /*
    Everything head, nav and body are drawn from, as one string. When the
    string is the one drawn last, nothing is touched, which is what makes the
    server's repeated writes invisible.

    Three fields are left out of it on purpose:

      note      only ever reaches the status line, and a refusal must not
                tear the cards down.
      progress  its counters tick every time somebody picks a flower, and a
                panel that rebuilt its head, its nav and its body on each
                one would be rebuilding itself under a person who is reading
                it. What is in the key instead is progressShape(), the lines
                and their order and none of their numbers; the numbers are
                written in place by drawProgress, the way the foot is
                written in place by drawFoot.
      work      the same counters said the other way round, and this page
                draws nothing at all from it. Leaving it in would undo all
                of the above the first time a caught-up count arrived.
  */
  var NOT_DRAWN = { note: true, progress: true, work: true };
  function viewKey() {
    var v = null;
    if (mine) { v = {}; for (var k in mine) if (!NOT_DRAWN[k]) v[k] = mine[k]; }
    return JSON.stringify([tableGen, sections, section, rowAt, picked, later, marked, markedStaff, v, progressShape(),
                           candidate, endArmed, dyeTarget, guideAt]);
  }

  function draw() {
    // A mage gets the spell book, between Profession and Class, the moment
    // Mage is the profession: confirmed by the server, or still lit on the
    // Profession card while creating. Home and Review are creation's own.
    sections = creating() ? ['profession', 'class', 'tree', 'home', 'review'] : ['profession', 'class', 'tree'];
    if (isMage()) sections.splice(1, 0, 'spells');
    /*
      The recipe book sits where the spell book sits, right after Profession,
      and after the spell book when there is one. A mage gets the spell book;
      everybody else gets this; and a mage a Master taught a craft half gets
      both, because the server sends the book to them as well and the section
      is drawn from whether the book arrived rather than from the profession.
      The server sends nothing while creating, so the section is the world's.
    */
    if (recipeBook()) sections.splice(isMage() ? 2 : 1, 0, 'recipes');
    // An Enchanter's staff spells (#1128), right after the recipe book: the
    // server sends the page to an Enchanter and nobody else.
    if (staffBook()) sections.splice(sections.indexOf('recipes') + 1 || 1, 0, 'staff');
    // The College (#1387), right after the spell book, or after Profession
    // for somebody a Master mage taught: the server sends it to anybody
    // magic is open to, and never while creating.
    if (!creating() && collegeView()) sections.splice(sections.indexOf('spells') + 1 || 1, 0, 'college');
    // The offices (#1638), for a character that holds one or may take one:
    // the server sends the page to them and nobody else, never while creating.
    // The Body page (#1631), after the tree: the server sends it to anybody
    // in the world, and never while creating.
    /*
      The profession guides (#3165), for everybody, the world and creation
      alike: a page per profession is most use to somebody still choosing
      one. In the world it comes after the tree; while creating, before Home,
      so Review stays last and its Confirm is still the one that sends.
    */
    if (creating()) sections.splice(sections.indexOf('home') < 0 ? sections.length : sections.indexOf('home'), 0, 'guides');
    else sections.push('guides');
    if (!creating() && bodyView()) sections.push('body');
    // The Alchemy journal (#3142), after Body: only once something was eaten or brewed.
    if (!creating() && alchemyView()) sections.push('alchemy');
    if (!creating() && officePage()) sections.push('office');
    /*
      Property, last, and only once there is something on it. Patrick,
      21 September: "once they claim a house or have a key to a house a property
      button should appear in the K menu that lists the Properties and wether
      they own them or not". The server leaves the page off entirely when
      somebody holds nothing and carries no key, so the button appearing IS the
      server having something to say. Nothing here decides it.
    */
    // Masters and apprentices (#1634), before Property: the server sends it to
    // anybody with a profession, and the look prompt's K opens it on a person.
    if (!creating() && (apprView() || candidate)) sections.push('apprentice');
    // Hair dye (#2675): only while you carry one or one is steeping.
    if (!creating() && dyeView()) sections.push('hairdye');
    if (propertyRows().length) sections.push('property');
    // First steps (#3166), first in the list while a new character has them.
    if (!creating() && startView()) {
      sections.unshift('start');
      if (!startOpened) { startOpened = true; goTo('start'); }
    }
    if (sections.indexOf(section) < 0) section = sections[0];
    var n = countRows();
    if (rowAt >= n) rowAt = n ? n - 1 : 0;
    if (rowAt < 0) rowAt = 0;
    var key = viewKey();
    if (key !== drawnKey) {
      drawnKey = key;
      drawHead();
      drawNav();
      drawBody();
    }
    drawProgress();
    drawFoot();
  }

  /*
    The counters, written into the lines that are already on the page. The
    shape is viewKey's and a change to it has already rebuilt the body by the
    time this runs; this is the numbers and nothing else, so a tick of work
    changes one string and leaves every card, every section name and the
    place the reader had got to exactly where they were.
  */
  function drawProgress() {
    if (!progRows.length) return;
    var prog = progressLines();
    if (prog.length !== progRows.length) return;   // the shape moved; the rebuild has it
    var key = JSON.stringify(prog.map(function (p) { return p.t; }));
    if (key === progKey) return;
    progKey = key;
    for (var i = 0; i < prog.length; i++) progRows[i].textContent = prog[i].t;
  }

  function drawHead() {
    if (creating()) {
      elTitle.textContent = 'Begin your life in Thornswood';
      elWho.textContent = '';
      elWho.appendChild(el('div', '', 'Choose a home. Your class and profession can be chosen here too, or later in the world. Nothing is sent until you press Confirm in Review.'));
      return;
    }
    elTitle.textContent = DATA[section] ? DATA[section].title : '';
    elWho.textContent = '';
    var s = summary();
    elWho.appendChild(el('div', s ? '' : 'dim', s || 'Nothing chosen yet. Class and profession are picked once, here, and never changed.'));
    var rk = topRank();
    var pts = mine ? Number(mine.points) || 0 : 0;
    var line2 = el('div', 'dim');
    if (rk) line2.appendChild(document.createTextNode(RANK_NAMES[rk] || cap(rk)));
    if (rk && pts) line2.appendChild(document.createTextNode(' · '));
    if (pts) { var p = el('span', 'pts', pts + (pts === 1 ? ' point to spend' : ' points to spend')); line2.appendChild(p); }
    if (rk || pts) elWho.appendChild(line2);
  }

  /*
    The line under each section's name: what the server says you are (green),
    or while creating the soft choice (gold), or later, or choose one.
  */
  function navValue(sec) {
    var soft = null;
    if (sec === 'class') {
      if (haveClass()) return { t: nameOf('class', mine['class']), c: 'set' };
      soft = creating() ? softClass() : null;
      if (soft) return soft;
      return later[sec] ? { t: 'later', c: '' } : { t: 'choose one', c: 'need' };
    }
    if (sec === 'profession') {
      if (!haveProf()) {
        soft = creating() ? softProf() : null;
        if (soft) return { t: soft.t, c: soft.c };
        return later[sec] ? { t: 'later', c: '' } : { t: 'choose one', c: 'need' };
      }
      var halves = ownHalves().map(function (h) { return nameOf('profession', h); });
      return { t: nameOf('profession', mine.profession) + (halves.length ? ', ' + halves.join(' and ') : ''), c: 'set' };
    }
    if (sec === 'home') {
      if (haveHome()) return { t: cap(mine.home), c: 'set' };
      soft = softHome();
      return soft ? { t: soft.t, c: 'chosen' } : { t: 'choose one', c: 'need' };
    }
    if (sec === 'review') return (haveHome() || softHome()) ? { t: 'ready to begin', c: 'chosen' } : { t: 'needs a home', c: 'need' };
    if (sec === 'spells') {
      var sp = pointsLeft();
      var m = markedCount();
      return { t: sp ? sp + ' to spend' : (m ? m + ' marked' : 'nothing yet'), c: sp ? 'need' : '' };
    }
    if (sec === 'college') {
      var cv = collegeView();
      var opens = cv ? Number(cv.opens) || 0 : 0;
      return opens > Date.now() ? { t: 'next ' + whenOpens(opens), c: '' } : { t: 'a semester is open', c: 'need' };
    }
    if (sec === 'apprentice') {
      if (candidate) return { t: 'take on ' + candidate.name, c: 'need' };
      var apT = apprList('took'), apB = apprList('by'), apV = apprView();
      if (apT.length) return { t: apT.length + (apT.length === 1 ? ' apprentice' : ' apprentices'), c: 'set' };
      if (apB.length) return { t: apB.length === 1 ? 'taken on by ' + apB[0].name : apB.length + ' Masters', c: 'set' };
      return { t: apV ? (Number(apV.used) || 0) + ' of ' + (Number(apV.of) || 0) + ' trades used' : 'nobody yet', c: '' };
    }
    if (sec === 'start') {
      var stS = startView() ? startView().steps : [];
      var stD = 0;
      for (var si = 0; si < stS.length; si++) if (stS[si] && stS[si].done) stD++;
      return { t: stD + ' of ' + stS.length + ' done', c: stD < stS.length ? 'need' : 'set' };
    }
    if (sec === 'hairdye') {
      var hdN = dyeList().length, hdV = dyeView();
      if (dyeTarget && hdN) return { t: 'dye ' + dyeTarget.name, c: 'need' };
      if (hdV && hdV.steeping && !hdN) return { t: 'steeping', c: '' };
      return { t: hdN + (hdN === 1 ? ' dye' : ' dyes'), c: 'set' };
    }
    if (sec === 'alchemy') {
      var alE = alchemyList('eaten').length, alR = alchemyList('recipes').length;
      if (alR) return { t: alR + (alR === 1 ? ' mix' : ' mixes') + ', ' + alE + ' eaten', c: 'set' };
      return { t: alE + ' eaten', c: alE ? 'set' : '' };
    }
    if (sec === 'body') {
      var bv = bodyView();
      var bw = bodyWorries(bv);
      return bw.length ? { t: bw.join(', '), c: 'need' } : { t: 'fine', c: 'set' };
    }
    if (sec === 'office') {
      // The offices are Discord roles (#2551): the first one held names the row.
      var ov = officePage() || {};
      var first = function (list) { return (Array.isArray(list) && list.length) ? String(list[0].where || list[0].hold) : ''; };
      if (first(ov.jarls)) return { t: 'Jarl of ' + first(ov.jarls), c: 'set' };
      if (first(ov.clash)) return { t: 'Jarl of ' + first(ov.clash) + ', held twice', c: 'need' };
      if (first(ov.stewardOf)) return { t: 'Steward of ' + first(ov.stewardOf), c: 'set' };
      if (first(ov.courtOf)) return { t: first(ov.courtOf) + ' Court', c: 'set' };
      if (first(ov.guardOf)) return { t: 'Guard of ' + first(ov.guardOf), c: 'set' };
      if (Array.isArray(ov.toHold) && ov.toHold.length) return { t: String(ov.toHold[0].role) + ', not held here', c: 'need' };
      // Staff hold no office, and settle any building as staff (#2551).
      if (ov.staff) return { t: 'staff, at any door', c: 'set' };
      return { t: 'an office', c: 'set' };
    }
    if (sec === 'staff') {
      var sl = staffLeft();
      var sm = markedStaffDescs().length;
      var su = staffBook() ? staffBook().mine.length : 0;
      return { t: sl ? sl + ' to spend' : (sm ? sm + ' marked' : (su ? su + ' unlocked' : 'nothing yet')), c: sl ? 'need' : (su ? 'set' : '') };
    }
    if (sec === 'property') {
      // Named pRows and pHeld rather than rows and mine on purpose: both of
      // those are the module's own, var is hoisted to the top of the function,
      // and a local of either name blanks out the line above that reads
      // mine['class'] for every other section as well.
      var pRows = propertyRows();
      var pHeld = 0, pKeys = 0, pOwes = 0;
      for (var pi = 0; pi < pRows.length; pi++) {
        if (pRows[pi].mine) pHeld++;
        else if (pRows[pi].keyed) pKeys++;
        else if (pRows[pi].owes) pOwes++;
      }
      if (!pRows.length) return { t: 'nothing yet', c: '' };
      // Rent you still owe on a place you no longer hold (#3893) says so.
      var pOwed = pOwes ? (pHeld || pKeys ? ', rent owed' : 'rent owed') : '';
      return { t: (pHeld ? pHeld + ' held' + (pKeys ? ', ' + pKeys + ' keyed' : '')
                         : (pKeys ? pKeys + (pKeys === 1 ? ' key' : ' keys') : '')) + pOwed,
               c: pHeld ? 'set' : '' };
    }
    if (sec === 'guides') {
      var gp = guideProf();
      return { t: gp ? nameOf('profession', gp) : 'every profession', c: '' };
    }
    if (sec === 'recipes') {
      // How many things you can make, added up over every half you stand in.
      // One number, because the section list is one line per section and the
      // page behind it is where the halves are.
      var halves = recipeHalves();
      var open = 0;
      for (var i = 0; i < halves.length; i++) open += Number(halves[i].open) || 0;
      if (!halves.length) return { t: 'nothing yet', c: '' };
      return { t: open ? open + (open === 1 ? ' thing to make' : ' things to make') : 'nothing open yet', c: open ? 'set' : '' };
    }
    var pts = mine ? Number(mine.points) || 0 : 0;
    var spent = 0;
    if (mine && mine.tree) for (var k in mine.tree) spent += Number(mine.tree[k]) || 0;
    return { t: pts ? pts + ' to spend' : (spent ? spent + ' spent' : 'nothing yet'), c: pts ? 'need' : '' };
  }

  function drawNav() {
    elNav.textContent = '';
    sections.forEach(function (sec) {
      var row = el('div', 'navrow' + (sec === section ? ' on' : ''));
      row.appendChild(el('div', 'k', titleOf(sec)));
      var v = navValue(sec);
      row.appendChild(el('div', 'v ' + v.c, v.t));
      row.onclick = function () { goTo(sec); draw(); };
      elNav.appendChild(row);
    });
  }

  function drawBody() {
    elBody.textContent = '';
    progRows = [];   // whatever was on the page is gone with it
    progKey = '';
    var lead = DATA[section] ? DATA[section].lead : '';
    if (section === 'tree') {
      var pts = mine ? Number(mine.points) || 0 : 0;
      lead += ' ' + (pts ? 'You have ' + pts + (pts === 1 ? ' point' : ' points') + ' to spend.' : 'No points to spend right now.');
      // The one line about the placed points, so the green pips below are
      // not a colour nobody explained.
      var gv = placedTotal();
      if (gv) {
        lead += ' ' + (gv === 1 ? 'One point came' : gv + ' points came') + ' with what you chose, ' +
                'in green, and ' + (gv === 1 ? 'it does' : 'they do') + ' not move.';
      }
    }
    if (lead) elBody.appendChild(el('p', 'lead', lead));
    if (section === 'class') drawClass();
    else if (section === 'profession') drawProfession();
    else if (section === 'home') drawHome();
    else if (section === 'spells') drawSpells();
    else if (section === 'staff') drawStaff();
    else if (section === 'college') drawCollege();
    else if (section === 'apprentice') drawApprentice();
    else if (section === 'hairdye') drawHairDye();
    else if (section === 'start') drawStart();
    else if (section === 'recipes') drawRecipes();
    else if (section === 'guides') drawGuides();
    else if (section === 'property') drawProperty();
    else if (section === 'office') drawOffice();
    else if (section === 'body') drawNeeds();
    else if (section === 'alchemy') drawAlchemy();
    else if (section === 'review') drawReview();
    else drawTree();
  }

  /* Every spell the book shows, flat, for the keyboard: [{school, rank, name}]. */
  function bookRows() {
    var out = [];
    var schools = bookSchools();
    var book = DATA.spells;
    if (!book) return out;
    schools.forEach(function (sc) {
      var byRank = book.schools[sc];
      if (!byRank) return;
      book.ranks.forEach(function (r) {
        (byRank[r.key] || []).forEach(function (name) { out.push({ school: sc, rank: r.key, name: name }); });
      });
    });
    return out;
  }

  /*
    The spell book: one column per school, the spells under their rank, each
    with a mark that says yours, marked, or could take. Yours comes from the
    server (mine.spells) and cannot be unmarked; the rank over each column is
    the server's too (mine.ranks), and no rank at all is drawn rather than a
    guessed Novice. A click marks; Learn, or Confirm in Review while
    creating, is what sends.
  */
  function drawSpells() {
    var schools = bookSchools();
    var book = DATA.spells;
    if (!schools.length) {
      elBody.appendChild(el('p', 'lead', 'Pick your two schools on the Profession card first. The book fills with their spells.'));
      return;
    }
    var pts = spellPoints();
    var have = knownSpells();
    var n = markedCount();
    var leftPts = pointsLeft();
    var top = el('div', 'spellbar');
    // The count, when the server has sent one. When it has not, the marks
    // alone, and no number at all rather than one this page made up.
    var bar = '';
    if (leftPts !== null) {
      bar = leftPts + ' of ' + pts + (pts === 1 ? ' spell point' : ' spell points') + ' left' + (n ? ', ' + n + ' marked' : '');
    } else if (n) {
      bar = n + ' marked';
    }
    top.appendChild(el('div', 'spellpts', bar));
    top.appendChild(el('div', 'spellnote', creating()
      ? 'Not sent to the server yet. Confirm in Review sends what you marked.'
      : 'Marked spells go to the server when you press Learn.'));
    elBody.appendChild(top);
    var cols = el('div', 'cols spellcols');
    var idx = 0;
    schools.forEach(function (sc) {
      var col = el('div', 'col');
      var head = el('div', 'colhead', cap(sc));
      // The rank the server holds you at in this school, beside its name.
      // Nothing when the server has not said, which is the whole of creation.
      var schRank = rankOf(sc);
      if (schRank) head.appendChild(el('span', 'tag dim', RANK_NAMES[schRank] || cap(schRank)));
      col.appendChild(head);
      var byRank = book.schools[sc] || {};
      book.ranks.forEach(function (r) {
        var names = byRank[r.key] || [];
        if (!names.length) return;
        col.appendChild(el('div', 'rankhead', r.name));
        var why = lockedBecause(sc, r.key);
        names.forEach(function (name) {
          var i = idx++;
          var got = !!have[name];
          var shut = !got && !marked[name] && !!why;
          var row = el('div', 'spell' + (i === rowAt ? ' at' : '') + (got ? ' mine' : '') +
                       (marked[name] ? ' on' : '') + (shut ? ' shut' : ''));
          row.appendChild(el('span', 'spellname', name));
          row.appendChild(el('span', 'tag' + (got ? '' : (marked[name] ? ' gold' : ' dim')),
                             got ? 'yours' : (marked[name] ? 'marked' : (shut ? why : 'could take'))));
          // One handler, one rule: toggleMark says no to a spell that is
          // already yours, so the row does not have to know.
          row.onclick = function () {
            rowAt = i;
            toggleMark(sc, r.key, name);
            draw();
          };
          col.appendChild(row);
        });
      });
      cols.appendChild(col);
    });
    elBody.appendChild(cols);
  }

  /*
    The staff spell page (#1128): one column per rank, the spells under it,
    each with a mark that says unlocked, marked, or could take, the way the
    spell book draws a school. Your Bladebinder rank, the server's, sits over
    the page. A click marks; Unlock sends.
  */
  function drawStaff() {
    var book = staffBook();
    var list = staffRows();
    if (!book || !list.length) {
      elBody.appendChild(el('p', 'lead', 'The server has not sent the staff spells yet. Give it a moment.'));
      return;
    }
    var pts = staffPoints();
    var left = staffLeft();
    var n = markedStaffDescs().length;
    var have = staffMine();
    var top = el('div', 'spellbar');
    var bar = '';
    if (left !== null) {
      bar = left + ' of ' + pts + (pts === 1 ? ' staff spell point' : ' staff spell points') + ' left' + (n ? ', ' + n + ' marked' : '');
    } else if (n) {
      bar = n + ' marked';
    }
    top.appendChild(el('div', 'spellpts', bar));
    top.appendChild(el('div', 'spellnote', 'You are ' + (RANK_NAMES[book.rank] || 'Novice') +
      ' as a Bladebinder. Marked spells are unlocked when you press Unlock; then a staff enchanter can bind them.'));
    elBody.appendChild(top);
    var cols = el('div', 'cols spellcols');
    var idx = 0;
    RANK_ORDER.forEach(function (rk) {
      var here = list.filter(function (r) { return r.rank === rk; });
      if (!here.length) return;
      var col = el('div', 'col');
      col.appendChild(el('div', 'colhead', RANK_NAMES[rk]));
      var why = staffLocked(rk);
      here.forEach(function (r) {
        var i = idx++;
        var got = !!have[r.desc];
        var shut = !got && !markedStaff[r.desc] && !!why;
        var row = el('div', 'spell' + (i === rowAt ? ' at' : '') + (got ? ' mine' : '') +
                     (markedStaff[r.desc] ? ' on' : '') + (shut ? ' shut' : ''));
        row.appendChild(el('span', 'spellname', r.name));
        row.appendChild(el('span', 'tag' + (got ? '' : (markedStaff[r.desc] ? ' gold' : ' dim')),
                           got ? 'unlocked' : (markedStaff[r.desc] ? 'marked' : (shut ? why : 'could take'))));
        row.onclick = function () { rowAt = i; toggleStaff(r.desc, r.rank, r.name); draw(); };
        col.appendChild(row);
      });
      cols.appendChild(col);
    });
    elBody.appendChild(cols);
  }

  /*
    The recipe book: one column per half you stand in, the families under it,
    and beside each family how many of it are open to you out of how many the
    half holds. Drawn the way the spell book beside it is drawn, two columns
    with the server's rank on the right of each column head.

    NOTHING HERE IS A MARK AND NOTHING IS SENT. The spell book has a Learn
    because a spell is a pick; a recipe is not picked, it is made, at the
    bench, and the server's craft gate is what answers for it. So this page
    reads and draws and that is the whole of it, and the foot carries no
    button while it is open.

    A HALF WITH NOTHING OPEN GETS A SENTENCE, NOT AN EMPTY BOX. Five of the
    fourteen halves own no recipe in the whole load order and a new
    Confectioner can bake nothing at all yet, so the server sends why and
    this draws it. Every one of those sentences is the server's.
  */
  /*
    THE BODY PAGE (#1631).

    What /needs used to say in the chat, which nobody types any more: the four
    meters and their bands, where you are resting, the warmth with what sets
    it, and what the server counts as worn. It was written for finding out
    whether the warmth is broken (23 September), and that question needs the
    target, the place the server believes you are in, whether it sees a
    fire, and what it thinks you are wearing, so all of it is here.

    Everything on it is the server's, under mine.body, as of the last time
    the panel arrived: K asks for it outright as it opens. Read again asks
    once more, through 'skills:refresh', the same line the panel sends as it
    opens. Nothing is picked or sent.
  */
  var BAND_WORDS = { fine: 'fine', weary: 'weary', bad: 'bad', spent: 'spent' };
  var REST_WORDS = {
    sit: 'sitting', campfire: 'sitting by a fire', rough: 'in a bed nobody can lend you',
    camp: 'in a bed by a fire', inn: 'in a bed you may use', bed: 'in your own bed', bedroll: 'in a bedroll',
    // An inn or a temple nobody holds (#2246).
    common: 'in an inn or temple bed nobody holds', commonfire: 'in an inn or temple bed by a fire'
  };
  var PLACE_WORDS = {
    indoors: 'indoors', outdoors: 'out of doors', rain: 'out in the rain', snow: 'out in the snow',
    water: 'in the water', shallow: 'wading', fire: 'in a fire'
  };

  function drawNeeds() {
    var v = bodyView();
    if (!v) return;
    var wrap = el('div', 'cards');
    function meter(name, value, band, extra) {
      var card = el('div', 'card' + (band && band !== 'fine' ? '' : ' mine'));
      var nm = el('div', 'name', name);
      nm.appendChild(el('span', 'tag' + (band && band !== 'fine' ? ' gold' : ''), BAND_WORDS[band] || String(band || '')));
      card.appendChild(nm);
      card.appendChild(el('div', 'desc', (Number(value) || 0) + ' of 100.' + (extra ? ' ' + extra : '')));
      wrap.appendChild(card);
    }
    meter('Hunger', v.food, v.foodBand, 'Eating something from your pack fills it.');
    meter('Thirst', v.drink, v.drinkBand, 'Drinking something from your pack fills it.');
    meter('Rest', v.rest, v.restBand, (v.resting
      ? 'Resting now, ' + (REST_WORDS[v.resting] || v.resting) + '.'
      : 'Not resting. Sit down or lie down and it fills.') +
      // What logging out here would do (#2246), the server's own words.
      (v.away ? ' ' + String(v.away) : ''));

    var t = Number(v.temp) || 0, to = Number(v.tempTarget) || 0;
    var card = el('div', 'card' + (v.tempBand && v.tempBand !== 'fine' ? '' : ' mine'));
    var nm = el('div', 'name', 'Warmth');
    nm.appendChild(el('span', 'tag' + (v.tempBand && v.tempBand !== 'fine' ? ' gold' : ''), tempWord(t) + ' ' + t));
    card.appendChild(nm);
    card.appendChild(el('div', 'desc',
      (to > t ? 'Warming toward ' + to + '.' : (to < t ? 'Cooling toward ' + to + '.' : 'Settled at ' + to + '.')) +
      ' 50 is comfortable.'));
    var fire = (Number(v.fireAway) >= 0)
      ? 'a fire ' + Number(v.fireAway) + ' away, worth ' + (Number(v.fireWorth) || 0)
      : 'no fire in reach';
    card.appendChild(el('div', 'inn',
      'You are ' + (PLACE_WORDS[v.place] || 'somewhere the server does not know yet') +
      (v.roof ? ', under a roof' : ', with no roof') + (v.night ? ', at night' : '') + ', with ' + fire + '. ' +
      'Weather and height are worth ' + (Number(v.exposure) || 0) + '. ' +
      // A blizzard or a heavy storm (#3176), the server's own number.
      (Number(v.storm) > 0 ? 'The storm slows you by ' + Number(v.storm) + ' per cent while you are out in it. ' : '') +
      'What you are wearing covers ' + (Number(v.cover) || 0) + ' per cent of you.'));
    var worn = Array.isArray(v.worn) ? v.worn : [];
    if (!worn.length) {
      card.appendChild(el('div', 'inn',
        'The server has no record of anything on you. Whatever you are wearing was handed to your own ' +
        'game and never reached it, so it cannot count toward warmth. Say so in the dev channel.'));
    }
    worn.forEach(function (w) {
      var row = el('div', 'guest');
      row.appendChild(el('span', 'who', String((w && w.name) || 'something')));
      row.appendChild(el('span', 'dim', (w && w.known) ? (Number(w.worth) || 0) + '%' : 'not in the warmth table'));
      card.appendChild(row);
    });
    wrap.appendChild(card);

    var again = el('div', 'card');
    var line = el('div', 'guest');
    line.appendChild(el('span', 'who', 'These are the server\'s numbers from when K opened.'));
    var go = el('span', 'act', 'Read again');
    go.onclick = function (ev) { ev.stopPropagation(); tell('refresh'); };
    line.appendChild(go);
    again.appendChild(line);
    wrap.appendChild(again);
    elBody.appendChild(wrap);
  }

  /*
    THE ALCHEMY JOURNAL (#3142). Two lists of what is already true, both the
    server's: the mixes brewed, first, because they are what somebody comes
    here to brew again, and every ingredient eaten with what is known of it.
    Nothing on it is picked or sent, so Confirm stays hidden and the keyboard
    has no rows to walk.
  */
  function drawAlchemy() {
    var recipes = alchemyList('recipes');
    var eaten = alchemyList('eaten');
    var bar = el('div', 'spellbar');
    bar.appendChild(el('div', 'spellpts',
      (recipes.length ? recipes.length + (recipes.length === 1 ? ' mix brewed' : ' mixes brewed') : 'No mix brewed yet') +
      ', ' + eaten.length + (eaten.length === 1 ? ' ingredient eaten' : ' ingredients eaten')));
    bar.appendChild(el('div', 'spellnote',
      'Two ingredients that share an effect make it at a lab. The alchemy menu shows the effects you know too.'));
    elBody.appendChild(bar);

    var wrap = el('div', 'cards');
    recipes.forEach(function (r) {
      var card = el('div', 'card mine');
      var makes = Array.isArray(r.makes) ? r.makes.map(String) : [];
      var nm = el('div', 'name', makes.length ? listWords(makes) : 'A mix');
      var times = Number(r.times) || 0;
      nm.appendChild(el('span', 'tag', times === 1 ? 'brewed once' : 'brewed ' + times + ' times'));
      card.appendChild(nm);
      card.appendChild(el('div', 'desc', listWords((Array.isArray(r.with) ? r.with : []).map(String)) + '.'));
      wrap.appendChild(card);
    });
    eaten.forEach(function (r) {
      var card = el('div', 'card');
      var nm = el('div', 'name', String(r.name || 'something'));
      var of = Number(r.of) || 0, known = Number(r.known) || 0;
      if (Array.isArray(r.effects) && of) nm.appendChild(el('span', 'tag', known + ' of ' + of + ' known'));
      card.appendChild(nm);
      if (!Array.isArray(r.effects)) {
        card.appendChild(el('div', 'desc', 'Eaten. The server cannot find this ingredient in the game now, so what it does is not known.'));
      } else {
        var named = r.effects.map(String);
        var other = Number(r.other) || 0;
        var line = named.length ? 'Known: ' + listWords(named) + '.' : 'Eaten.';
        if (other) line += ' ' + (other === 1 ? 'One more known effect is' : other + ' more known effects are') + ' not one a brew here makes.';
        if (of && known < of) line += ' Brewing it with another ingredient that shares an effect teaches that effect.';
        card.appendChild(el('div', 'desc', line));
      }
      wrap.appendChild(card);
    });
    elBody.appendChild(wrap);
  }
  /* Words joined the way a sentence lists them: a, b and c. */
  function listWords(words) {
    if (words.length < 2) return words.join('');
    return words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
  }

  /*
    THE PROPERTY PAGE.

    Patrick, 21 September: it "lists the Properties and wether they own them or
    not". So the row says which of the two it is in words rather than by a
    colour somebody has to learn, and the ones you hold come first because they
    are the ones you came here to look at.

    Nothing on this page is picked and nothing is sent. It is a list of what is
    already true, the same as the recipe book, so Confirm stays hidden and the
    keyboard has no rows to walk.

    THE SERVER DECIDES WHETHER THIS PAGE EXISTS AT ALL. It leaves the list off
    when somebody holds nothing and carries no key, and the button in the nav is
    drawn from whether the list arrived. There is nothing here that can put an
    empty page in front of anybody.

    THE LIST IS mine.property, on the panel view with everything else the
    server says (writeState in the character block puts it there). From the
    first cut until #1717 this read DATA.property, which is this page's own
    section table and never carries it, so the page was never drawn for
    anybody.

    WHAT YOU HOLD IS HERE AND NOT BEHIND A TYPED /deed (#1637): each building
    with what rent is owed on it, and your farm, which is ground with no
    building on it and lapses on the same 14 days. Claiming, locking and
    unlocking are the lock key at the door, so the page says where that is
    rather than naming a word to type.

    ONE THING IS SENT, AND IT IS A STOP (#1603). Under each place you hold are
    the people you let sleep there tonight, and a Stop beside each name ends
    that night: /sleephere stop <profile> <building>, through the same chat
    line every panel uses. The server checks that the place is yours and draws
    the page again. Letting somebody sleep there is the look prompt's key,
    pressed while looking at them inside it.
  */
  function propertyRows() {
    var rows = mine && mine.property;
    return (Array.isArray(rows) && rows.length) ? rows : [];
  }

  function drawProperty() {
    var pRows = propertyRows();
    if (!pRows.length) {
      elBody.appendChild(el('p', 'lead',
        'You hold nothing and carry no keys. Open the door of a building nobody holds and ' +
        'press the key the line under the crosshair names: claiming costs nothing.'));
      return;
    }
    var pHeld = 0, pKeys = 0;
    for (var i = 0; i < pRows.length; i++) {
      if (pRows[i].mine) pHeld++;
      else if (pRows[i].keyed) pKeys++;
    }

    var bar = el('div', 'spellbar');
    bar.appendChild(el('div', 'spellpts',
      (pHeld ? pHeld + (pHeld === 1 ? ' property held' : ' properties held') : 'Nothing held') +
      (pKeys ? ', ' + pKeys + (pKeys === 1 ? ' key carried' : ' keys carried') : '')));
    bar.appendChild(el('div', 'spellnote',
      'A place stays yours while you keep going into it. A key opens a door and ' +
      'nothing more: it is the deed that says a place is yours, and whoever is ' +
      'carrying that holds it.'));
    elBody.appendChild(bar);

    var wrap = el('div', 'cards');
    pRows.forEach(function (r) {
      var card = el('div', 'card' + (r.mine ? ' mine' : ' off'));
      var name = el('div', 'name', String(r.name || 'somewhere'));
      name.appendChild(el('span', 'tag', r.farm ? 'farm' : (r.mine ? 'yours' : (r.master ? 'master key' : (r.keyed ? 'key only' : 'rent owed')))));
      card.appendChild(name);
      // Rent you still owe on a place you no longer hold (#3893): the debt stayed yours.
      if (!r.mine && !r.keyed && r.owes) {
        card.appendChild(el('div', 'desc', (r.by ? 'Held by ' + r.by + ' now. ' : 'Nobody holds it now. ') + owesLine(r.owes)));
        wrap.appendChild(card);
        return;
      }
      if (r.farm) {
        var days = Number(r.days) || 0;
        card.appendChild(el('div', 'desc', 'The ground ' + (Number(r.reach) || 0) +
          ' out from the plot you claimed it at. Sowing or bringing something in keeps it; ' +
          'with nothing done on it, it goes back in ' + days + (days === 1 ? ' day.' : ' days.')));
        wrap.appendChild(card);
        return;
      }
      card.appendChild(el('div', 'desc', r.mine
        ? (r.locked ? 'Locked. Anybody without a key has to pick it. Open its door and the ' +
                      'key the line names unlocks it.'
                    : 'Unlocked. Open its door and the key the line names locks it.') +
          (r.master ? ' You are carrying its master key.' : '') +
          (r.keyed ? ' You are carrying a key to it as well.' : '') + rentLine(r.rent) +
          (r.before ? ' ' + Number(r.before) + ' gold more is owed from when you held it before.' : '')
        : (r.by ? 'Held by ' + r.by + '. ' : 'Nobody holds it. ') +
          // A master key opens the door and turns the lock (#2254).
          (r.master ? 'Your master key opens the door, and at the door the key the line names ' +
                      (r.locked ? 'unlocks it.' : 'locks it.')
                    : (r.locked ? 'Your key opens the door.'
                                : 'It is not locked, so your key is not needed yet.')) +
          (r.owes ? ' ' + owesLine(r.owes) : '')));
      if (r.mine) drawGuests(card, r);
      wrap.appendChild(card);
    });
    elBody.appendChild(wrap);
  }

  /* What you still owe on a place you no longer hold (#3893), and how it is paid. */
  function owesLine(n) {
    return 'You still owe ' + (Number(n) || 0) + ' gold of rent on it from when you held it. Gold you put in ' +
      'a hold\'s drop box pays it, or hand it to the steward of its hold.';
  }

  /* The rent on a place you hold, and what is owed on it now (#1637). */
  function rentLine(rent) {
    if (!rent) return ' No rent on it.';
    var owed = Number(rent.owed) || 0;
    return ' Rent is ' + (Number(rent.amount) || 0) + ' gold every ' + (Number(rent.every) || 7) +
      ' days, ' + (owed ? owed + ' gold owed now.' : 'and nothing is owed now.');
  }

  /* Who may sleep in a place you hold tonight, and a Stop for each. */
  function drawGuests(card, r) {
    var guests = Array.isArray(r.sleep) ? r.sleep : [];
    card.appendChild(el('div', 'inn', guests.length
      ? 'May sleep here tonight, for 8 hours from when you let them:'
      : 'Nobody else may sleep here tonight. Look at somebody inside and press ' +
        'the key the prompt shows to let them, for one night.'));
    guests.forEach(function (gst) {
      var row = el('div', 'guest');
      row.appendChild(el('span', '', String(gst.name || 'somebody')));
      var stop = el('span', 'stop', 'Stop');
      stop.title = 'Stop letting ' + String(gst.name || 'them') + ' sleep at ' + String(r.name || 'this place');
      stop.onclick = function (ev) {
        ev.stopPropagation();
        if (window.thornswoodNet && window.thornswoodNet.say) {
          window.thornswoodNet.say('/sleephere stop ' + Number(gst.pid) + ' ' + String(r.b || ''));
        }
      };
      row.appendChild(stop);
      card.appendChild(row);
    });
  }

  /*
    THE OFFICE PAGE (#1638).

    Patrick, 4 Oct: no commands for things people do, and a Jarl and a
    steward are people. So the offices are buttons here, for anybody who
    holds one: the Jarl names and removes their hold's Court, Steward and
    Guards by picking somebody in the world, and a steward has Evict and the
    rent at the door they just opened, and their hold's board moved to where
    they stand. A steward no longer marks a container as a hold's box: the
    drop box on the board is the only one (#2298, Patrick, 15 Oct).

    THE OFFICES ARE DISCORD ROLES (#2551). Patrick, 15 Oct: a Jarl's hold is
    their "Jarl of <Hold>" role, and the Court, Steward and Guards are roles
    the Jarl gives. Nothing here takes an office or picks a hold. Name and
    Remove send /office <court|steward|guard> <hold> <id> (or -<id>); the
    server asks the site, the bot's account sets the role in Discord, and the
    page is written again once the game has read it back.

    EVERYTHING ON IT IS THE SERVER'S. Who holds what, who is in the world,
    the door are mine.officePage, and each button sends
    the server's own line through the chat line every panel uses, the way
    the property page's Stop does. The server checks it all again and
    answers in the chat, and writes the page again.

    A PERSON IS PICKED, NOT TYPED. Two characters can share a name, so a row
    carries the profile id the server sent with the name, and Name sends that
    id. The id is shown, small, so two of one name can be told apart.

    THE ONES THAT CANNOT BE PUT BACK ASK TWICE. Evict ends somebody's claim
    and moving a board leaves it wherever the steward is standing, so the
    first press says what a second press does, and the second sends it.
  */
  function officeSay(line) {
    if (window.thornswoodNet && window.thornswoodNet.say) window.thornswoodNet.say(line);
    status = 'Sent. The server answers in the chat.'; statusKind = '';
    drawFoot();
  }

  /*
    THE COMPANY'S TERMS, FOR STAFF (#512, #2695, Patrick, 18 Oct): the server
    proposes, staff confirm. The terms in force, the proposal waiting with
    each change, who proposed it and when, and every term to set and
    propose. Confirm asks twice. Everything here is the server's, under
    officePage.company, and the server checks staff again on every line.
  */
  function officeCompany(c) {
    var card = el('div', 'card');
    card.appendChild(el('div', 'name', 'The company\'s terms'));
    var fields = Array.isArray(c && c.fields) ? c.fields : [];
    card.appendChild(el('div', 'desc', (c && c.changed)
      ? 'Last changed ' + whenOpens(Number(c.changed.at) || 0) + '. Who changed it is in the staff log.'
      : 'These are the terms the company shipped with.'));
    var p = c && c.pending;
    if (p) {
      var list = (Array.isArray(p.changes) ? p.changes : []).map(function (ch) {
        return String(ch.label || ch.term) + ' from ' + String(ch.from) + ' to ' + String(ch.to);
      }).join('; ');
      officeRow(card, 'Proposed: ' + list, (p.by ? 'by ' + String(p.by) + ', ' : '') + whenOpens(Number(p.at) || 0), [
        officeButton('Confirm', '/companyterms confirm ' + String(Number(p.at) || 0), 'Press again to change the company\'s terms'),
        officeButton('Drop', '/companyterms drop ' + String(Number(p.at) || 0))
      ]);
      var keep = Number(p.openHaulsKeepTerms) || 0;
      card.appendChild(el('div', 'desc', keep + (keep === 1 ? ' open haul keeps' : ' open hauls keep') +
        ' the terms it was posted under.'));
    } else {
      card.appendChild(el('div', 'desc', 'Nothing is proposed.'));
    }
    var inputs = [];
    fields.forEach(function (f) {
      if (!f || typeof f.key !== 'string') return;
      var box;
      if (f.kind === 'choice') {
        box = document.createElement('select');
        (Array.isArray(f.choices) ? f.choices : []).forEach(function (ch) {
          var opt = document.createElement('option');
          opt.value = String(ch);
          opt.textContent = String(ch);
          if (String(ch) === String(f.value)) opt.selected = true;
          box.appendChild(opt);
        });
      } else {
        box = document.createElement('input');
        box.value = String(f.value);
        box.placeholder = f.kind === 'percent' ? 'percent' : 'gold';
      }
      inputs.push({ f: f, box: box });
      officeRow(card, String(f.label || f.key), f.kind === 'percent' ? String(f.value) + '%' : String(f.value), [box]);
    });
    var send = officeButton('Propose', function () {
      var pairs = [];
      for (var i = 0; i < inputs.length; i++) {
        var f = inputs[i].f;
        var v = String(inputs[i].box.value || '').trim();
        if (f.kind !== 'choice' && !/^\d+$/.test(v)) {
          status = String(f.label || f.key) + ' is a whole number.'; statusKind = 'no';
          drawFoot();
          return '';
        }
        if (v !== String(f.value)) pairs.push(f.key + '=' + v);
      }
      if (!pairs.length) {
        status = 'Change a term first. Those are the terms in force.'; statusKind = 'no';
        drawFoot();
        return '';
      }
      return '/companyterms propose ' + pairs.join(' ');
    });
    officeRow(card, '', '', [send]);
    card.appendChild(el('div', 'desc', 'The terms change only when staff confirm a proposal here, and every press ' +
      'goes in the staff log with your name. Hauls already posted keep the terms they were posted under.'));
    return card;
  }

  /* A button on the Office page. With twice, the first press only says what the second does. */
  function officeButton(text, line, twice) {
    var b = el('span', 'stop', text);
    var armed = false;
    b.onclick = function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (twice && !armed) { armed = true; b.textContent = twice; return; }
      var said = typeof line === 'function' ? line() : line;
      if (said) officeSay(said);
    };
    return b;
  }

  function officeRow(card, who, extra, buttons) {
    var row = el('div', 'guest wrap');
    var name = el('span', 'who', who);
    if (extra) name.appendChild(el('span', 'dim', ' ' + extra));
    row.appendChild(name);
    (buttons || []).forEach(function (b) { row.appendChild(b); });
    card.appendChild(row);
    return row;
  }

  /* A card saying an office this person holds, and what it lets them do. */
  function officeHeld(wrap, title, desc) {
    var card = el('div', 'card mine');
    var head = el('div', 'name', title);
    head.appendChild(el('span', 'tag', 'held'));
    card.appendChild(head);
    card.appendChild(el('div', 'desc', desc));
    wrap.appendChild(card);
    return card;
  }

  /*
    One office of the Jarl's hold: who holds it, with Remove, and the people
    in the world who do not, with Name. Remove takes the role in Discord, so
    it asks twice.
  */
  function officeGiven(wrap, hold, office, o) {
    var card = el('div', 'card');
    var role = String(o.role || office);
    card.appendChild(el('div', 'name', role));
    var holders = Array.isArray(o.holders) ? o.holders : [];
    if (!holders.length) card.appendChild(el('div', 'inn', 'Nobody holds it.'));
    holders.forEach(function (w) {
      var pid = Number(w.pid) || 0;
      // The character that holds it (#2551), or an account whose role gives it and none of whose characters holds it yet.
      var who = w.name ? String(w.name) : (w.was ? String(w.was) : 'Profile ' + pid);
      var extra = w.chosen === false ? 'no character holds it yet' : (w.name ? 'profile ' + pid : 'not in the world now');
      officeRow(card, who, extra,
        [officeButton('Remove', '/office ' + office + ' ' + hold + ' -' + pid, 'Press again to take ' + role + ' back')]);
    });
    var people = Array.isArray(o.people) ? o.people : [];
    card.appendChild(el('div', 'inn', people.length
      ? 'Name somebody from the people in the world now:'
      : 'Everybody in the world now holds it already, or nobody is in the world to name.'));
    people.forEach(function (p) {
      var pid = Number(p.pid) || 0;
      officeRow(card, String(p.name || 'somebody'), 'profile ' + pid,
        [officeButton('Name', '/office ' + office + ' ' + hold + ' ' + pid)]);
    });
    wrap.appendChild(card);
  }

  function drawOffice() {
    var o = officePage();
    if (!o) return;
    var wrap = el('div', 'cards');
    var list = function (x) { return Array.isArray(x) ? x : []; };
    var town = function (h) { return String((h && (h.where || h.hold)) || ''); };

    // The Jarl of a hold (#2551): from their Jarl role, with its three offices.
    list(o.jarls).forEach(function (j) {
      var where = town(j);
      officeHeld(wrap, 'Jarl of ' + where, 'This character is Jarl of ' + where + ', by your Discord role. You name and ' +
        'remove its Court, its Steward and its Guards here, and the same roles change in Discord. The office is ' +
        'this character\'s; your other characters are ordinary.');
      var offices = (j && j.offices) || {};
      ['court', 'steward', 'guard'].forEach(function (k) {
        if (offices[k]) officeGiven(wrap, String(j.hold), k, offices[k]);
      });
    });

    // An office this account's role gives that this character does not hold
    // (#2551, Patrick, 16 Oct: an office is one character's). Hold it here.
    list(o.toHold).forEach(function (t) {
      var card = el('div', 'card');
      card.appendChild(el('div', 'name', String(t.role || t.office)));
      card.appendChild(el('div', 'desc', (t.by
        ? 'Your account holds the ' + String(t.role) + ' role, and ' + String(t.by) + ', another of your characters, holds the office.'
        : 'Your account holds the ' + String(t.role) + ' role, and none of your characters holds the office yet.') +
        ' One character holds it. Press Hold it here to make it this one.'));
      officeRow(card, '', '', [officeButton('Hold it here', '/office hold ' + String(t.office) + ' ' + String(t.hold),
        'Press again to hold ' + String(t.role) + ' with this character')]);
      wrap.appendChild(card);
    });

    // A Jarl role another account holds too: neither acts (Patrick, 15 Oct).
    list(o.clash).forEach(function (c) {
      var card = el('div', 'card');
      card.appendChild(el('div', 'name', 'Jarl of ' + town(c) + ', held twice'));
      card.appendChild(el('div', 'desc', 'Another Discord account holds the Jarl of ' + town(c) + ' role too, so neither ' +
        'of you acts as Jarl until staff take it from all but one. Staff have been told.'));
      wrap.appendChild(card);
    });

    list(o.stewardOf).forEach(function (h) {
      officeHeld(wrap, 'Steward of ' + town(h), 'The Jarl of ' + town(h) + ' made you its Steward. You end claims and ' +
        'set rent at a door, move ' + town(h) + '\'s notice board, and take anything out of its drop box.');
    });
    list(o.courtOf).forEach(function (h) {
      officeHeld(wrap, town(h) + ' Court', 'The Jarl of ' + town(h) + ' named you to its Court. You take anything ' +
        'out of ' + town(h) + '\'s drop box and read its records.');
    });
    list(o.guardOf).forEach(function (h) {
      officeHeld(wrap, 'Guard of ' + town(h), 'The Jarl of ' + town(h) + ' named you a guard. Every cell of ' +
        String(h.jail || 'the jail') + ' opens for you, and the lock key at a cell door locks or unlocks it for ' +
        'everybody else. At ' + town(h) + '\'s notice board you can take down any post, and you take anything out ' +
        'of its drop box.');
    });

    // Staff (#2551, Patrick, 17 Oct): no office, and the door card at any building.
    if (o.staff) {
      officeHeld(wrap, 'Staff', 'Staff hold no office, but you end claims and set rent at any building, in any ' +
        'hold or none. At a building whose hold you do not keep you act as staff, and every press goes in the ' +
        'staff log with your name.');
    }
    // Where the world is, for staff (#513): propose, confirm and drop a move.
    if (o.world) wrap.appendChild(officeWorld(o.world));
    if (o.steward || o.staff) wrap.appendChild(officeDoor(o.door));
    // The trade ships' ports and routes (#2700), staff only, while the ships are on.
    if (o.ships) wrap.appendChild(officeShips());
    // The trade carts' stops and roads (#3158), staff only, while the carts are on.
    if (o.carts) wrap.appendChild(officeCarts());
    if (o.steward) wrap.appendChild(officeBoards(o.boards));
    // The company's terms, for staff (#512, #2695): propose, confirm and drop.
    if (o.company) wrap.appendChild(officeCompany(o.company));
    // The crafting tools, for staff (#3167): ranks, a stuck recipe, and giving back what was lost.
    if (o.craft) officeCraft(wrap, o.craft);
    elBody.appendChild(wrap);
  }

  /*
    THE CRAFTING TOOLS, FOR STAFF (#3167, Patrick, 22 Oct: on the Office
    page, not commands). Pick somebody in the world, then their ranks with
    Raise, a recipe check that says why a recipe is stuck, and Give back.
    Everything here is the server's, under officePage.craft, and the server
    checks staff again on every line. Raise and Give back ask twice, and
    neither is offered on yourself: another staff member does it.
  */
  function officeCraft(wrap, c) {
    var them = c && c.them;
    var people = Array.isArray(c && c.people) ? c.people : [];
    var card = el('div', 'card');
    card.appendChild(el('div', 'name', them ? 'Crafting: ' + String(them.name) : 'Crafting'));
    if (!them) {
      card.appendChild(el('div', 'desc', 'Pick somebody in the world to see their ranks, check a recipe they cannot ' +
        'make, or give back something they lost. Every change goes in the staff log with your name.'));
      if (!people.length) card.appendChild(el('div', 'inn', 'Nobody is in the world to pick.'));
      people.forEach(function (p) {
        officeRow(card, String(p.name || 'somebody'), 'profile ' + (Number(p.pid) || 0),
          [officeButton('Pick', '/craftstaff pick ' + (Number(p.pid) || 0))]);
      });
      wrap.appendChild(card);
      return;
    }
    var pid = Number(them.pid) || 0;
    var who = String(them.name || 'them');
    officeRow(card, 'Profile ' + pid, them.self ? 'you: check only, another staff member changes you' : '',
      [officeButton('Pick somebody else', '/craftstaff pick -')]);
    wrap.appendChild(card);

    // Ranks: one step up through the rulebook, or the rulebook's reason it will not.
    var ranks = el('div', 'card');
    ranks.appendChild(el('div', 'name', 'Ranks'));
    var list = Array.isArray(them.ranks) ? them.ranks : [];
    ranks.appendChild(el('div', 'desc', list.length
      ? 'A raise is one rank, and gives what a rank always gives: a skill point, and a spell point for a mage\'s ' +
        'school or an Enchanter\'s staff spells. Their count toward the next rank starts again at 0.'
      : who + ' has no class, profession or school yet.'));
    list.forEach(function (k) {
      var name = String(k.name || k.key);
      var rank = cap(k.rank);
      var at = Number(k.need) > 0 ? rank + ', ' + (Number(k.work) || 0) + ' of ' + Number(k.need) + ' toward ' + cap(k.next || '') : rank;
      var buttons = [];
      if (k.next && !them.self) {
        buttons.push(officeButton('Raise to ' + cap(k.next), '/craftstaff raise ' + pid + ' ' + String(k.key),
          'Press again to make ' + who + ' ' + cap(k.next) + ' in ' + name));
      }
      var row = officeRow(ranks, name, at, buttons);
      if (!k.next && k.why) row.appendChild(el('span', 'dim', ' ' + String(k.why) + '.'));
    });
    wrap.appendChild(ranks);

    // A recipe: what the craft gate says, and what their game was handed.
    var rc = el('div', 'card');
    rc.appendChild(el('div', 'name', 'A recipe they cannot make'));
    rc.appendChild(el('div', 'desc', 'Type part of the name of what it makes. The server says whether ' + who +
      ' may make it, and why not, and whether their game lists it.'));
    var ask = document.createElement('input');
    ask.placeholder = 'what it makes';
    var check = officeButton('Check', function () {
      var w = String(ask.value || '').trim();
      if (!w) { status = 'Type part of the name of what the recipe makes.'; statusKind = 'no'; drawFoot(); return ''; }
      return '/craftstaff recipe ' + pid + ' ' + w;
    });
    ask.onkeydown = function (ev) { if (ev && ev.key === 'Enter') check.onclick(ev); };
    officeRow(rc, '', '', [ask, check]);
    var ch = them.check;
    if (ch) {
      var rows = Array.isArray(ch.rows) ? ch.rows : [];
      if (!rows.length) rc.appendChild(el('div', 'inn', 'No recipe anybody owns makes anything called ' + String(ch.want) + '.'));
      var stale = false;
      rows.forEach(function (x) {
        var what = x.half ? String(x.half) + (x.rank ? ', ' + cap(x.rank) : '') : '';
        var said;
        if (!x.may) said = String(x.why);
        else if (x.stale) said = 'They may make it, but their game was handed it as one to leave off the benches.';
        else if (x.asks) said = 'They may make it, and the server lists it. The game\'s own recipe asks for something first ' +
          '(a perk, an item or a spell), so the bench leaves it out until they have that.';
        else said = 'They may make it, and the server lists it for them.';
        if (!x.may && x.stale) said += ' Their game still lists it, from an older answer.';
        if (x.stale) stale = true;
        var row = officeRow(rc, String(x.name), what, []);
        row.appendChild(el('span', 'dim', ' ' + said));
      });
      if (ch.more) rc.appendChild(el('div', 'inn', 'More recipes than these match. Type more of the name.'));
      if (stale) {
        rc.appendChild(el('div', 'desc', 'Their game has an older answer than the craft gate gives now. Hand it the list, ' +
          'and say in the dev channel what changed for them just before: nothing should leave it old.'));
        officeRow(rc, '', '', [officeButton('Hand their game the list', '/craftstaff recipes ' + pid)]);
      }
    }
    wrap.appendChild(rc);

    // Give back: nothing records what somebody lost, so the reason is the record.
    if (them.self) return;
    var gb = el('div', 'card');
    gb.appendChild(el('div', 'name', 'Give back'));
    gb.appendChild(el('div', 'desc', 'Nothing records what somebody lost, so you go on what they and the logs say. Name ' +
      'the item, how many, and why: the reason goes in the staff log with your name, and ' + who + ' is told.'));
    var item = document.createElement('input');
    item.placeholder = 'item';
    var count = document.createElement('input');
    count.placeholder = 'how many';
    var why = document.createElement('input');
    why.placeholder = 'why: what they lost, and how';
    var give = officeButton('Give back', function () {
      var n = Number(String(count.value || '').trim());
      var thing = String(item.value || '').trim();
      var because = String(why.value || '').replace(/\|/g, ' ').trim();
      var no = !thing ? 'Name the item to give back.'
        : (!(n > 0) || Math.floor(n) !== n || n > 1000) ? 'How many is a whole number from 1 to 1000.'
        : !because ? 'Say why: what they lost, and how.' : '';
      if (no) { status = no; statusKind = 'no'; drawFoot(); return ''; }
      return '/craftstaff give ' + pid + ' ' + n + ' ' + thing.replace(/\|/g, ' ') + ' | ' + because;
    }, 'Press again to give it back to ' + who);
    officeRow(gb, '', '', [item, count]);
    officeRow(gb, '', '', [why, give]);
    wrap.appendChild(gb);
  }

  /* The trade ships' staff panel (#2700): ports, routes and ships, a draft staff confirm. */
  function officeShips() {
    var card = el('div', 'card');
    card.appendChild(el('div', 'name', 'Trade ships'));
    card.appendChild(el('div', 'desc', 'The ports, routes and ships. Open a crate at a dock within a minute before, to make it a port. ' +
      'Every edit is a draft, and nothing changes until you confirm what the server proposes.'));
    officeRow(card, '', '', [officeButton('Ports and routes', '/ship staff')]);
    return card;
  }

  /* The trade carts' staff panel (#3158): cart stops, roads and carts, a draft staff confirm. */
  function officeCarts() {
    var card = el('div', 'card');
    card.appendChild(el('div', 'name', 'Trade carts'));
    card.appendChild(el('div', 'desc', 'The cart stops, the roads between them, and the carts. Open a crate at a stop within a minute ' +
      'before, to make it a cart stop. A road\'s minutes are the least a loaded cart takes on it. Every edit is a draft, and ' +
      'nothing changes until you confirm what the server proposes.'));
    officeRow(card, '', '', [officeButton('Cart stops and roads', '/cart staff')]);
    return card;
  }

  /* The door the steward opened in the last minute: evict, and the rent. */
  function officeDoor(d) {
    var card = el('div', 'card');
    card.appendChild(el('div', 'name', d ? String(d.name || 'This building') : 'At a door'));
    if (!d) {
      card.appendChild(el('div', 'desc', 'Open the door of a building, then open this page within a minute, to end a claim on it or set its rent.'));
      return card;
    }
    var r = d.rent;
    // Who owes rent here: the holder, and anybody who held it before (#3893).
    var owing = Array.isArray(d.owing) ? d.owing : [];
    card.appendChild(el('div', 'desc', (d.by ? 'Held by ' + d.by + '. ' : 'Nobody holds it. ') +
      (r ? 'Rent ' + r.amount + ' gold every ' + r.every + ' days, ' + r.owed + ' owed.' : 'No rent on it.')));
    // A steward settles only their own hold's buildings (#2551); the server says whose this one is.
    // Staff settle any building, as staff, and the server logs it.
    if (d.staff) {
      card.appendChild(el('div', 'desc', (d.where ? 'It answers to ' + String(d.where) + '. ' : 'It answers to no hold. ') +
        'You act as staff here: what you press goes in the staff log with your name.'));
    } else if (!d.ours) {
      card.appendChild(el('div', 'desc', d.where
        ? 'It answers to ' + String(d.where) + '. Only the Steward of ' + String(d.where) + ' or its Jarl ends a claim or sets rent here.'
        : 'It answers to no hold the server knows, so no steward ends a claim or sets rent here.'));
      return card;
    }
    // Rent handed over in person (#3895): Rent paid beside each who owes, the clock untouched.
    owing.forEach(function (o) { officeRow(card, String(o.name || 'somebody'), rentOwedText(o), rentPaidButtons(o)); });
    if (!d.by) return card;
    officeRow(card, '', '', [officeButton('Evict', '/evict', 'Press again to end ' + d.by + '\'s claim')]);
    var input = document.createElement('input');
    input.placeholder = 'gold';
    var set = officeButton('Set rent', function () {
      var n = Number(String(input.value || '').trim());
      if (!(n > 0) || Math.floor(n) !== n) {
        status = 'The rent is a whole number of gold above 0.'; statusKind = 'no';
        drawFoot();
        return '';
      }
      return '/rent ' + n;
    });
    input.onkeydown = function (ev) { if (ev && ev.key === 'Enter') set.onclick(ev); };
    var buttons = [input, set];
    if (r) buttons.push(officeButton('No rent', '/rent -'));
    officeRow(card, 'Rent every 7 days', '', buttons);
    return card;
  }

  function rentOwedText(o) {
    return (Number(o.owed) || 0) + ' gold owed' + (o.holds ? '' : ', from when they held it');
  }

  /* An amount and Rent paid, for gold of rent somebody handed the steward (#3895). */
  function rentPaidButtons(o) {
    var input = document.createElement('input');
    input.placeholder = String(Number(o.owed) || 0);
    var paid = officeButton('Rent paid', function () {
      var raw = String(input.value || '').trim();
      var n = raw ? Number(raw) : (Number(o.owed) || 0);
      if (!(n > 0) || Math.floor(n) !== n) {
        status = 'Say how much gold was paid, as a whole number above 0.'; statusKind = 'no';
        drawFoot();
        return '';
      }
      return '/rent paid ' + (Number(o.pid) || 0) + ' ' + n;
    });
    input.onkeydown = function (ev) { if (ev && ev.key === 'Enter') paid.onclick(ev); };
    return [input, paid];
  }

  /*
    THE WORLD, FOR STAFF (#513, Patrick, 17 Oct): server proposes, staff
    confirm. Where the world is, with its force when the stage names one and
    when it got there, the proposal waiting with when it was made and who
    made it while the server remembers (#2860: who moved the world is in the
    staff log, not here), and a button for every other stage to propose it. Confirm asks twice, because it moves the world for
    everybody. Everything here is the server's, under officePage.world, and
    the server checks staff again on every line.
  */
  function officeWorld(w) {
    var card = el('div', 'card');
    card.appendChild(el('div', 'name', 'The world'));
    var st = (w && w.stage) || {};
    var name = String(st.name || st.id || 'the start');
    card.appendChild(el('div', 'desc', 'The world is at ' + name + '.' +
      (st.force ? ' Behind it: ' + String(st.force) + '.' : '') +
      (Number(st.since) > 0
        ? ' It got there ' + whenOpens(Number(st.since)) + '.'
        : ' It has been there from the start.') +
      (st.text ? ' ' + String(st.text) : '')));
    var p = w && w.pending;
    if (p) {
      var pname = String(p.name || p.id);
      officeRow(card, 'Proposed: ' + pname + (p.force ? ' (' + String(p.force) + ')' : ''),
        (p.by ? 'by ' + String(p.by) + ', ' : '') + whenOpens(Number(p.at) || 0), [
          officeButton('Confirm', '/world confirm ' + String(p.id) + ' ' + String(Number(p.at) || 0),
            'Press again to move the world to ' + pname + (p.notice ? ' and put up its notice' : '')),
          officeButton('Drop', '/world drop ' + String(Number(p.at) || 0))
        ]);
    } else {
      card.appendChild(el('div', 'desc', 'Nothing is proposed.'));
    }
    var others = (w && Array.isArray(w.stages) ? w.stages : []).filter(function (s) { return s && s.id !== st.id; });
    if (others.length) {
      var row = officeRow(card, 'Propose', '', []);
      others.forEach(function (s) {
        row.appendChild(officeButton(String(s.name || s.id), '/world propose ' + String(s.id)));
      });
    } else {
      card.appendChild(el('div', 'desc', 'There is no other stage in the list to propose.'));
    }
    card.appendChild(el('div', 'desc', 'The world moves only when staff confirm a proposal here, and every press ' +
      'goes in the staff log with your name.'));
    return card;
  }

  /* Any of the boards, moved to where the steward stands. */
  function officeBoards(boards) {
    var card = el('div', 'card');
    card.appendChild(el('div', 'name', 'The notice boards'));
    card.appendChild(el('div', 'desc', 'Stand where a board should go and press its town. It moves to where you stand, and its box with it.'));
    var row = officeRow(card, '', '', []);
    (Array.isArray(boards) ? boards : []).forEach(function (h) {
      var where = String(h.where || h.hold);
      row.appendChild(officeButton(where, '/board move ' + String(h.hold), 'Press again to move ' + where + '\'s board here'));
    });
    return card;
  }

  /*
    The College page (#1387): what a semester hands this character, where its
    study desks stand, and when the next one opens. Everything on it is the
    server's. It has no button: the semester is E at a desk.
  */
  function drawCollege() {
    var cv = collegeView();
    if (!cv) return;
    var gain = Number(cv.gain) || 0;
    var hours = Number(cv.hours) || 0;
    var opens = Number(cv.opens) || 0;
    elBody.appendChild(el('p', 'lead', 'A semester is ' + hours + ' hours. Each one hands you ' + gain +
      (gain === 1 ? ' spell point' : ' spell points') +
      (cv.school ? ', and it buys a Novice spell of ' + cap(cv.school) + ', the school you were taught, from its tome.'
                 : ', for the spell book.')));
    var halls = Array.isArray(cv.halls) ? cv.halls.map(String) : [];
    if (halls.length) {
      elBody.appendChild(el('p', 'lead', 'A study desk stands in ' +
        (halls.length > 1 ? halls.slice(0, -1).join(', ') + ' and ' + halls[halls.length - 1] : halls[0]) +
        '. Press E at one to study.'));
    }
    elBody.appendChild(el('p', 'lead', opens > Date.now()
      ? 'Your next semester opens ' + whenOpens(opens) + '.'
      : 'A semester is open to you now.'));
  }

  /*
    MASTERS AND APPRENTICES (#1634). Everything on it is the server's, under
    mine.apprentice, except the person the look prompt's K opened it on
    (candidate, from api.takeOn). Three things are sent, each through the
    chat line every panel uses and none of them typed by anybody: Take on
    (/apprentice <id> <half>), End beside somebody you took on
    (/apprentice end <id> <half>), and End beside a Master who took you on
    (/apprentice leave <half>; Patrick on #1388, either of you can end it).
    End asks twice, the way Close Skyrim does, because an outside trade that
    ends still counts as one of the two. The server checks all of it again
    and answers in the chat, and a row that ends leaves the page when the
    server writes the property.
  */
  function drawApprentice() {
    var v = apprView();
    var took = apprList('took');
    var by = apprList('by');
    if (v) {
      var bar = el('div', 'spellbar');
      bar.appendChild(el('div', 'spellpts', (Number(v.used) || 0) + ' of your ' + (Number(v.of) || 0) +
        ' outside trades used in this life'));
      bar.appendChild(el('div', 'spellnote', 'Your sister half does not count toward them.'));
      elBody.appendChild(bar);
    }
    var wrap = el('div', 'cards');
    if (candidate) {
      var card = el('div', 'card chosen');
      var nm = el('div', 'name', candidate.name);
      nm.appendChild(el('span', 'tag gold', 'in front of you'));
      card.appendChild(nm);
      card.appendChild(el('div', 'desc', 'They say yes or no on their own prompt, and nothing is recorded until they say yes.'));
      candidate.halves.forEach(function (h) {
        var line = el('div', 'guest');
        line.appendChild(el('span', '', h.k === 'sister'
          ? nameOf('profession', h.h) + ', their sister half. It climbs past novice on their own work while you stand as their Master, and costs them nothing.'
          : 'Novice ' + nameOf('profession', h.h) + ', an outside trade. It never climbs past novice, and it is one of only two they can ever take.'));
        var go = el('span', 'act', 'Take on');
        go.onclick = function (ev) { ev.stopPropagation(); takeOnPress(h.h); };
        line.appendChild(go);
        card.appendChild(line);
      });
      wrap.appendChild(card);
    }
    if (took.length) wrap.appendChild(el('div', 'rankhead', 'You took on'));
    took.forEach(function (r) {
      var half = nameOf('profession', r.half);
      apprCard(wrap, 'took:' + r.id + ':' + r.half, r.name, half,
        r.kind === 'sister' ? 'Their sister half. Ending it keeps every rank they earned in it; past them, their count waits again.'
        : (r.kind === 'outside' ? 'Novice ' + half + ', an outside trade. Ending it takes its novice list from them' +
                                  (spellHalf(r.half) ? ', the spells they already learned from it stay' : '') +
                                  ', and it still counts as one of their two.'
                                : 'Either of you can end it.'),
        '/apprentice end ' + r.id + ' ' + r.half);
    });
    if (by.length) wrap.appendChild(el('div', 'rankhead', 'Took you on'));
    by.forEach(function (r) {
      var half = nameOf('profession', r.half);
      apprCard(wrap, 'by:' + r.half, r.name, half,
        r.kind === 'outside'
          ? 'Novice ' + half + ', an outside trade they taught you. Ending it takes its novice list away' +
            (spellHalf(r.half) ? ', the spells you already learned from it stay' : '') + ', and it still counts as one of your two.'
          : (r.stands ? 'Your sister half, past novice while they stand as your Master. Ending it keeps every rank you earned in it.'
                      : 'Your sister half. This no longer stands: they no longer list you, or are no longer a Master of it, ' +
                        'so it climbs no further. End clears it from your side.'),
        '/apprentice leave ' + r.half);
    });
    if (wrap.children.length) elBody.appendChild(wrap);
    if (!v) return;
    var notes = [];
    if (!took.length && !by.length && !candidate) notes.push('Nobody has taken you on, and you have taken nobody on.');
    if (v.sister && v.sister.half) {
      notes.push(nameOf('profession', v.sister.half) + ', your sister half, waits at ' +
        (RANK_NAMES[v.sister.rank] || cap(v.sister.rank) || 'Novice') + ' until a Master of it takes you on.');
    }
    var ms = Array.isArray(v.mastered) ? v.mastered.map(function (k) { return nameOf('profession', k); }) : [];
    if (ms.length) {
      notes.push('You are a Master of ' + (ms.length > 1 ? ms.slice(0, -1).join(', ') + ' and ' + ms[ms.length - 1] : ms[0]) +
        '. Look at somebody: when you could take them on, the prompt says so, and its key opens this page on them.');
    }
    notes.forEach(function (t) { elBody.appendChild(el('p', 'lead', t)); });
  }
  /* One arrangement: who, which half, what ending it does, and its End. */
  function apprCard(wrap, key, name, half, desc, line) {
    var card = el('div', 'card');
    var nm = el('div', 'name', String(name || 'somebody'));
    nm.appendChild(el('span', 'tag', half));
    card.appendChild(nm);
    var row = el('div', 'guest');
    row.appendChild(el('span', '', desc));
    var armed = !!(endArmed && endArmed.key === key && Date.now() - endArmed.at < END_ARM_MS);
    var end = el('span', 'act' + (armed ? ' armed' : ''), armed ? 'Press again to end' : 'End');
    end.onclick = function (ev) { ev.stopPropagation(); endPress(key, line, String(name || 'them')); };
    row.appendChild(end);
    card.appendChild(row);
    wrap.appendChild(card);
  }

  function drawRecipes() {
    var book = recipeBook();
    var halves = recipeHalves();
    if (!halves.length) {
      elBody.appendChild(el('p', 'lead', (book && book.none) ||
        'The server has not said what you can make yet. Give it a moment.'));
      return;
    }
    // The one line over the columns: what the whole book adds up to. A person
    // opening this wants the number before they want the breakdown.
    var open = 0, total = 0, locked = 0;
    halves.forEach(function (h) {
      open += Number(h.open) || 0;
      total += Number(h.total) || 0;
      locked += Number(h.locked) || 0;
    });
    var bar = el('div', 'spellbar');
    bar.appendChild(el('div', 'spellpts', total
      ? open + ' of ' + total + ' open to you right now'
      : 'Nothing in your halves is made from a recipe'));
    /*
      The rows your rank reaches that Skyrim will not list, said out loud. The
      server counts them as locked: a recipe carrying a perk, a spell or an
      item condition of its own, which the crafting menu evaluates on this
      machine before the server is ever asked. Without this line a new
      Hearthcook sees "1 of 112" with nothing saying where the other 48 rows
      on their own rung went, and reads the page as broken.
    */
    bar.appendChild(el('div', 'spellnote', locked
      ? 'Rank comes from doing the work. ' + locked +
        ' more are at your rank and held behind a perk, a spell or something you have to be holding.'
      : 'Rank comes from doing the work.'));
    elBody.appendChild(bar);

    var cols = el('div', 'cols bookcols' + (halves.length > 2 ? ' wide' : ''));
    halves.forEach(function (h) {
      var col = el('div', 'col');
      var head = el('div', 'colhead', String(h.name));
      // The rank the server holds you at in this half, beside its name, the
      // same place the spell book puts a school's rank.
      if (h.rank) head.appendChild(el('span', 'tag dim', RANK_NAMES[h.rank] || cap(h.rank)));
      col.appendChild(head);
      col.appendChild(el('div', 'bookhow', howYouHoldIt(String(h.how || 'own'), String(h.rank || ''))));
      var fams = Array.isArray(h.families) ? h.families : [];
      if (!fams.length) {
        col.appendChild(el('p', 'bookwhy', h.why ||
          'Nothing here is open to you yet.'));
        cols.appendChild(col);
        return;
      }
      col.appendChild(el('div', 'bookopen', (Number(h.open) || 0) + ' of ' + (Number(h.total) || 0) + ' open'));
      fams.forEach(function (f) {
        if (!f || !f.name) return;
        var row = el('div', 'bookrow');
        row.appendChild(el('span', 'bn', String(f.name)));
        row.appendChild(el('span', 'bv', (Number(f.open) || 0) + ' of ' + (Number(f.total) || 0)));
        col.appendChild(row);
      });
      cols.appendChild(col);
    });
    elBody.appendChild(cols);
  }

  /*
    THE PROFESSION GUIDES (#3165). One page per profession, Patrick's answer
    A: what it makes, where the materials come from, how it ranks up. The
    tabs across the top are the eight professions; the page opens on your
    own, or while creating on the one marked, and a tab press reads another.
    Nothing on it is picked or sent. The facts are GUIDES, the sentences
    GUIDE_TEXT, and a person's own rank is the panel's, as everywhere here.
  */
  function guideRows() { return DATA.profession ? DATA.profession.rows : []; }
  function guideHas(key) {
    var list = guideRows();
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return true;
    return false;
  }
  function guideProf() {
    if (guideAt && guideHas(guideAt)) return guideAt;
    if (mine && mine.profession && guideHas(mine.profession)) return mine.profession;
    var p = picked.profession;
    if (creating() && p && p.row && guideHas(p.row)) return p.row;
    return '';
  }
  // A ladder number in a sentence: {perSpell} and the like, out of GUIDES.ladder.
  function guideFill(text) {
    var ladder = (typeof GUIDES === 'object' && GUIDES && GUIDES.ladder) || {};
    return String(text || '').replace(/\{(\w+)\}/g, function (all, k) { return ladder[k] !== undefined ? String(ladder[k]) : all; });
  }
  function guideList(names) {
    var n = names.length;
    if (!n) return '';
    if (n === 1) return names[0];
    return names.slice(0, n - 1).join(', ') + ' and ' + names[n - 1];
  }
  function guideRank(r) { return RANK_NAMES[r] || cap(r); }
  /* One material, as a sentence: who it rests on, where it is made, and where it is found. */
  function guideMaterial(m) {
    var who = GUIDE_WHO[m[2]] || '';
    var at = guideRank(m[3]);
    var bench = String(m[4] || '');
    var from = Array.isArray(m[5]) ? m[5] : [];
    var where = Array.isArray(m[6]) ? m[6] : [];
    var more = Number(m[7]) || 0;
    var out;
    if (!who) out = 'Nobody in Thornswood gathers it: it is found or bought.';
    else if (bench) {
      out = 'Made at the ' + bench.charAt(0).toLowerCase() + bench.slice(1) +
            (from.length ? ' from ' + guideList(from) : '') + ', out of a ' + who + '\'s work at ' + at + '.';
    } else out = 'A ' + who + '\'s work, at ' + at + '.';
    if (where.length) {
      out += ' ' + (m[2] === 'miner' ? 'Veins in ' : 'Taken from ') + guideList(where) +
             (more ? ', and ' + more + ' more' + (m[2] === 'miner' ? (more === 1 ? ' place' : ' places') : '') : '') + '.';
    }
    return out;
  }
  function guideLine(text) { elBody.appendChild(el('p', 'guideline', text)); }
  function guideHead(text) { elBody.appendChild(el('div', 'colhead guidehead', text)); }
  function guideRow(name, value) {
    var row = el('div', 'bookrow');
    row.appendChild(el('span', 'bn', name));
    if (value) row.appendChild(el('span', 'bv', value));
    elBody.appendChild(row);
    return row;
  }
  function guideCounts(byRank, what) {
    var out = [];
    for (var i = 0; i < RANK_ORDER.length; i++) {
      var n = Number(byRank[i]) || 0;
      if (n) out.push(n + ' ' + RANK_ORDER[i]);
    }
    return out.join(', ') + (what ? ' ' + what : '');
  }

  function drawGuides() {
    var g = (typeof GUIDES === 'object' && GUIDES) ? GUIDES : null;
    var at = guideProf();
    var tabs = el('div', 'halves eight');
    guideRows().forEach(function (r) {
      var tab = el('div', 'half' + (r.key === at ? ' on' : '') + (mine && mine.profession === r.key ? ' mine' : ''));
      tab.appendChild(el('div', 'hn', r.name));
      if (mine && mine.profession === r.key) tab.appendChild(el('div', 'hr', 'yours'));
      tab.onclick = function () { guideAt = r.key; draw(); };
      tabs.appendChild(tab);
    });
    elBody.appendChild(tabs);
    if (!at) {
      guideLine('Pick a profession above to read its page.');
      return;
    }
    var row = rowOf('profession', at) || {};
    var page = (g && g.professions && g.professions[at]) || null;
    var text = GUIDE_TEXT[at] || {};
    var ladder = (g && g.ladder) || null;
    if (!page || !ladder) {
      guideLine('This page has no guide for ' + (row.name || cap(at)) + ' yet.');
      return;
    }
    guideLine((row.desc || '') + (row.perk ? ' ' + row.perk : ''));
    // Where you stand in it, from the ranks the server sent: only on your own.
    var subs = row.subs || [];
    if (mine && mine.profession === at) {
      var held = [];
      subs.forEach(function (s) { var rk = rankOf(s.key); if (rk) held.push(guideRank(rk) + ' ' + s.name); });
      if (held.length) guideLine('You are ' + guideList(held) + '. The skill tree page counts the work to your next rank.');
    }

    guideHead('What it makes');
    if (at === 'mage') {
      guideLine(guideFill(text.makes));
      var schools = (DATA.spells && DATA.spells.schools) || {};
      subs.forEach(function (s) {
        var by = schools[s.key] || {};
        var counts = RANK_ORDER.map(function (rk) { return (by[rk] || []).length; });
        guideRow(s.name, guideCounts(counts, 'spells'));
      });
    } else {
      subs.forEach(function (s) {
        var h = (page.halves && page.halves[s.key]) || null;
        elBody.appendChild(el('div', 'rankhead', s.name + (s.desc ? ': ' + s.desc : '')));
        var makes = text.makes && text.makes[s.key];
        if (makes) guideLine(guideFill(makes));
        if (!h) return;
        if (h.benches && h.benches.length) {
          var from = {};
          h.benches.forEach(function (b) { (from[b[1]] = from[b[1]] || []).push(b[0]); });
          var parts = [];
          RANK_ORDER.forEach(function (rk) {
            if (from[rk]) parts.push(guideList(from[rk]) + (rk === 'novice' ? ' from Novice' : ' at ' + guideRank(rk)));
          });
          guideLine('Works at the ' + parts.join('; the ') + '.');
        }
        (h.maneuvers || []).forEach(function (m) {
          guideRow(m[0], guideRank(m[1]) + ': ' + (GUIDE_MANEUVER[m[0]] || '') + '. ' + m[2] + ' stamina, then ' + m[3] + ' seconds to wait');
        });
        (h.families || []).forEach(function (f) { guideRow(f[0], guideCounts(f.slice(1), '')); });
        if (h.count) {
          if (h.first && h.first.length) guideLine('A new Novice can start with ' + guideList(h.first) + '.');
          else guideLine('Nothing here is open on the first day: every Novice recipe waits on a perk, a spell or something you have to be holding.');
          if (h.race) guideLine(h.race + (h.race === 1 ? ' of these is' : ' of these are') + ' for one race only.');
        }
      });
    }

    guideHead('Where the materials come from');
    (page.materials || []).forEach(function (m) {
      guideRow(String(m[0]), m[1] + (m[1] === 1 ? ' recipe asks for it' : ' recipes ask for it'));
      guideLine(guideMaterial(m));
    });
    if (text.where) guideLine(guideFill(text.where));

    guideHead('How to rank up');
    if (text.climb) guideLine(guideFill(text.climb));
    var per = ladder.per || {};
    guideLine('The count starts again at each rank: ' + per.advanced + ' into Advanced, ' + per.expert +
              ' into Expert and ' + per.master + ' into Master. Each rank hands you a skill tree point.');
    if (at !== 'mage') {
      var rest = ladder.rest || {};
      guideLine('Each piece of work costs rest: ' + RANK_ORDER.map(function (rk) { return rest[rk] + ' at ' + guideRank(rk); }).join(', ') + '.' +
                (text.craft ? ' Under ' + ladder.craftRest + ' rest, nothing is made at a bench.' : ''));
      guideLine(text.sister || 'Your sister half gives you its Novice work, and climbs past Novice only when a Master of it takes you on.');
    }
    guideLine('Work done while somebody from your party is in the same cell banks ' + ladder.party + '% more.');
  }

  /* The last card of Class and of Profession while creating. A click is the mark; nothing is sent. */
  function laterCard(wrap, sec, i) {
    var card = el('div', 'card later' + (i === rowAt ? ' at' : ''));
    var name = el('div', 'name', 'Choose later');
    if (later[sec]) name.appendChild(el('span', 'tag dim', 'left for later'));
    card.appendChild(name);
    card.appendChild(el('div', 'desc', DATA[sec].later || ''));
    card.onclick = function () { rowAt = i; chooseLater(sec); draw(); };
    wrap.appendChild(card);
  }
  /* The tag on a card you have picked: while creating the click is the choice, in the world Confirm sends it. */
  function chosenTag() { return el('span', 'tag gold', creating() ? 'chosen' : 'chosen, confirm below'); }

  function drawClass() {
    var wrap = el('div', 'cards');
    var have = haveClass();
    var p = picked['class'] || {};
    rows().forEach(function (r, i) {
      var isMine = have && mine['class'] === r.key;
      var card = el('div', 'card' + (i === rowAt ? ' at' : '') + (isMine ? ' mine' : '') + (have && !isMine ? ' off' : ''));
      var name = el('div', 'name', r.name);
      if (isMine) name.appendChild(el('span', 'tag', 'yours'));
      else if (p.row === r.key) name.appendChild(chosenTag());
      card.appendChild(name);
      card.appendChild(el('div', 'desc', r.desc));
      card.onclick = function () {
        rowAt = i;
        if (!have) choose('class', r.key, []);
        draw();
      };
      wrap.appendChild(card);
    });
    if (laterOffered('class')) laterCard(wrap, 'class', rows().length);
    elBody.appendChild(wrap);
  }

  function drawProfession() {
    var wrap = el('div', 'cards');
    var have = haveProf();
    var p = picked.profession || {};
    rows().forEach(function (r, i) {
      var isMine = have && mine.profession === r.key;
      var open = i === rowAt && !have;
      var card = el('div', 'card' + (i === rowAt ? ' at' : '') + (isMine ? ' mine' : '') + (have && !isMine ? ' off' : ''));
      var name = el('div', 'name', r.name);
      if (isMine) name.appendChild(el('span', 'tag', 'yours'));
      else if (p.row === r.key && p.subs && p.subs.length) name.appendChild(chosenTag());
      card.appendChild(name);
      card.appendChild(el('div', 'desc', r.desc));

      if (open || isMine) {
        var want = r.pick || 1;
        var halves = el('div', 'halves' + ((r.subs || []).length > 2 ? ' five' : ''));
        (r.subs || []).forEach(function (s) {
          var on = !isMine && p.row === r.key && (p.subs || []).indexOf(s.key) >= 0;
          var mineHalf = isMine && ownHalves().indexOf(s.key) >= 0;
          var h = el('div', 'half' + (on ? ' on' : '') + (mineHalf ? ' mine' : ''));
          h.appendChild(el('div', 'hn', s.name));
          if (s.desc) h.appendChild(el('div', 'hd', s.desc));
          var rk = rankOf(s.key);
          if (isMine && rk) h.appendChild(el('div', 'hr', (RANK_NAMES[rk] || cap(rk)) + (mineHalf ? '' : ', your sister half')));
          if (!isMine) {
            h.onclick = function (ev) {
              ev.stopPropagation();
              var cur = (picked.profession && picked.profession.row === r.key) ? picked.profession.subs.slice() : [];
              var at = cur.indexOf(s.key);
              if (at >= 0) cur.splice(at, 1); else cur.push(s.key);
              while (cur.length > want) cur.shift();
              choose('profession', r.key, cur);
              draw();
            };
          }
          halves.appendChild(h);
        });
        card.appendChild(halves);
        if (!isMine && want > 1) {
          var n = (p.row === r.key && p.subs) ? p.subs.length : 0;
          card.appendChild(el('div', 'inn', 'Pick ' + want + ' schools. ' + n + ' of ' + want + ' picked.'));
        } else if (!isMine) {
          card.appendChild(el('div', 'inn', 'Pick the half you will make your own. The other is yours at novice from the start.'));
        }
        if (r.perk) card.appendChild(el('div', 'perk', r.perk));
        if (isMine && mine.weave) drawWeave(card);
      }
      card.onclick = function () {
        if (have) { rowAt = i; draw(); return; }
        // A click on another card starts that card fresh: the half picked on
        // the last one, or the "later" mark, must not ride under this one and
        // go out when it is sent.
        var fresh = p.row !== r.key;
        if (fresh) choose('profession', r.key, []);
        if (rowAt !== i || fresh) { rowAt = i; draw(); }
      };
      wrap.appendChild(card);
    });
    if (laterOffered('profession')) laterCard(wrap, 'profession', rows().length);
    elBody.appendChild(wrap);
  }

  /*
    MASTER WEAVER'S PICK (#1398), under the perk on a Master Weaver's own
    profession card: what the garments they make from now on carry, warmth
    or armour, and never both. The server sends weave, 'warmth' or 'armour',
    to somebody who holds the perk and to nobody else. The lit one is what
    it holds; a press on the other sends 'skills:pick weave <key>', and the
    answer is the view written again. The numbers are the server's: 4 is
    NEEDS.wear.woven.degrees and 10% is WOVEN.less in the maneuvers block.
  */
  var WEAVES = [
    { key: 'warmth', name: 'Warmth', desc: 'One worn ignores 4 degrees of the weather.' },
    { key: 'armour', name: 'Armour', desc: 'Hidden armour: one worn gives back 10% of each hit.' }
  ];
  function weaveWaiting() {
    for (var i = 0; i < pending.length; i++) if (pending[i].section === 'weave') return true;
    return false;
  }
  function drawWeave(card) {
    card.appendChild(el('div', 'inn', 'What the garments you make from now on carry. Each one carries one of the two.'));
    var row = el('div', 'halves');
    WEAVES.forEach(function (w) {
      var on = mine.weave === w.key;
      var h = el('div', 'half' + (on ? ' mine' : ''));
      h.appendChild(el('div', 'hn', w.name));
      h.appendChild(el('div', 'hd', w.desc));
      if (on) h.appendChild(el('div', 'hr', 'What you weave now'));
      h.onclick = function (ev) {
        ev.stopPropagation();
        if (on || weaveWaiting()) return;
        send('weave', 'weave ' + w.key);
        status = 'Sent.'; statusKind = '';
        draw();
      };
      row.appendChild(h);
    });
    card.appendChild(row);
  }

  function drawHome() {
    var towns = (mine && mine.towns) || [];
    var wrap = el('div', 'cards three');
    var p = picked.home || {};
    towns.forEach(function (t, i) {
      var card = el('div', 'card' + (i === rowAt ? ' at' : '') + (haveHome() && mine.home === t.key ? ' mine' : ''));
      var name = el('div', 'name', t.name);
      if (haveHome() && mine.home === t.key) name.appendChild(el('span', 'tag', 'yours'));
      else if (p.row === t.key) name.appendChild(el('span', 'tag gold', 'chosen'));
      card.appendChild(name);
      if (t.hold) card.appendChild(el('div', 'inn', t.hold));
      card.onclick = function () { rowAt = i; if (!haveHome()) choose('home', t.key, []); draw(); };
      wrap.appendChild(card);
    });
    if (!towns.length) elBody.appendChild(el('p', 'lead', 'The server has not sent the town list yet. Give it a moment.'));
    elBody.appendChild(wrap);
  }

  /*
    Review, the last section while creating: one row per choice, read from
    the same marks the section list reads, so the two never disagree. What
    the server already has (a class accepted before the home was refused,
    say) reads in green, a soft choice in gold, a later mark or nothing yet
    dim, and the home stands out until it is chosen.
  */
  function reviewRows() {
    var out = [];
    var soft = null;
    if (haveProf()) out.push({ k: 'Profession', v: navValue('profession').t, c: 'set' });
    else if ((soft = softProf())) out.push({ k: 'Profession', v: soft.t, c: soft.c });
    else out.push({ k: 'Profession', v: later.profession ? 'later' : 'not chosen yet', c: 'dim' });
    if (isMage()) {
      var m = markedCount();
      out.push({ k: 'Spell book', v: m ? m + ' marked, not sent yet' : 'nothing marked yet', c: m ? 'chosen' : 'dim' });
    }
    if (haveClass()) out.push({ k: 'Class', v: nameOf('class', mine['class']), c: 'set' });
    else if ((soft = softClass())) out.push({ k: 'Class', v: soft.t, c: 'chosen' });
    else out.push({ k: 'Class', v: later['class'] ? 'later' : 'not chosen yet', c: 'dim' });
    if (haveHome()) out.push({ k: 'Home', v: cap(mine.home) + (holdOf(mine.home) ? ', ' + holdOf(mine.home) : ''), c: 'set' });
    else if ((soft = softHome())) out.push({ k: 'Home', v: soft.t + (soft.hold ? ', ' + soft.hold : ''), c: 'chosen' });
    else out.push({ k: 'Home', v: 'not chosen yet', c: 'need' });
    return out;
  }
  function drawReview() {
    var wrap = el('div', 'review');
    reviewRows().forEach(function (r) {
      var row = el('div', 'rrow');
      row.appendChild(el('div', 'rk', r.k));
      row.appendChild(el('div', 'rv' + (r.c ? ' ' + r.c : ''), r.v));
      wrap.appendChild(row);
    });
    elBody.appendChild(wrap);
    elBody.appendChild(el('p', 'lead', 'A home is the one thing that has to be chosen. The rest can wait for the world.'));
  }

  function drawTree() {
    // The work towards the next rank, when the server has sent it, above the
    // fifteen skills: they are the two things a person came here to read.
    var prog = progressLines();
    if (prog.length) {
      var pw = el('div', 'progress');
      prog.forEach(function (p) {
        var prow = el('div', 'prow');
        prow.appendChild(el('div', 'pk', p.k));
        // Kept, so drawProgress can write the number into it without the
        // body being torn down around it.
        var pv = el('div', 'pv', p.t);
        prow.appendChild(pv);
        progRows.push(pv);
        pw.appendChild(prow);
      });
      elBody.appendChild(pw);
      progKey = JSON.stringify(prog.map(function (p) { return p.t; }));
    }
    var cols = el('div', 'cols');
    var pts = mine ? Number(mine.points) || 0 : 0;
    var tree = (mine && mine.tree) || {};
    var flat = [];
    rows().forEach(function (attr) {
      var col = el('div', 'col');
      col.appendChild(el('div', 'colhead', attr.name));
      (attr.subs || []).forEach(function (s) {
        var idx = flat.length; flat.push(s.key);
        var have = Number(tree[s.key]) || 0;
        var given = placedAt(s.key);
        var full = have >= CAP;
        var row = el('div', 'skill' + (idx === rowAt ? ' at' : '') + (full ? ' full' : (have ? ' some' : '')));
        row.appendChild(el('div', 'sn', s.name));
        // The placed pips first and in green, which in this panel is what is
        // already yours; the ones over them are what was spent and keep the
        // colour the row has always given them.
        var pips = el('div', 'pips');
        for (var i = 0; i < CAP; i++) {
          pips.appendChild(el('span', 'pip' + (i < have ? ' lit' : '') + (i < given ? ' given' : '')));
        }
        row.appendChild(pips);
        /*
          The plus offers the room that is left. Placed points fill a skill
          like any other, so a skill filled by what your choices placed is
          full and offers no plus: there is nothing on it to add to and
          nothing on it to take back. A skill that is part placed and part
          empty keeps its plus, because the server takes that spend and
          refuses only at the cap, and this page decides none of it.
        */
        var allPlaced = given > 0 && given >= have;
        var plus = el('div', 'plus' + ((pts > 0 && !full) ? '' : ' off'), '+');
        plus.title = (full && allPlaced) ? s.name + ' came with what you chose.'
                   : 'Put a point in ' + s.name +
                     (given ? '. ' + given + ' of these came with what you chose and do not move.' : '');
        plus.onclick = function (ev) { ev.stopPropagation(); spend(s.key); };
        row.appendChild(plus);
        var clock = full ? perkClock(PERK_OF[s.key]) : '';
        row.appendChild(el('div', 'sd' + (full ? ' lit' : ''), full ? s.perk + (clock ? ' ' + clock : '') : s.desc + '. ' + s.perk));
        if (full && PERK_OF[s.key] === 'fontofmagic') {
          var use = el('div', 'use' + (perkReady('fontofmagic') && !perkWaiting() ? '' : ' off'), 'Use');
          use.title = 'Start Font of Magic';
          use.onclick = function (ev) { ev.stopPropagation(); usePerk('fontofmagic'); };
          row.appendChild(use);
        }
        /*
          Strength (#2262): Might is what a heavy weapon needs. The server
          refuses the equip (the strength weapons block in game/gamemode.js);
          this line says so first, so nobody finds out by trying. The two
          rows are the server's STRENGTH.tiers, kept equal by
          tests/test-2262-strength-weapons.js.
        */
        if (s.gate) row.appendChild(el('div', 'sd gate', gateLine(s.gate, have)));
        row.onclick = function () { rowAt = idx; draw(); };
        col.appendChild(row);
      });
      cols.appendChild(col);
    });
    elBody.appendChild(cols);
  }

  /*
    The status line and the two buttons: three elements, set in place, never
    rebuilt. In the world Confirm sits under every section that sends.

    CLOSE IS THERE WHILE CREATING NOW, and it used to be hidden.

    Djinn, 21 September: "There is no way to leave the character creation
    screen except to make a character then log out. this needs a resolution."
    The old note here said Escape and K shut the panel "and the server's
    reminder brings it back", which is exactly the complaint written down as
    though it were the design: you could shut it and it reopened thirty
    seconds later, so you could not shut it.

    Hiding the button did not stop anybody leaving either, since Escape
    already worked. All it did was hide that leaving was possible, from the
    people most likely to want it. The button is honest about what it does
    now, and closing tells the server, which holds the reminder off for ten
    minutes instead of thirty seconds. Nothing about the character is decided
    by it.
  */
  function drawFoot() {
    var cr = creating();
    var can = canConfirm();
    var line = status || hint();
    // The spell book's own button says Learn, because what it sends is not a
    // choice about who you are: it is the spells you marked, one pick each.
    var label = (!cr && section === 'spells') ? 'Learn' : ((!cr && section === 'staff') ? 'Unlock' : 'Confirm');
    // The recipe book sends nothing, the same way the tree's plus buttons are
    // the tree's own sending, so neither carries a Confirm.
    var showConfirm = cr ? section === 'review'
      : (section !== 'start' && section !== 'tree' && section !== 'recipes' && section !== 'guides' && section !== 'property' && section !== 'office' &&
         section !== 'apprentice' && section !== 'hairdye' && section !== 'body' && section !== 'alchemy' && section !== 'college');
    var shut = closeWord();
    var key = JSON.stringify([line, statusKind, can, label, showConfirm, cr, shut, keyName]);
    if (key === footKey) return;
    footKey = key;
    elStatus.className = 'status' + (statusKind ? ' ' + statusKind : '');
    elStatus.textContent = line;
    elConfirm.className = 'tsbtn primary' + (can ? '' : ' off');
    elConfirm.textContent = label;
    elConfirm.style.display = showConfirm ? '' : 'none';
    elClose.style.display = '';
    // Close Skyrim while creating and Close in the world. It said "Not now"
    // while creating and only put the panel down; see closeButton for why it
    // does not any more.
    elClose.className = 'tsbtn ghost' + ((cr && quitArmed) ? ' danger' : '');
    elCloseLabel.textContent = shut;
    elCloseKey.textContent = keyName;
    elCloseKey.style.display = (cr || !keyName) ? 'none' : '';
    elHelp.style.display = cr ? 'none' : '';
    elSwitch.style.display = cr ? 'none' : '';
    elSettings.style.display = cr ? 'none' : '';
  }

  function hint() {
    if (section === 'tree') return 'Press + on a skill to put a point in it.';
    if (section === 'guides') return 'Pick a profession to read its page. Nothing here is picked or sent.';
    if (section === 'recipes') {
      var halves = recipeHalves();
      if (!halves.length) return 'Pick a profession and its half, and this fills with what that half can make.';
      var open = 0;
      for (var i = 0; i < halves.length; i++) open += Number(halves[i].open) || 0;
      if (!open) return 'Nothing is open to you yet. Every column says what it is waiting on.';
      return 'What you can make now, at a bench. Nothing here is picked or sent.';
    }
    if (section === 'spells') {
      if (!bookSchools().length) return 'The book needs your two schools.';
      if (creating()) return 'Click a spell to mark it. Nothing is sent until Confirm in Review.';
      if (learnWaiting()) return 'Sent. The server is checking.';
      if (markedCount()) return 'Learn sends the spells you marked, one point each.';
      // 0 is the server saying none; no number at all is the server saying
      // nothing, and the page does not put words in its mouth.
      var sp = spellPoints();
      if (sp !== null && sp <= 0) return 'No spell points to spend. More come with every rank and with a semester at the College.';
      return 'Mark the spells you want, then press Learn. One point each.';
    }
    if (section === 'apprentice') {
      if (candidate) return 'Take on asks them. They answer on their own prompt.';
      if (apprList('took').length || apprList('by').length) return 'End asks twice. Either of you can end it, and the ranks earned stay.';
      return 'A Master takes somebody on by looking at them and pressing the key the prompt names.';
    }
    if (section === 'start') return 'Nothing here is picked. Each step ticks itself, and Put this away takes the page off your panel.';
    if (section === 'hairdye') {
      if (dyeTarget) return 'Offer to dye asks them. They answer on their own prompt.';
      return 'Dye my hair uses the dye at once. The server answers in the chat.';
    }
    if (section === 'college') return 'Press E at a study desk in one of the College\'s halls. The College answers in the chat.';
    if (section === 'office') return 'Each button is checked again by the server, and it answers in the chat.';
    if (section === 'body') return 'As the server counted it when K opened. Read again asks it now.';
    if (section === 'alchemy') return 'What your character knows, as K opened. Nothing here is picked or sent.';
    if (section === 'staff') {
      if (staffWaiting()) return 'Sent. The server is checking.';
      if (markedStaffDescs().length) return 'Unlock sends the staff spells you marked, one staff spell point each.';
      var stp = staffPoints();
      if (stp !== null && stp <= 0) return 'No staff spell points to spend. More come with every Bladebinder rank.';
      return 'Mark the staff spells you want, then press Unlock. One staff spell point each, no tome needed.';
    }
    if (section === 'review') {
      if (!(haveHome() || softHome())) return 'Pick a home first. Confirm sends everything you chose to the server.';
      return 'Confirm sends everything you chose to the server and takes you to your home town.';
    }
    // The later lines are creation's: the mark is only ever set there.
    if (section === 'class') {
      if (haveClass()) return 'Your class is set for good.';
      if (later['class']) return 'Class left for later. Pick one now if you would rather, or move on.';
      if (creating()) return 'Pick a class and move on, or choose later and pick it in the world. Nothing is sent until Confirm.';
      return 'Pick a class, then confirm. One class, for good.';
    }
    if (section === 'profession') {
      if (haveProf()) return 'Your profession is set. Ranks come from doing the work.';
      if (later.profession) return 'Profession left for later. Pick one and its half now if you would rather, or move on.';
      if (creating()) return 'Pick a profession and its half and move on, or choose later and pick it in the world. Nothing is sent until Confirm.';
      return 'Pick a profession and its half, then confirm.';
    }
    if (section === 'home') return haveHome() ? 'Home is set.' : 'Pick the town you will start in and move on to Review. A home is the one thing you must choose before you leave the hall.';
    return '';
  }

  // --------------------------------------------------------------- picks --
  /*
    While creating the one button is Begin, in Review, lit once a home is
    chosen. In the world Confirm sends the section's own pick: a class, or a
    profession with its half or both schools.
  */
  /*
    Learn lights when there is something to send and the points cover it: at
    least one spell marked, and no more marks than the points the server says
    you hold. Marking already asks the same question, and it is asked again
    here because the points are the server's and can change between the mark
    and the press. No number from the server is not a no: the marks go and
    the server answers them.

    It goes dark the moment it has sent and stays dark until the answer comes
    back, the way Confirm elsewhere goes dark the moment the thing it asked
    for is the server's. Every line Learn sends is a chat command the server
    clones and checks, so three presses on two marked spells used to be six
    of them.
  */
  /*
    How long Learn stays dark when no answer comes at all. NOT IN THE
    RULEBOOK: classes.md says nothing about how long a button waits, so this
    is a first number, long enough that a second press is a second thought
    and short enough that a lost answer does not strand the button. It is
    kept beside PENDING_MS, the other number of this kind on the page; this
    file has no TUNING block of its own and the server's is in gamemode.js.
  */
  var LEARN_WAIT_MS = 4000;
  var learnAt = 0;   // when Learn last sent, 0 when it is not waiting on anything
  function learnWaiting() {
    if (!learnAt) return false;
    if (Date.now() - learnAt >= LEARN_WAIT_MS) { learnAt = 0; return false; }
    for (var i = 0; i < pending.length; i++) if (pending[i].section === 'spells') return true;
    learnAt = 0;   // every spell it sent has been answered
    return false;
  }
  function canLearn() {
    if (learnWaiting()) return false;
    var n = markedCount();
    var p = spellPoints();
    return n > 0 && (p === null || n <= p);
  }

  /*
    The staff page's Unlock, the same as Learn: lit when something is marked
    and the points cover it, dark from the moment it sends until the answers
    are back or LEARN_WAIT_MS has passed.
  */
  var staffAt = 0;   // when Unlock last sent, 0 when it is not waiting on anything
  function staffWaiting() {
    if (!staffAt) return false;
    if (Date.now() - staffAt >= LEARN_WAIT_MS) { staffAt = 0; return false; }
    for (var i = 0; i < pending.length; i++) if (pending[i].section === 'staff') return true;
    staffAt = 0;
    return false;
  }
  function canUnlockStaff() {
    if (staffWaiting()) return false;
    var n = markedStaffDescs().length;
    var p = staffPoints();
    return n > 0 && (p === null || n <= p);
  }
  function unlockStaff() {
    if (staffWaiting()) return;
    var descs = markedStaffDescs();
    if (!descs.length) return;
    // The desc goes whole, spaces and all: the server reads the rest of the line.
    descs.forEach(function (d) { send('staff', 'staffspell ' + d, d); });
    staffAt = Date.now();
    status = 'Sent. The server is checking.'; statusKind = '';
    setTimeout(function () { if (!staffWaiting()) draw(); }, LEARN_WAIT_MS + 50);
    draw();
  }

  /*
    Masters and apprentices (#1634). Take on goes at once: the person still
    has to say yes on their own prompt. End arms on the first press and
    sends on a second inside END_ARM_MS; a first press on its own disarms,
    so a stray click ends nothing. Both send through the chat line the way
    the property page's Stop does, and the server answers in the chat.
  */
  var END_ARM_MS = 5000;
  function sayLine(line) {
    try {
      if (window.thornswoodNet && window.thornswoodNet.say) { window.thornswoodNet.say(line); return true; }
    } catch (e) { }
    status = 'The connection is loading. Try again in a moment.'; statusKind = 'no';
    return false;
  }
  /*
    HAIR DYE (#2675). Dye my hair sends '/hairdye self <id>'; with somebody
    from the look prompt, Offer to dye sends '/hairdye offer <id> <dye>' and
    they answer on their own prompt. The server checks it all again.
  */
  function dyePress(line, done) {
    if (!sayLine(line)) { draw(); return; }
    status = done; statusKind = '';
    draw();
  }
  /*
    FIRST STEPS (#3166). One card a step, in the server's words, green once
    the server has seen it done. Nothing on it is picked; Put this away is
    the one press, and the server takes the page off the panel for it.
  */
  function drawStart() {
    var v = startView();
    if (!v) return;
    var wrap = el('div', 'cards');
    v.steps.forEach(function (st, i) {
      if (!st || typeof st !== 'object') return;
      var card = el('div', 'card' + (st.done ? ' mine' : ''));
      var name = el('div', 'name', (i + 1) + '. ' + String(st.name || ''));
      name.appendChild(el('span', 'tag' + (st.done ? '' : ' dim'), st.done ? 'done' : 'to do'));
      card.appendChild(name);
      card.appendChild(el('div', 'desc', String(st.text || '')));
      wrap.appendChild(card);
    });
    // The card's own row styles (.card .guest, .card .act), so the button is a card too.
    var last = el('div', 'card');
    var away = el('div', 'guest');
    away.appendChild(el('span', '', 'Know your way already?'));
    var go = el('span', 'act', 'Put this away');
    go.onclick = function (ev) {
      ev.stopPropagation();
      tell('pick', 'firststeps hide');
      status = 'Sent.'; statusKind = '';
      draw();
    };
    away.appendChild(go);
    last.appendChild(away);
    wrap.appendChild(last);
    elBody.appendChild(wrap);
  }
  function drawHairDye() {
    var v = dyeView();
    var dyes = dyeList();
    if (v && v.steeping && typeof v.steeping.name === 'string') {
      var bar = el('div', 'spellbar');
      var left = Math.max(0, Number(v.steeping.left) || 0);
      bar.appendChild(el('div', 'spellpts', v.steeping.name + ' is steeping'));
      bar.appendChild(el('div', 'spellnote', left ? 'About ' + left + ' seconds as K opened. Stay by the fire.' : 'Nearly done. Stay by the fire.'));
      elBody.appendChild(bar);
    }
    var wrap = el('div', 'cards');
    dyes.forEach(function (d) {
      var card = el('div', 'card');
      var nm = el('div', 'name', String(d.name || d.id));
      if (Number(d.count) > 1) nm.appendChild(el('span', 'tag', 'x' + Number(d.count)));
      card.appendChild(nm);
      var mineLine = el('div', 'guest');
      mineLine.appendChild(el('span', '', 'Your own hair.'));
      var go = el('span', 'act', 'Dye my hair');
      go.onclick = function (ev) { ev.stopPropagation(); dyePress('/hairdye self ' + d.id, 'Sent. The server answers in the chat.'); };
      mineLine.appendChild(go);
      card.appendChild(mineLine);
      if (dyeTarget) {
        var who = dyeTarget;
        var theirs = el('div', 'guest');
        theirs.appendChild(el('span', '', who.name + ', in front of you. Nothing is used until they say yes.'));
        var ask = el('span', 'act', 'Offer to dye');
        ask.onclick = function (ev) {
          ev.stopPropagation();
          dyeTarget = null;
          dyePress('/hairdye offer ' + who.id + ' ' + d.id, 'Asked ' + who.name + '. They answer on their own prompt.');
        };
        theirs.appendChild(ask);
        card.appendChild(theirs);
      }
      wrap.appendChild(card);
    });
    if (wrap.children.length) elBody.appendChild(wrap);
    if (!dyes.length) elBody.appendChild(el('div', 'desc', 'You carry no dye right now.'));
  }
  function takeOnPress(half) {
    if (!candidate) return;
    var who = candidate;
    if (!sayLine('/apprentice ' + who.id + ' ' + half)) { draw(); return; }
    candidate = null;
    status = 'Asked ' + who.name + '. They answer on their own prompt; if the server cannot ask, the chat says why.';
    statusKind = '';
    draw();
  }
  function endPress(key, line, name) {
    var now = Date.now();
    if (!(endArmed && endArmed.key === key && now - endArmed.at < END_ARM_MS)) {
      endArmed = { key: key, at: now };
      setTimeout(function () {
        if (endArmed && endArmed.key === key && Date.now() - endArmed.at >= END_ARM_MS) { endArmed = null; draw(); }
      }, END_ARM_MS + 50);
      draw();
      return;
    }
    endArmed = null;
    if (!sayLine(line)) { draw(); return; }
    apprSent = { key: key, name: name, at: now };
    status = 'Sent. The server answers in the chat.'; statusKind = '';
    draw();
  }
  /* An End is answered when its row is gone from what the server sent. A refusal is a line in the chat. */
  function apprAnswered() {
    if (!apprSent) return;
    var left = false;
    apprList('took').forEach(function (r) { if ('took:' + r.id + ':' + r.half === apprSent.key) left = true; });
    apprList('by').forEach(function (r) { if ('by:' + r.half === apprSent.key) left = true; });
    if (!left) {
      status = 'Ended with ' + apprSent.name + '. The chat says what it changed.'; statusKind = 'ok';
      apprSent = null;
      return;
    }
    // Still there long after: it was refused, the chat said why, and the page stops listening for it.
    if (Date.now() - apprSent.at >= PENDING_MS) apprSent = null;
  }

  /*
    BEGIN WAITS FOR ITS ANSWER. Djinn, 17 Oct, on dev: one Confirm, then
    "No: you already have a profession", "No: you already know that one"
    twice, "No: you already have a class" and "No: your home is already
    chosen" in the chat. His log shows the whole Begin sent twice, 462 ms
    apart (18:24:49.104 and .566): a second press reached begin() before the
    server's answer did, and begin() decides what is new from what the server
    has already confirmed, so the second press sent everything again. While
    the town pick is in flight Begin is dark; the answer or a refusal clears
    it (pending), and so does PENDING_MS if neither ever comes, so a lost
    answer never leaves the button dead.
  */
  function homeInFlight() {
    for (var i = 0; i < pending.length; i++) {
      if (pending[i].section === 'home' && Date.now() - pending[i].at < PENDING_MS) return true;
    }
    return false;
  }
  function canConfirm() {
    if (creating()) return section === 'review' && !!softHome() && !homeInFlight();
    if (section === 'spells') return canLearn();
    if (section === 'staff') return canUnlockStaff();
    var p = picked[section];
    if (!p || !p.row) return false;
    if (section === 'class') return !haveClass();
    if (section === 'profession') {
      if (haveProf()) return false;
      var r = rowOf('profession', p.row);
      if (!r) return false;
      return (p.subs || []).length === (r.pick || 1);
    }
    return false;
  }

  /*
    One pick to the server, remembered until its answer or a refusal comes
    back. A spell carries its name as well, because Learn puts several in
    flight at once and each one is cleared by its own answer.
  */
  function send(sec, words, spell) {
    pending.push({ section: sec, words: words, spell: spell || '', at: Date.now() });
    tell('pick', words);
  }

  /*
    Learn, in the world: every marked spell goes out as its own pick, in the
    order the book draws them, and the page waits exactly as the other
    sections wait. The mark stays until the server lists the spell as yours,
    so a refused one can be sent again.
  */
  function learn() {
    // The guard, and not only the dark button: Enter, a click on a button a
    // stylesheet failed to deaden, and a second call from anywhere else all
    // arrive here.
    if (learnWaiting()) return;
    var names = markedNames();
    if (!names.length) return;
    // The name goes as the book writes it, spaces and all: 'spell Ice Spike'
    // reaches the server as the chat line '/pick spell Ice Spike', so what it
    // reads is the rest of the line and not one word of it.
    names.forEach(function (n) { send('spells', 'spell ' + n, n); });
    learnAt = Date.now();
    status = 'Sent. The server is checking.'; statusKind = '';
    // Nothing else is coming if the answer is lost, so the button lights
    // itself again when the wait is over.
    setTimeout(function () { if (!learnWaiting()) draw(); }, LEARN_WAIT_MS + 50);
    draw();
  }

  function confirm() {
    if (!canConfirm()) return;
    if (creating()) { begin(); return; }
    if (section === 'spells') { learn(); return; }
    if (section === 'staff') { unlockStaff(); return; }
    var p = picked[section];
    send(section, section === 'class' ? 'class ' + p.row : 'profession ' + p.row + ' ' + p.subs.join(','));
    status = 'Sent. The server is checking.'; statusKind = '';
    draw();
  }

  /*
    Begin, from Review while creating: every soft choice goes to the server
    now, one pick each, in the order profession, spells, class, town. The
    spells come after the profession because a spell needs the profession
    that owns it, and the town is last because the town is the pick that ends
    creation on the server, and anything sent after it would land in the
    world. A "later" mark sends nothing; the server never hears of it. What
    the server already has is not sent again, which is what a second Begin
    after a refused home relies on.
  */
  function begin() {
    var pf = softProf();
    if (pf && pf.whole && !haveProf()) send('profession', 'profession ' + picked.profession.row + ' ' + picked.profession.subs.join(','));
    markedNames().forEach(function (n) { send('spells', 'spell ' + n, n); });
    if (softClass() && !haveClass()) send('class', 'class ' + picked['class'].row);
    send('home', 'town ' + picked.home.row);
    status = 'Sent. The server is checking.'; statusKind = '';
    // Lit again when PENDING_MS is up, if no answer ever came.
    setTimeout(function () { if (!homeInFlight()) draw(); }, PENDING_MS + 50);
    draw();
  }

  function spend(skill) {
    if (!mine || !(Number(mine.points) > 0)) return;
    send('tree', 'spend ' + skill);
    status = 'Sent.'; statusKind = '';
    draw();
  }

  /*
    THE FILLED PERKS THAT WAIT (#1385). The server sends perkClocks: when each
    one may fire again, by its clock, and until on Font of Magic while it
    runs. Counted here against this machine's clock, which is near enough for
    a day or five minutes, and redrawn whenever the server sends anything,
    which it does the moment a perk fires and every time the panel opens.
  */
  var PERK_OF = { vitality: 'cheatdeath', capacity: 'archmagesvessel', efficiency: 'fontofmagic', vigor: 'secondwind' };
  function clockOf(key) { return (key && mine && mine.perkClocks && mine.perkClocks[key]) || null; }
  function waitWords(ms) {
    var s = Math.max(1, Math.ceil(ms / 1000));
    if (s < 120) return s + (s === 1 ? ' second' : ' seconds');
    var m = Math.ceil(s / 60);
    if (m < 120) return m + ' minutes';
    return Math.ceil(m / 60) + ' hours';
  }
  function perkRunning(key) { var c = clockOf(key); return !!(c && Number(c.until) > Date.now()); }
  function perkReady(key) {
    var c = clockOf(key);
    return !!c && !perkRunning(key) && !(Number(c.ready) > Date.now());
  }
  function perkClock(key) {
    var c = clockOf(key);
    if (!c) return '';
    if (perkRunning(key)) return 'Running now.';
    if (Number(c.ready) > Date.now()) return 'Back in ' + waitWords(Number(c.ready) - Date.now()) + '.';
    return 'Ready.';
  }
  function perkWaiting() {
    for (var i = 0; i < pending.length; i++) if (pending[i].section === 'perk') return true;
    return false;
  }
  /* Use, on Font of Magic. The server decides; this only asks. */
  function usePerk(key) {
    if (perkWaiting() || !perkReady(key)) return;
    send('perk', 'perk ' + key);
    status = 'Sent.'; statusKind = '';
    draw();
  }

  /* Creation is over: the panel shuts and forgets its marks. */
  function leave() { closing = false; status = ''; statusKind = ''; later = {}; api.close(); }

  /*
    Shut by hand: the Close button, or Escape.

    While creating this also tells the server, which holds its reminder off
    for ten minutes instead of pushing the panel back in thirty seconds. That
    difference is the whole of Djinn's "there is no way to leave the character
    creation screen": closing already worked, it just did not last.

    Only from the two deliberate ways out. leave() above is creation ENDING
    and must not send it, and the server ignores it once the stage is past
    choosing anyway, so the two guards agree.
  */
  function closeByHand() {
    if (creating()) { tell('pick', 'later'); }
    api.close();
  }

  /*
    CLOSE SKYRIM, the panel's own button while creating.

    Patrick, 24 September: "the k not now button during creatioon doesnt
    close skyrim it exists the menu and lets the roam the room". While
    creating the button said Not now and did what Escape does, which is
    closeByHand above: the panel goes down, the server holds its reminder
    off, and the person is left standing in the hall. So while creating it
    says Close Skyrim and ends the game, through the front plugin's quit, the
    same one the character page's Close the game uses ('select:quit' in
    thornswood-front.js, and thornswood-select.js for the page).

    IT ASKS TWICE, the way that page does. The first press arms it and it
    says Press again to close Skyrim; a second press inside five seconds
    sends 'skills:quit'. A first press on its own disarms after five seconds,
    so a stray click never ends anybody's session. If the game is still here
    six seconds after the second press, the button comes back and the front
    is told, so it never sits on Closing for ever, which is how the
    character page's button was reported on 22 September.

    NO '/pick later' GOES FIRST. That record only holds the server's
    reminder off for the rest of this session, and the gamemode starts the
    reminder again from nothing on the next login (the seenAt check in its
    'choosing' stage), so a session that is ending has nothing to hold off.

    Outside creation the button is Close and puts the panel down, as it
    always has. Escape and K still put the panel down while creating;
    neither of them closes the game, which is why the K key cap is not
    shown beside Close Skyrim.
  */
  var QUIT_ARM_MS = 5000;
  var QUIT_BACK_MS = 6000;
  var quitArmed = 0;   // when the first press was, while it is armed
  var quitSent = 0;    // when 'skills:quit' went, until the game goes

  function closeWord() {
    if (!creating()) return 'Close';
    if (quitSent) return 'Closing Skyrim';
    if (quitArmed) return 'Press again to close Skyrim';
    return 'Close Skyrim';
  }

  function closeButton() {
    if (!creating()) { closeByHand(); return; }
    if (quitSent) return;
    var now = Date.now();
    if (quitArmed && now - quitArmed < QUIT_ARM_MS) {
      quitArmed = 0;
      quitSent = now;
      tell('quit');
      drawFoot();
      setTimeout(function () {
        if (!quitSent || Date.now() - quitSent < QUIT_BACK_MS) return;
        quitSent = 0;
        tell('quit did not take, the game is still here');
        drawFoot();
      }, QUIT_BACK_MS);
      return;
    }
    quitArmed = now;
    drawFoot();
    setTimeout(function () {
      if (!quitArmed || Date.now() - quitArmed < QUIT_ARM_MS) return;
      quitArmed = 0;
      drawFoot();
    }, QUIT_ARM_MS);
  }

  /*
    The server answered by rewriting the property. Each pick in flight is
    cleared by its own answer, the thing it asked for now set, and says so;
    a refusal clears the one its note is about (see refused). Confirm sends
    up to three at once and the server answers each with its own write, so
    the picks are read one at a time: a refused class must not swallow the
    home's answer, and only the home's own answer ends creation. A pick
    nothing answers in thirty seconds is dropped, so the list cannot grow
    for ever.
  */
  var PENDING_MS = 30000;
  function answered(before, after) {
    if (!pending.length) return;
    var keep = [];
    var now = Date.now();
    var known = knownOf(after);
    var cleared = false;
    pending.forEach(function (p) {
      var done = true;
      if (p.section === 'class' && after['class'] && !(before && before['class'])) { status = nameOf('class', after['class']) + ' it is.'; statusKind = 'ok'; later['class'] = false; }
      else if (p.section === 'profession' && after.profession && !(before && before.profession)) { status = 'You are a ' + nameOf('profession', after.profession).toLowerCase() + ' now.'; statusKind = 'ok'; later.profession = false; }
      else if (p.section === 'home' && after.home && !(before && before.home)) {
        status = cap(after.home) + '. See you there.'; statusKind = 'ok';
        // The home is the pick that ends creation, so the panel goes now, on
        // the answer. It used to wait for the server's creating flag, which
        // is written after the move and reached the page halfway through the
        // loading screen, with the panel still up over it.
        if (creating() && !closing) { later = {}; closing = true; setTimeout(leave, 700); }
      }
      else if (p.section === 'spells' && p.spell && known[p.spell] && !knownOf(before)[p.spell]) {
        // The server granted it. The mark has done its work and goes, and the
        // spell now reads as yours because the server says so.
        status = p.spell + ' is yours.'; statusKind = 'ok';
        marked[p.spell] = false;
        cleared = true;
      }
      else if (p.section === 'staff' && p.spell && staffUnlockedIn(after, p.spell) && !staffUnlockedIn(before, p.spell)) {
        // The server unlocked it: the mark goes, and it reads as unlocked
        // because the server says so.
        status = staffNameOf(p.spell) + ' is unlocked for staves.'; statusKind = 'ok';
        markedStaff[p.spell] = false;
        cleared = true;
      }
      else if (p.section === 'tree') { status = 'Spent.'; statusKind = 'ok'; }
      else if (p.section === 'perk' && perkRunning('fontofmagic')) { status = 'Font of Magic: for 15 seconds, a spell costs nothing.'; statusKind = 'ok'; }
      else if (p.section === 'weave' && after.weave && after.weave !== (before && before.weave)) {
        status = after.weave === 'armour' ? 'The garments you make now carry hidden armour.' : 'The garments you make now keep the weather off.';
        statusKind = 'ok';
      }
      else done = false;
      if (done) picked[p.section] = null;
      else if (now - p.at < PENDING_MS) keep.push(p);
    });
    pending = keep;
    // A granted spell can hold up a marked one above it; tidyMarks sees that
    // it does not, because a granted spell counts for the rank below.
    if (cleared) { tidyMarks(); tidyStaff(); }
  }
  /* Is that staff spell desc unlocked in a view the server sent. */
  function staffUnlockedIn(view, desc) {
    var got = view && view.staff;
    return !!(got && Array.isArray(got.mine) && got.mine.indexOf(desc) >= 0);
  }

  /*
    A refusal, and which pick it answers.

    The server writes one note per refused pick and says in note.about which
    pick that was: class, profession, spell, town or spend, per the contract
    at the head of this file. The panel clears that pick and only that one.
    It used to shift the oldest pick in flight whatever the note was about,
    so a refused spell ate the profession's answer and the profession sat in
    the list until it timed out.

    A note with no about at all is still shown, and then the oldest pick is
    the one it is taken for, which is the best a panel can do without being
    told. A note about something this page has no word for clears nothing:
    the words are still shown, and whatever was really refused leaves the
    list on PENDING_MS. The card stays as it was picked either way, so it can
    be sent again or replaced.
  */
  var ABOUT_SECTION = { 'class': 'class', 'profession': 'profession', 'spell': 'spells', 'staffspell': 'staff', 'town': 'home', 'spend': 'tree', 'perk': 'perk', 'weave': 'weave' };
  function refused(text, about) {
    status = 'No: ' + text + '.'; statusKind = 'no';
    if (!pending.length) return;
    if (about) {
      var sec = ABOUT_SECTION[String(about)];
      if (!sec) return;
      for (var i = 0; i < pending.length; i++) {
        if (pending[i].section === sec) { pending.splice(i, 1); return; }
      }
      return;
    }
    pending.shift();
  }

  // ---------------------------------------------------------------- keys --
  /*
    Arrow keys and Enter, because the mouse is not always where somebody left
    it and the panel is a list. Escape closes. Everything else is left alone:
    this page is shared with the chat, and swallowing keys it does not own is
    how the chat box lost the keyboard before.
  */
  function onKey(e) {
    if (root.className === 'gone') return;
    // A number being typed into the Office page's rent (#1638) is the box's,
    // Enter and the arrows included. Escape still closes.
    if (e.target && e.target.tagName === 'INPUT' && e.key !== 'Escape') return;
    var n = countRows();
    if (e.key === 'Escape') { closeByHand(); e.preventDefault(); return; }
    /*
      K closes it too, as the K on the Close button says (#1919). The
      front's K branch, which toggles the panel, waits for a buttonEvent that
      does not come while the panel holds the keyboard, so K did nothing
      here: the same fault as J on the journal (#530) and G on the wheel
      (#1852). K is SkillsKey as bound, handed over with setKey. Not in the
      rent box (above), not a repeat, and not with Ctrl, Alt or the Windows
      key held. While creating it puts the panel down the way Escape does.

      The tap of K that opens the panel cannot also close it: the fork reads
      the keyboard for this page in the same call that hands the game K
      going down, or an earlier one, so by the time the front hears K and the
      panel takes the keyboard, K is already down there and this page hears
      at most K coming up (the note over LETTERS in
      game/plugins/thornswood-emotes.js has the code path).
    */
    if (keyName && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey &&
        String(e.key || '').toUpperCase() === keyName.toUpperCase()) {
      closeByHand(); e.preventDefault(); return;
    }
    if (e.key === 'Enter') {
      if (section === 'tree') {
        var flat = [];
        rows().forEach(function (a) { (a.subs || []).forEach(function (s) { flat.push(s.key); }); });
        if (flat[rowAt]) spend(flat[rowAt]);
      } else if (section === 'spells') {
        // Enter marks the lit spell, the way Enter puts a point in the lit
        // skill, and it keeps doing that however many are marked. Learn is a
        // press of its own: a book is marked several times before it is sent,
        // so an Enter that sent the moment one spell was marked would take
        // the keyboard away from the second.
        var sr = bookRows()[rowAt];
        if (sr) { toggleMark(sr.school, sr.rank, sr.name); draw(); }
      } else if (section === 'staff') {
        // Enter marks the lit staff spell; Unlock is a press of its own.
        var fr = staffRows()[rowAt];
        if (fr) { toggleStaff(fr.desc, fr.rank, fr.name); draw(); }
      } else if (canConfirm()) { confirm(); }
      else {
        // Enter on a row picks it. While creating that is the choice, and
        // Enter in Review is Begin; in the world the second Enter confirms.
        var r = section === 'home' ? ((mine && mine.towns) || [])[rowAt] : rows()[rowAt];
        var pp = picked.profession;
        if (!r && rowAt === rows().length && laterOffered(section)) { chooseLater(section); draw(); }
        else if (r && section === 'class' && !haveClass()) { choose('class', r.key, []); draw(); }
        else if (r && section === 'home' && !haveHome()) { choose('home', r.key, []); draw(); }
        else if (r && section === 'profession' && creating() && !haveProf() && !(pp && pp.row === r.key)) { choose('profession', r.key, []); draw(); }
      }
      e.preventDefault(); return;
    }
    if (e.key === 'ArrowDown') { rowAt = n ? (rowAt + 1) % n : 0; draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { rowAt = n ? (rowAt + n - 1) % n : 0; draw(); e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      var i = sections.indexOf(section);
      goTo(sections[(i + (e.key === 'ArrowRight' ? 1 : sections.length - 1)) % sections.length]);
      draw(); e.preventDefault();
    }
  }
  window.addEventListener('keydown', onKey, true);
  elConfirm.onclick = confirm;
  elClose.onclick = function () { closeButton(); };
  // The help opens first, so the keyboard is never let go between the two.
  elHelp.onclick = function () {
    if (creating()) return;
    try { if (window.thornswoodHelp) { window.thornswoodHelp.open('work'); } } catch (e) { }
    api.close();
  };
  // The panel goes down so the wait's lines are seen; nothing is decided here.
  elSwitch.onclick = function () {
    if (creating()) return;
    tell('switch');
    api.close();
  };
  elSettings.onclick = function () {
    if (creating()) return;
    try { if (window.thornswoodSettings) { window.thornswoodSettings.open(); } } catch (e) { }
    api.close();
  };

  // ---------------------------------------------------------------- api --
  var api = {
    open: function () {
      if (root.className !== 'gone') return;
      root.className = '';
      fit();
      draw();
      tell('opened');
      tell('refresh');   // the server says again what this character is
    },
    close: function () {
      if (root.className === 'gone') return;
      root.className = 'gone';
      quitArmed = 0;   // a panel put down with Close Skyrim armed comes back unarmed
      candidate = null;   // the person the look prompt opened it on is that moment's, not the next
      dyeTarget = null;   // and the same for Hair dye's (#2675)
      endArmed = null;
      guideAt = '';       // the guides open on your own profession again next time (#3165)
      tell('closed');
    },
    toggle: function () {
      if (root.className === 'gone') { api.open(); } else { closeByHand(); }
    },
    isOpen: function () { return root.className !== 'gone'; },
    /*
      SkillsKey's name, handed over by the front when this page says it is
      ready. A key the front has no name for (#57, say) is not one this page
      can hear, so Escape and Close are the way out then, and the Close
      button shows no key.
    */
    setKey: function (name) {
      var k = String(name == null ? '' : name);
      keyName = k.charAt(0) === '#' ? '' : k;
      drawFoot();
    },
    /*
      The look prompt's K on somebody a Master could take on (#1634): the
      front hands over the form id under the crosshair, the name, and the
      halves the server's near list says could be meant, and the panel opens
      on Masters and apprentices with a Take on for each. Never while
      creating.
    */
    takeOn: function (who) {
      if (creating() || !who || typeof who !== 'object') return;
      var halves = (Array.isArray(who.halves) ? who.halves : []).filter(function (h) {
        return h && typeof h.h === 'string' && /^[a-z]+$/.test(h.h);
      }).map(function (h) { return { h: h.h, k: h.k === 'sister' ? 'sister' : 'outside' }; });
      var id = String(who.id || '');
      if (!/^[0-9a-f]+$/i.test(id) || !halves.length) return;
      candidate = { id: id, name: String(who.name || 'Somebody'), halves: halves };
      endArmed = null;
      goTo('apprentice');
      if (root.className === 'gone') api.open(); else draw();
    },
    /*
      The look prompt's K on somebody while you carry a hair dye (#2675): the
      front hands over the form id under the crosshair and the name, and the
      panel opens on Hair dye with an Offer to dye on each dye. Never while
      creating, and never when you carry none.
    */
    dyeFor: function (who) {
      if (creating() || !who || typeof who !== 'object' || !dyeList().length) return;
      var id = String(who.id || '');
      if (!/^[0-9a-f]+$/i.test(id)) return;
      dyeTarget = { id: id, name: String(who.name || 'Somebody') };
      goTo('hairdye');
      if (root.className === 'gone') api.open(); else draw();
    },
    /*
      What the server sent. The property carries the whole stored state with
      the view for this panel nested under .panel; the first cut read the top
      level and so never saw its own class or profession. A table, if one ever
      comes, replaces the one here wholesale.
    */
    setData: function (table, got) {
      if (table && typeof table === 'object') { DATA = table; if (!DATA.review) DATA.review = REVIEW; tableGen++; }
      if (got && typeof got === 'object') {
        var before = mine;
        mine = (got.panel && typeof got.panel === 'object') ? got.panel : got;
        answered(before, mine);
        apprAnswered();
        // A note is new when its time, its words or what it is about
        // changed: two refusals from one Confirm can carry the same
        // millisecond, and two picks can be refused in the same words.
        var nn = mine.note, bn = before && before.note;
        if (nn && nn.text && (!bn || bn.at !== nn.at || bn.text !== nn.text || bn.about !== nn.about)) refused(nn.text, nn.about);
        // Creation just ended: the home was confirmed and the server moved
        // you. The panel keeps what it shows, says so, and shuts itself; the
        // marks for later are cleared, since in the world there is no later.
        if (wasCreating && !mine.creating && !closing) {
          status = 'Off you go.'; statusKind = 'ok';
          closing = true;
          setTimeout(leave, 700);
        }
        wasCreating = !!mine.creating;
      }
      if (root.className !== 'gone') {
        if (closing) { drawFoot(); } else { draw(); }
      }
    }
  };

  window.thornswoodSkills = api;
  draw();
  tell('ready');
})();
