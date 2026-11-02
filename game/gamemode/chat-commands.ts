// ==== thornswood chat commands ====
/*
  EVERY WORD THIS SERVER ANSWERS, WRITTEN DOWN ONCE.

  There were three copies of this list on 21 September and all three were
  wrong in different ways: /help named five words, the unknown-command reply
  named the same five, and the startup line named ten. The server answered
  fifteen. Somebody setting out to test the property system had no way to
  discover /deed, /lock, /unlock, /mold or /key from any of the three.

  A list in three places is a list that is wrong in two of them, so it is here
  and the three readers all read it. WORDS is what the server answers; PLAYER is
  the subset a person who is not a playtester is told about, because /restart,
  /tp and the rest are theirs and saying so to everybody is an invitation.
*/
/*
  Checked against the file rather than remembered: every word a router here
  compares against, and nothing else. /roll is deliberately NOT in it. help
  mentions /roll and this server has never answered it, because it is handled in
  front of this in the chat itself, and putting it in a list called 'what the
  server answers' would make that list wrong in the one place somebody would go
  to check.
*/
const WORDS = ['/ooc', '/o',
               // A dev's and a tester's tool: the cell, the position and the
               // angle you stand at. Answered for them alone, the way /tp is,
               // and not in PLAYER_WORDS (#1633).
               '/where',
               // The help is a panel, on its own key and on Help on the K, P
               // and J panels (#1633). Typed out of habit, these two answer
               // where it is (helpLine), and nothing tells anybody to type them.
               '/help', '/commands',
               // Asking staff for help and reporting somebody; see the asking
               // staff block at the end of this file.
               '/helpme', '/help-me', '/report',
               // Report a problem on the help panel (#3155): the button's
               // line, never typed and not in PLAYER_WORDS. It goes on the
               // board through the site and the bot; see the asking staff block.
               '/problem',
               // Out of a wedged spot; see the stuck block after it.
               '/stuck',
               // The four needs bars said as one line of text, for somebody
               // who hid the bars on Settings in the game (#2267). Patrick's
               // exception to "buttons, not commands", 11 Oct: it is another
               // view of what the bars and the Body page on K already show.
               // /need is the same word. See the /needs branch of handle().
               '/needs', '/need',
               // A carriage or ferry (#1394). E on a driver sends /ride e <id>,
               // and the ride panel's buttons send /ride and the stop (#1635).
               // Never typed, and so deliberately NOT in PLAYER_WORDS. See the
               // carriages block.
               '/ride',
               // The embassy roll and the Thalmor remnant roll, written by an
               // admin (#1390). See the embassy and remnant block.
               '/embassy', '/remnant',
               '/pick', '/spend',
               // A warrior's maneuver, sent by the panel the maneuver key
               // opens (#1386). Never typed, and no help names it: Patrick,
               // 4 October, no chat commands for anything people do. See the
               // maneuvers block.
               '/maneuver',
               // A Master taking somebody on, and either of them ending it
               // (#1388). Sent by the look prompt and the K panel (#1634),
               // never typed, and so deliberately NOT in PLAYER_WORDS. See
               // the character block.
               '/apprentice',
               '/plant', '/claim', '/plot',
               // At a door, /claim, /lock and /unlock are what the lock key
               // sends, and /key is the same key at a forge (#1637). /deed and
               // /mold are still answered, and no help names any of them:
               // what you hold is on K, and the mold key presses a mold.
               '/deed', '/deeds', '/lock', '/unlock', '/mold', '/key',
               // The offices' powers (#1638). Sent by the Office page of the
               // K panel, never typed, and so deliberately NOT in
               // PLAYER_WORDS: Patrick, 4 October, no chat commands for
               // anything people do, and a Jarl and a steward are people.
               '/evict', '/rent',
               // A Jarl gives or takes their hold's Court, Steward and Guard
               // (#2551): Name and Remove on the Office page send it, never
               // typed. It replaced /jarl, /steward and /guard.
               '/office',
               // The hold's drop box on the board (#2298). E on the box sends
               // /dropbox open, and its panel's buttons send the rest; never
               // typed, so NOT in PLAYER_WORDS.
               '/dropbox',
               // The notice board (#1627). Sent by the board panel's buttons
               // and J's Boards tab, never typed, and so NOT in PLAYER_WORDS:
               // Patrick, 4 October, nothing people do is a chat command. A
               // steward's /board move and /board here are #1638's. Make a
               // post sends /notice and /job with a title and a body, and Pay
               // the reward sends /job done (#2554).
               '/notice', '/job', '/board', '/take', '/dropjob', '/unpin',
               // A letter (#1595): Write a letter on the board panel sends
               // /letter, and the look prompt's Hand over the letter sends
               // /deliver. Never typed, and not in PLAYER_WORDS either.
               '/letter', '/deliver',
               // The company's terms card on the Office page of K, for staff
               // (#512, #2695): propose, confirm and drop. Sent by the page,
               // never typed, and so NOT in PLAYER_WORDS.
               '/companyterms',
               // A haul (#1393). Sent by the board panel's Send a haul and
               // Confirm buttons, never typed, and so deliberately NOT in
               // PLAYER_WORDS. See the property block.
               '/haul',
               // The world's card on the Office page of K, for staff (#513):
               // propose, confirm and drop a move of the world stage. Sent by
               // the page, never typed, and so NOT in PLAYER_WORDS.
               '/world',
               '/tp', '/goto', '/face', '/restart', '/shutdown', '/tspicks',
               // A property door's lock opening on the client, a pick (#2680):
               // the front plugin's, never typed.
               '/tspicked',
               // Playtesters', like /tp, and gated the same way. Deliberately
               // absent from PLAYER_WORDS: naming them in /help would be an
               // invitation, and the gate answers everybody else anyway.
               '/give', '/spawn',
               // Staff's, gated on the staff roles and left out of
               // PLAYER_WORDS for the same reason. See the staff block.
               '/kick', '/freeze', '/unfreeze', '/bring', '/silence',
               '/unsilence', '/warn', '/spawnat', '/ban', '/unban', '/note',
               // One character or the whole account, and a character killed
               // for good (#1010).
               '/banaccount', '/unbanaccount', '/pk',
               // An admin undoing a PK made by mistake (#1010, 29 September).
               '/unpk',
               // A wound, a disease or an agreed loss written onto somebody
               // by staff (#1383). See the injury and disease block.
               '/hurt',
               // A creature a spawn command made, taken out for good by
               // staff, kept or not (#2623). See the staff block.
               '/despawn',
               // The crafting card on the Office page of K, for staff
               // (#3167): pick somebody, raise a rank, check a recipe, give
               // back. Sent by the page, never typed. See the staff crafting
               // block, after the staff block.
               '/craftstaff',
               /*
                 NOT A COMMAND ANYBODY TYPES. The client reports each fall of
                 the axe with it, because the server sees a press and Skyrim's
                 furniture does the swinging. It is registered here so the
                 dispatcher answers it rather than saying "unknown command",
                 and it is deliberately NOT in PLAYER_WORDS: naming it in /help
                 would be inviting people to type it, and choppedSwing is what
                 makes typing it worth nothing.
               */
               '/chopped',
               // Hunger, thirst and exhaustion. See the needs block at the end
               // of this file; the numbers there are invented and meant to be
               // argued with. /rest is the plugin's, sent when somebody sits
               // or lies down, and never typed (#1603); see bedRest. Not
               // /eat, /drink or /bard (#1631): eating and drinking is the
               // item (mp.onEatItem), and the bard is somebody the server
               // sees playing (bardSeen). /needs is back as a line of text
               // (#2267), above.
               '/rest',
               // The repair panel (#1384): sent by the inventory key and by
               // the panel's buttons, never typed. See the durability block,
               // after the take limit. Deliberately absent from PLAYER_WORDS:
               // nothing people do is a command (Patrick, 4 October).
               '/repair',
               // The preserving panel (#3163): sent by the inventory key and
               // the panel's buttons, never typed, and so deliberately NOT in
               // PLAYER_WORDS. See the spoilage block, after the durability
               // block.
               '/preserve',
               // The treatment panel (#1383): sent by the inventory key, the
               // look prompt's key and the panel's buttons, never typed, and
               // so deliberately NOT in PLAYER_WORDS. See the injury and
               // disease block.
               '/treat',
               // Furniture in a held building (#2679): sent by the inventory
               // key, the crosshair keys and the furniture panel, never typed,
               // and so deliberately NOT in PLAYER_WORDS. See the furniture
               // block, after the durability block.
               '/furniture',
               // Hair dye (#2675): the Hair dye page of K and Dye hair under
               // Near you on P send it, never typed, and so NOT in
               // PLAYER_WORDS. See the hair dye block.
               '/hairdye',
               // The client's weather report and its "I am on fire". Never typed; see
               // the branches.
               '/place', '/burn',
               // The client saying its race menu is still up. Never typed; see
               // FACE_SEEN_MS.
               '/racemenu',
               // The client saying the race menu went down with the game, not
               // as a finished face. Never typed; see faceDown.
               '/racedown',
               // A mod settings menu changed on this client. Never typed;
               // see the mod settings block at the end of this file.
               '/modset',
               // The mold key: a blank pressed into the door under the
               // crosshair. Sent by the plugin, not typed; see moldHere.
               '/moldhere',
               // A holder letting the person under the crosshair sleep there,
               // or the property page ending a guest's night (#1603). Sent by
               // the plugin and the K panel, never typed; see sleepHere.
               '/sleephere',
               // The client's load order, every two minutes. Sent by the front
               // plugin, never typed; see the load order refusal block.
               // Its light plugins too, as /loadorderlight (#1715).
               '/loadorder', '/loadorderlight',
               // Friends, parties, mutes, trade and journals. See the
               // social block at the end of this file. /journal and /book
               // are the J panel's lines, never typed (#1630). /hidename too,
               // which the P panel's Name buttons send and which was missing
               // here, so it ran before the character was in the world (#1628).
               '/friend', '/party', '/mute', '/hidename', '/trade', '/journal', '/book', '/merchant',
               // The trade ships' panel, at a dock crate or on the Office page
               // for staff (#2700). Never typed, so not in PLAYER_WORDS.
               '/ship',
               // A market stall's panel (#3160): the lock key at a stall sends
               // /stall open, and the panel's buttons send the rest. Never
               // typed, so not in PLAYER_WORDS.
               '/stall',
               // The trade carts' panel, at a cart stop's crate, from Raid
               // cart on P, or on the Office page for staff (#3158). Never typed.
               '/cart',
               '/yes', '/no',
               // The dice. Rolled here now rather than on the roller's own
               // machine; see the branch for why that matters.
               '/roll', '/r'];

/*
  The ones a person who is not a playtester is told about. /tp, /goto, /face,
  /restart, /shutdown and /tspicks are theirs, and naming them to everybody is
  an invitation rather than a help.

  Since #1633, exactly the commands people still type, and nothing else:
  /stuck and the lines that reach staff, /helpme and /report (Patrick,
  4 October, #1682), and the ways of saying a line, /me, /do, /w, /s, /y and
  /ooc, with /roll (#1639), and /needs, the needs bars as a line of text
  for somebody who hid them (Patrick, 11 October, #2267). Everything else
  anybody does is a key, a prompt or a panel, and the help panel names
  those. /me, /do, /w, /s and /y are said by the voice service and never
  reach this server, so they are named here and are not in WORDS. /need is
  /needs and is not named twice. docs/systems/commands.md has the same list.
*/
// Not /plot, /plant or /claim: a farm is worked and claimed at the plot, and
// a building at its door, with the line under the crosshair (#1636, #1637).
// Not /office, /evict or /rent: the offices' powers are buttons
// on the Office page of K (#1638), and the board panel says what the hold
// has been paid. Not /rest: sitting or lying down is how you rest (#1603). Not /eat,
// /drink or /bard (#1631): eating or drinking the item is the meal, and
// playing an instrument or Sing on the emote wheel is the bard. Not /party: P on somebody asks and
// the P panel runs the party (#1629). Not /journal or /book: J sends those
// lines (#1630). Not /friend, /mute, /hidename, /trade, /yes and /no: Y, H and
// L on the look prompt, the P panel, the trade window and the prompt's Accept
// and Refuse send them (#1628). Not /merchant: E on a trader opens its panel.
// Not /help: the help is a panel (#1633). Not /where: a dev's and a tester's
// tool, answered for them alone (#1633).
// /stuck, /helpme and /report are the one thing a person in trouble must be
// able to find (#414).
const PLAYER_WORDS = ['/stuck', '/helpme', '/report',
                      '/me', '/do', '/w', '/s', '/y', '/ooc', '/roll', '/needs'];

