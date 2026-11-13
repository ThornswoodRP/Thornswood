# Contracts

Issue #4561. Two people write a contract with each other, a supply deal or
hiring a guard or an escort, both sign it, and the signed copy is kept.
Nothing enforces the terms; people do. Terms are goods, coin or service,
as the two of them agree, written in their own words. Who can read a
signed contract was decided on 22 Oct: the people who signed it, and staff.

## How it works

- **Writing one.** Look at the person the contract is with and press K.
  The look prompt says "Write a contract". K opens on Contracts with a box
  for the terms and one button, Sign and give. You sign it as you give it,
  and you have to stand within about 10 metres of them, as you would to
  hand over a letter. A contract holds up to 1000 characters.
- **When K does something else.** A Master looking at somebody they could
  take on gets Take on as apprentice on K, and somebody carrying a hair dye
  gets Dye their hair. Either way Contracts is still in the K panel's list.
- **Signing or refusing.** The person it is written to is told in the chat,
  and the contract waits under Contracts on K with Sign and Refuse. They can
  answer from anywhere. While it waits, looking at the writer shows "Read
  their contract" on K. A refused contract is gone, and is never kept.
- **Taking one back.** The writer can take back a contract nobody has
  signed yet, from the same page. Five can wait at once from one writer.
- **What signing does.** It keeps the contract with both names, the words,
  and when each of you signed. Nothing else happens: no gold or goods move,
  and there is no fee.
- **Who reads it.** The two people who signed, under Contracts on K. Staff
  see every signed contract on the same page, under the ones they are in.
  Nobody else is ever sent one.

## Where this is

- The contracts block of `game/gamemode.js`, from
  `game/gamemode/contracts.ts`. After changing it, run
  `node scripts/dev/Build-Gamemode.js`.
- The ledger: `contracts.json` in the server's private folder, written
  whole on every change. A file that does not read is set aside, never
  written over.
- The K page: `game/ui/thornswood-skills.js`. The look prompt's K:
  `game/plugins/thornswood-front.js`. Which person has a contract waiting
  for you: the near list in the social block.
- Checked by `tests/test-4561-contracts.js`.
- Every change writes one `[contracts]` line in the server log: who wrote,
  signed, refused or took back which contract, and with whom. The words
  are never in the log.
- Not checked in game yet.
