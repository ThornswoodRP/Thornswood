// ==== thornswood trade ships ====
/*
  TRADE SHIPS ON THE SERVER (#511), SWITCHED OFF BY DEFAULT.

  The manifest is game\trade-cargo.js, bundled just below so the one file the
  server loads carries it (scripts\dev\Build-TradeCargoGamemode.js writes the
  bundle; tests\test-511-trade-cargo.js fails when it is stale). This block is
  the server's side of it: the register on disk, the release of deleted
  characters, the line the load says and, with the switch on, the dock, the
  staff panel and the clock (#2700, game\trade-ship-dock.js, bundled below
  it). Nothing is placed in the world: a port's dock is a crate already in it.

  THE REGISTER is private\trade-cargo.json, beside the other registers that
  name characters, because the data folder is served to anybody (#541). It
  keeps the staff list of ports, routes and crews in force with the manifest,
  in one file, so the two are always written together (trade-cargo.js, THE
  REGISTER). No file is a world with no ships. A file that is there and does
  not verify is refused whole: the ships hold nothing at this start, nothing
  is written over it, and the log says so, because writing would throw away
  every piece aboard.

  Every change is written before it is made, as the embassy's rolls are: the
  next register goes to disk and only then becomes the register, so what the
  server holds is what a restart reads, and a write that fails changes
  nothing.

  THE SWITCH. "thornswoodTradeShips": true in server-settings.json switches
  the ships on: this block then puts the register's handle on globalThis as
  __thornswoodTradeShips, which mp.onActivate asks about a pressed crate and
  the word /ship from the panel reaches. Off, which is every
  server today, the register is still read, still let go of deleted
  characters and still counted in the log, so a list of deleted characters
  never waits on a switch and staff can see what is aboard before turning
  anything on; but there is no handle, so nothing can load, sail or hand out.

  THE RELEASE (#2351, #2668). As this block loads it asks for the part
  'cargo' through __thornswoodRelease, before anything else acts on the
  register. A deleted, reset, wiped or replaced character comes off every
  line and hand out by form id, or by profile when Delete-Person names the
  profile; every piece stays where it was (trade-cargo.js, release). The log
  says counts only, never a name, a profile id or a form id.
*/
