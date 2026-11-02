// ==== thornswood trade carts ====
/*
  TRADE CARTS ON THE SERVER (#3158), ON UNLESS SWITCHED OFF.

  Patrick, 22 Oct 2026 (docs/DECIDED.md): people drive the carts that move
  goods between holds, and a shipment is lost only when people raid it, never
  by chance. game\trade-carts.js is the stop, the road and the raid, and the
  manifest is game\trade-cargo.js created driven; both are bundled into this
  file by scripts\dev\Build-TradeCargoGamemode.js, and docs/systems/carts.md
  is the page.

  THE REGISTER is private\trade-carts.json, the ships' shape in its own file
  (the stops and roads in force with the manifest of carts), for the same
  reason as theirs: it names characters, and the data folder is served to
  anybody (#541). No file is a world with no cart stops. A file that is there
  and does not verify is refused whole and nothing is written over it.

  THE SWITCH. "thornswoodTradeCarts": false in server-settings.json switches
  the carts off. On is the default, unlike the ships, because a cart needs
  nothing but a stop staff set (a ship's hold waits on the Trading Company's
  charter, #512): with no stop on the list nobody meets a cart. Off, the
  register is still read, let go of deleted characters and counted, as the
  ships' is.

  THE RELEASE (#2351, #2668). The part 'carts', asked for as this block loads:
  a deleted, reset, wiped or replaced character comes off every line, hand
  out and journey, and every piece stays where it was.

  THE HANDS. What goes between a pack and a manifest is the ships block's
  (__thornswoodCargoHands, above), so a cart takes, gives and names goods the
  way a ship does and there is one copy of it.
*/
