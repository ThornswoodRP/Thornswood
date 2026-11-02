// ==== thornswood market stalls ====
/*
  MARKET STALLS (#3160). Patrick, 22 Oct 2026, on his report page: stalls
  are fixed market stalls, claimed like property, and a stall sells only
  while its keeper is there ("No this is an RP server"). The rule in prose is
  docs/systems/stalls.md.

  The book is game/market-stalls.js, bundled just below as MARKET_STALLS_BOOK
  (scripts/dev/Build-MarketStallsGamemode.js writes it, and the stall table
  after it; tests/test-3160-market-stalls.js fails when either is stale).
  This block is the world's side of it: the register on disk, the packs and
  purses a sale moves, who stands where, the panel, and the hold's drop box
  that takes what was on a stall whose keeping ended.

  WHERE A STALL IS. MARKET_STALL_TABLE, out of game/data/market-stalls.json,
  which scripts/dev/Build-MarketStalls.py builds from the plugins: one row a
  stall, the point in front of its counter and how far from it counts as at
  the stall. The front plugin carries the same rows (STALL_SPOTS) and puts
  the lock key's line up there, Market stall; the key sends /stall open and
  the stall's id, and this checks again that they are standing at it.

  THE REGISTER is private/market-stalls.json, beside the other registers that
  name characters, because the data folder is served to anybody (#541). Every
  change is written before it is made, the way the trade ships' manifest is:
  the next book goes to disk and only then becomes the book, so a write that
  fails changes nothing. A file that is there and does not read is refused
  whole: no stall can be claimed or sold from at this start, nothing is
  written over it, and the log says so.

  WHAT MOVES IN WHAT ORDER, so a failure never makes a piece or a coin:
    - laying out: the piece comes out of the keeper's pack, then the book is
      written; a book that will not write puts it back in the pack;
    - taking back and buying: the book is written first, then the packs; a
      pack that will not take it puts the line back on the book;
    - buying: the price comes out of the buyer's pack before the book is
      written, and goes back to them when the book will not write.
  The keeper's share goes into the keeper's own pack, because they are
  standing there: a stall sells only then.

  WHAT A KEEPER IS SHOWN, AND A BUYER. The keeper is never named on the
  panel: whoever stands at the stall is who sells there, and people see
  them. A buyer sees the wares, the prices and whether the keeper is here.

  THE RELEASE (#2351, #2668). As this block loads it asks for the part
  'stalls' through __thornswoodRelease: a deleted, reset or replaced
  character's stalls end and their goods go to the hold's drop box with no
  name on them, for its officers.
*/
