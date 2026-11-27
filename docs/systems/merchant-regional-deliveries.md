# Regional guild delivery parcels

This section adds 69 distinct parcels in the Rift, the Reach and Haafingar. With Whiterun, all 24 specialists in these four holds have work at every rank: 96 merchant/rank slots. At this incremental section the authored catalogue had 104 definitions covering 99/240 slots; the subsequent [remaining-hold section](merchant-all-hold-deliveries.md) completes 245 definitions and all 240 slots. Source activation and merges do not establish a Dev deployment.

The retained roster remains 60 specialists across ten holds, six trades per hold. No NPC, position, spawn, return rate, recipe, resource yield, purse grant or refill changes. Exact NPC bases and placements remain in the merchant roster and population documents. Prices are the sum of each required count times the guild's reward price, which staff set, paid as new gold (#6180, [Commission pay](merchant-quest-catalogue.md#commission-pay)). A missing reward price refuses acceptance; shelf stock remains visible. Original payment and 6/12/24/48-hour personal rest are retained in each accepted promise. A partial parcel moves nothing. Existing or traded goods qualify, and all recipe conditions stay in force.

Master professions require their named mastered half. Master classes require class standing without a half. Mage Master offers require the named mastered school plus at least one learned mapped Master spell in that school. Gates are not a claim that the customer personally produced every item. Tailor Master orders use six Expert production batches, with no invented Master clothing recipe or extra armor assets. Other Master parcels include an existing Master producer source; applicable recipe Master batches number at least two. Novice, Advanced and Expert parcels each include a source at their stated tier. Different titles or quantities alone never count as distinct work: every item set differs.

## the Rift

| Offering specialist and exact reference | Rank and requirement | Complete parcel | Existing source references | Personal rest |
| --- | --- | --- | --- | --- |
| Smith `19df1:Skyrim.esm` | novice, smith, platewright | 1 Fur Helmet (`6f39e:Skyrim.esm`); 1 Woodcutter's Axe (`2f2f4:Skyrim.esm`) | `849:MoreCraftableEquipment.esp`; `1548e:Thornswood-Content.esp` | 6 hours |
| Smith `19df1:Skyrim.esm` | advanced, smith, platewright | 2 Ancient Nord Armor (`18388:Skyrim.esm`); 1 Leather Bracers (`13921:Skyrim.esm`) | `f46cc:Skyrim.esm`; `dca03:Skyrim.esm` | 12 hours |
| Smith `19df1:Skyrim.esm` | expert, smith, platewright | 2 Elven Helmet (`1391d:Skyrim.esm`); 2 Fur Bracers (`6f39b:Skyrim.esm`) | `dc9fd:Skyrim.esm`; `848:MoreCraftableEquipment.esp` | 24 hours |
| Smith `19df1:Skyrim.esm` | master, smith, edgewright | 2 Stalhrim Battleaxe (`1cdb4:Dragonborn.esm`); 2 Woodcutter's Axe (`2f2f4:Skyrim.esm`) | `2b076:Dragonborn.esm`; `1548e:Thornswood-Content.esp` | 48 hours |
| Woodworker `19dd0:Skyrim.esm` | advanced, woodworker, woodwright | 2 Nordic Bow (`26232:Dragonborn.esm`); 1 Crude Fishing Pole (`15498:Thornswood-Content.esp`) | `2b07f:Dragonborn.esm`; `1549c:Thornswood-Content.esp` | 12 hours |
| Woodworker `19dd0:Skyrim.esm` | expert, woodworker, woodwright | 2 Fine Fishing Pole (`15499:Thornswood-Content.esp`); 2 Crude Fishing Pole (`15498:Thornswood-Content.esp`) | `1549d:Thornswood-Content.esp`; `1549c:Thornswood-Content.esp` | 24 hours |
| Woodworker `19dd0:Skyrim.esm` | master, fisher | 2 Master Fishing Pole (`1549a:Thornswood-Content.esp`); 2 Fine Fishing Pole (`15499:Thornswood-Content.esp`) | `1549e:Thornswood-Content.esp`; `1549d:Thornswood-Content.esp` | 48 hours |
| Tailor `31efc3:Riften Expansion.esp` | novice, tailor, haberdasher | 1 Fur-lined Boots (`5db7e:Skyrim.esm`); 1 Leather Cape (`2def:Cloaks&Capes.esp`) | `98a:MoreCraftableEquipment.esp`; `55bd:Cloaks&Capes.esp` | 6 hours |
| Tailor `31efc3:Riften Expansion.esp` | expert, tailor, haberdasher | 2 Fur Cloak (Brown) (`2884:Cloaks&Capes.esp`); 2 Fur Cloak (Black) (`2883:Cloaks&Capes.esp`) | `2e05:Cloaks&Capes.esp`; `2e04:Cloaks&Capes.esp` | 24 hours |
| Tailor `31efc3:Riften Expansion.esp` | master, tailor, haberdasher | 3 Fur Cloak (Snowy Sabre) (`2885:Cloaks&Capes.esp`); 3 Fur Cloak (Vale Sabre) (`2886:Cloaks&Capes.esp`) | `2e06:Cloaks&Capes.esp`; `2e07:Cloaks&Capes.esp` | 48 hours |
| Enchanter `19df0:Skyrim.esm` | novice, enchanter, wardweaver | 1 Leather Armor (`3619e:Skyrim.esm`); 1 Fur-Trimmed Cloak (`8698c:Skyrim.esm`) | `dca02:Skyrim.esm`; `985:MoreCraftableEquipment.esp` | 6 hours |
| Enchanter `19df0:Skyrim.esm` | advanced, enchanter, wardweaver | 2 Dawnguard Heavy Armor (`f3f7:Dawnguard.esm`); 1 Leather Bracers (`13921:Skyrim.esm`) | `861:MoreCraftableEquipment.esp`; `dca03:Skyrim.esm` | 12 hours |
| Enchanter `19df0:Skyrim.esm` | expert, enchanter, wardweaver | 2 Fur Cloak (White) (`1d8e:Cloaks&Capes.esp`); 2 Fur Helmet (`6f39e:Skyrim.esm`) | `2e03:Cloaks&Capes.esp`; `849:MoreCraftableEquipment.esp` | 24 hours |
| Enchanter `19df0:Skyrim.esm` | master, mage, illusion | 2 Ebony Helmet (`13963:Skyrim.esm`); 2 Fur Cloak (Snowy Sabre) (`2885:Cloaks&Capes.esp`) | `dd98b:Skyrim.esm`; `2e06:Cloaks&Capes.esp` | 48 hours |
| Cook `19e14:Skyrim.esm` | novice, cook, hearthcook | 1 Slaughterfish Steak (`64b3c:Skyrim.esm`); 1 Venison Stew (`f431d:Skyrim.esm`) | `8af:Gourmet.esp`; `f4317:Skyrim.esm` | 6 hours |
| Cook `19e14:Skyrim.esm` | advanced, cook, confectioner | 2 Juniper Berry Crostata (`3539:HearthFires.esm`); 1 Slaughterfish Steak (`64b3c:Skyrim.esm`) | `117fc:HearthFires.esm`; `8af:Gourmet.esp` | 12 hours |
| Cook `19e14:Skyrim.esm` | expert, cook, hearthcook | 2 Wild Mushroom Stew (`8f6:Gourmet.esp`); 2 Venison Stew (`f431d:Skyrim.esm`) | `8f9:Gourmet.esp`; `f4317:Skyrim.esm` | 24 hours |
| Cook `19e14:Skyrim.esm` | master, cook, confectioner | 2 Mammoth Stew (`818:Gourmet.esp`); 2 Juniper Berry Crostata (`3539:HearthFires.esm`) | `819:Gourmet.esp`; `117fc:HearthFires.esm` | 48 hours |
| Alchemist `19dfb:Skyrim.esm` | novice, alchemist, physicker | 3 Juniper Berries (`5076e:Skyrim.esm`); 3 Lavender (`45c28:Skyrim.esm`) | `bb948:Skyrim.esm`; `1bb3d:Skyrim.esm` | 6 hours |
| Alchemist `19dfb:Skyrim.esm` | advanced, alchemist, blightbrewer | 4 Mora Tapinella (`ec870:Skyrim.esm`); 4 Juniper Berries (`5076e:Skyrim.esm`) | `108ee2:Skyrim.esm`; `bb948:Skyrim.esm` | 12 hours |
| Alchemist `19dfb:Skyrim.esm` | expert, alchemist, physicker | 5 Elves Ear (`34d31:Skyrim.esm`); 5 Juniper Berries (`5076e:Skyrim.esm`) | `34d2d:Skyrim.esm`; `bb948:Skyrim.esm` | 24 hours |
| Alchemist `19dfb:Skyrim.esm` | master, alchemist, blightbrewer | 6 Ash Creep Cluster (`1cd74:Dragonborn.esm`); 6 Mora Tapinella (`ec870:Skyrim.esm`) | `195dc:Dragonborn.esm`; `108ee2:Skyrim.esm` | 48 hours |

## the Reach

| Offering specialist and exact reference | Rank and requirement | Complete parcel | Existing source references | Personal rest |
| --- | --- | --- | --- | --- |
| Smith `19906:Skyrim.esm` | novice, smith, edgewright | 1 Iron Mace (`13982:Skyrim.esm`); 1 Iron War Axe (`13790:Skyrim.esm`) | `da76b:Skyrim.esm`; `da76c:Skyrim.esm` | 6 hours |
| Smith `19906:Skyrim.esm` | advanced, smith, platewright | 2 Banded Iron Armor (`13948:Skyrim.esm`); 1 Corundum Ingot (`5ad93:Skyrim.esm`) | `dc9ff:Skyrim.esm`; `a30cb:Skyrim.esm` | 12 hours |
| Smith `19906:Skyrim.esm` | expert, smith, platewright | 2 Glass Shield (`1393c:Skyrim.esm`); 2 Iron Shield (`12eb6:Skyrim.esm`) | `dca12:Skyrim.esm`; `db293:Skyrim.esm` | 24 hours |
| Smith `19906:Skyrim.esm` | master, warrior, berserker | 2 Ebony Dagger (`139ae:Skyrim.esm`); 2 Steel War Axe (`13983:Skyrim.esm`) | `db8b9:Skyrim.esm`; `db897:Skyrim.esm` | 48 hours |
| Woodworker `198eb:Skyrim.esm` | novice, woodworker, woodwright | 24 Iron Arrow (`1397d:Skyrim.esm`); 1 Poor Charcoal (`15481:Thornswood-Content.esp`) | `b64f:Dawnguard.esm`; `15480:Thornswood-Content.esp` | 6 hours |
| Woodworker `198eb:Skyrim.esm` | advanced, woodworker, charburner | 2 Charcoal (`15482:Thornswood-Content.esp`); 24 Iron Arrow (`1397d:Skyrim.esm`) | `15486:Thornswood-Content.esp`; `b64f:Dawnguard.esm` | 12 hours |
| Woodworker `198eb:Skyrim.esm` | expert, woodworker, charburner | 2 Charcoal Briquette (`15484:Thornswood-Content.esp`); 20 Steel Bolt (`bb3:Dawnguard.esm`) | `15487:Thornswood-Content.esp`; `f813:Dawnguard.esm` | 24 hours |
| Woodworker `198eb:Skyrim.esm` | master, woodworker, charburner | 2 Coke (`15485:Thornswood-Content.esp`); 2 Charcoal Briquette (`15484:Thornswood-Content.esp`) | `15488:Thornswood-Content.esp`; `15487:Thornswood-Content.esp` | 48 hours |
| Tailor `198ea:Skyrim.esm` | novice, tailor, liverywright | 1 Psijic Boots (`65b9b:Skyrim.esm`); 1 Temple Priest Hood (`3b04e:Dragonborn.esm`) | `9b9:MoreCraftableEquipment.esp`; `965:MoreCraftableEquipment.esp` | 6 hours |
| Tailor `198ea:Skyrim.esm` | advanced, tailor, haberdasher | 2 Wedding Wreath (`8895a:Skyrim.esm`); 1 Greybeard's Boots (`824:MoreCraftableEquipment.esp`) | `9d1:MoreCraftableEquipment.esp`; `9c7:MoreCraftableEquipment.esp` | 12 hours |
| Tailor `198ea:Skyrim.esm` | expert, tailor, haberdasher | 2 Gilded Wristguards (`e84c1:Skyrim.esm`); 2 Red Cowl (`83d:MoreCraftableEquipment.esp`) | `988:MoreCraftableEquipment.esp`; `9a7:MoreCraftableEquipment.esp` | 24 hours |
| Tailor `198ea:Skyrim.esm` | master, tailor, liverywright | 3 Gilded Wristguards (`e84c1:Skyrim.esm`); 3 Fur Cloak (Snowy Sabre) (`2885:Cloaks&Capes.esp`) | `988:MoreCraftableEquipment.esp`; `2e06:Cloaks&Capes.esp` | 48 hours |
| Enchanter `19908:Skyrim.esm` | novice, enchanter, wardweaver | 1 Iron Boots (`12e4b:Skyrim.esm`); 1 Iron Armor (`12e49:Skyrim.esm`) | `db290:Skyrim.esm`; `db291:Skyrim.esm` | 6 hours |
| Enchanter `19908:Skyrim.esm` | advanced, enchanter, wardweaver | 2 Steel Plate Helmet (`1395e:Skyrim.esm`); 1 Iron Shield (`12eb6:Skyrim.esm`) | `dd981:Skyrim.esm`; `db293:Skyrim.esm` | 12 hours |
| Enchanter `19908:Skyrim.esm` | expert, enchanter, wardweaver | 2 Gilded Wristguards (`e84c1:Skyrim.esm`); 2 Steel Plate Helmet (`1395e:Skyrim.esm`) | `988:MoreCraftableEquipment.esp`; `dd981:Skyrim.esm` | 24 hours |
| Enchanter `19908:Skyrim.esm` | master, mage, destruction | 2 Nordic Carved Gauntlets (`1cd98:Dragonborn.esm`); 2 Steel Armor (`13952:Skyrim.esm`) | `2b068:Dragonborn.esm`; `dd975:Skyrim.esm` | 48 hours |
| Cook `1990a:Skyrim.esm` | novice, cook, hearthcook | 1 Beef Stew (`f4314:Skyrim.esm`); 1 Grilled Chicken Breast (`e8947:Skyrim.esm`) | `f4313:Skyrim.esm`; `f4308:Skyrim.esm` | 6 hours |
| Cook `1990a:Skyrim.esm` | advanced, cook, hearthcook | 2 Ash Yam Soup (`3cd5b:Dragonborn.esm`); 1 Boiled Creme Treat (`64b30:Skyrim.esm`) | `3cd5d:Dragonborn.esm`; `8a4:Gourmet.esp` | 12 hours |
| Cook `1990a:Skyrim.esm` | expert, cook, hearthcook | 2 Glowing Mushroom Stew (`8f7:Gourmet.esp`); 2 Roasted Wild Mushrooms (`902:Gourmet.esp`) | `8fa:Gourmet.esp`; `905:Gourmet.esp` | 24 hours |
| Cook `1990a:Skyrim.esm` | master, cook, hearthcook | 2 Mammoth Steak (`722bb:Skyrim.esm`); 2 Rabbit Haunch (`722c2:Skyrim.esm`) | `f430d:Skyrim.esm`; `f430f:Skyrim.esm` | 48 hours |
| Alchemist `198f7:Skyrim.esm` | novice, alchemist, physicker | 3 Imp Stool (`4da23:Skyrim.esm`); 3 Frost Mirriam (`34d32:Skyrim.esm`) | `4da08:Skyrim.esm`; `34d2c:Skyrim.esm` | 6 hours |
| Alchemist `198f7:Skyrim.esm` | advanced, alchemist, blightbrewer | 4 Scaly Pholiota (`6f950:Skyrim.esm`); 4 White Cap (`4da22:Skyrim.esm`) | `6f94d:Skyrim.esm`; `4da06:Skyrim.esm` | 12 hours |
| Alchemist `198f7:Skyrim.esm` | expert, alchemist, physicker | 5 Nightshade (`2f44c:Skyrim.esm`); 5 Bleeding Crown (`4da20:Skyrim.esm`) | `c43b0:Skyrim.esm`; `4da04:Skyrim.esm` | 24 hours |
| Alchemist `198f7:Skyrim.esm` | master, alchemist, physicker | 6 Ash Creep Cluster (`1cd74:Dragonborn.esm`); 2 Poultice (`154c2:Thornswood-Content.esp`) | `195dc:Dragonborn.esm`; `154c6:Thornswood-Content.esp` | 48 hours |

## Haafingar

| Offering specialist and exact reference | Rank and requirement | Complete parcel | Existing source references | Personal rest |
| --- | --- | --- | --- | --- |
| Smith `198d8:Skyrim.esm` | novice, smith, platewright | 1 Stormcloak Cuirass (`a6d7b:Skyrim.esm`); 1 Stormcloak Helmet (`a6d79:Skyrim.esm`) | `8d9:MoreCraftableEquipment.esp`; `8db:MoreCraftableEquipment.esp` | 6 hours |
| Smith `198d8:Skyrim.esm` | advanced, smith, platewright | 2 Dawnguard Boots (`f400:Dawnguard.esm`); 1 Stormcloak Cuirass (`a6d7b:Skyrim.esm`) | `860:MoreCraftableEquipment.esp`; `8d9:MoreCraftableEquipment.esp` | 12 hours |
| Smith `198d8:Skyrim.esm` | expert, smith, platewright | 2 Glass Shield (`1393c:Skyrim.esm`); 2 Glass Warhammer (`139aa:Skyrim.esm`) | `dca12:Skyrim.esm`; `db8b7:Skyrim.esm` | 24 hours |
| Smith `198d8:Skyrim.esm` | master, smith, platewright | 2 Stalhrim Light Helmet (`1cda3:Dragonborn.esm`); 2 Glass Gauntlets (`1393a:Skyrim.esm`) | `2b06e:Dragonborn.esm`; `dca10:Skyrim.esm` | 48 hours |
| Woodworker `198b1:Skyrim.esm` | novice, woodworker, woodwright | 1 Fish Trap (`1549b:Thornswood-Content.esp`); 1 Splint (`154c1:Thornswood-Content.esp`) | `1549f:Thornswood-Content.esp`; `154c5:Thornswood-Content.esp` | 6 hours |
| Woodworker `198b1:Skyrim.esm` | advanced, woodworker, woodwright | 48 Orcish Arrow (`139bb:Skyrim.esm`); 1 Crude Fishing Pole (`15498:Thornswood-Content.esp`) | `b654:Dawnguard.esm`; `1549c:Thornswood-Content.esp` | 12 hours |
| Woodworker `198b1:Skyrim.esm` | expert, woodworker, woodwright | 2 Glass Bow (`139a5:Skyrim.esm`); 48 Glass Arrow (`139be:Skyrim.esm`) | `108cfb:Skyrim.esm`; `b653:Dawnguard.esm` | 24 hours |
| Woodworker `198b1:Skyrim.esm` | master, woodworker, woodwright | 2 Ebony Bow (`139ad:Skyrim.esm`); 2 Glass Bow (`139a5:Skyrim.esm`) | `108cf9:Skyrim.esm`; `108cfb:Skyrim.esm` | 48 hours |
| Tailor `198ac:Skyrim.esm` | novice, tailor, liverywright | 1 Red Robes (`10cff2:Skyrim.esm`); 1 Archmage's Robes (`826:MoreCraftableEquipment.esp`) | `9a6:MoreCraftableEquipment.esp`; `996:MoreCraftableEquipment.esp` | 6 hours |
| Tailor `198ac:Skyrim.esm` | advanced, tailor, haberdasher | 2 Wedding Wreath (`8895a:Skyrim.esm`); 1 Grey Robes (`10cff1:Skyrim.esm`) | `9d1:MoreCraftableEquipment.esp`; `9a3:MoreCraftableEquipment.esp` | 12 hours |
| Tailor `198ac:Skyrim.esm` | expert, tailor, haberdasher | 2 Fur Cloak (Snowy Sabre) (`2885:Cloaks&Capes.esp`); 2 Green Robes (`10cff0:Skyrim.esm`) | `2e06:Cloaks&Capes.esp`; `9a0:MoreCraftableEquipment.esp` | 24 hours |
| Tailor `198ac:Skyrim.esm` | master, tailor, haberdasher | 3 Fur Cloak (White) (`1d8e:Cloaks&Capes.esp`); 3 Fur Cloak (Snowy Sabre) (`2885:Cloaks&Capes.esp`) | `2e03:Cloaks&Capes.esp`; `2e06:Cloaks&Capes.esp` | 48 hours |
| Enchanter `198c5:Skyrim.esm` | novice, enchanter, wardweaver | 1 Hooded Necromancer Robes (`82a:MoreCraftableEquipment.esp`); 1 Hooded Green Robes (`10cfec:Skyrim.esm`) | `9b5:MoreCraftableEquipment.esp`; `9a2:MoreCraftableEquipment.esp` | 6 hours |
| Enchanter `198c5:Skyrim.esm` | advanced, enchanter, wardweaver | 2 Ancient Nord Helmet (`56a9e:Skyrim.esm`); 1 Hooded Red Robes (`10cfeb:Skyrim.esm`) | `f46d0:Skyrim.esm`; `9a8:MoreCraftableEquipment.esp` | 12 hours |
| Enchanter `198c5:Skyrim.esm` | expert, enchanter, wardweaver | 2 Glass Helmet (`1393b:Skyrim.esm`); 2 Mythic Dawn Robes (`841:MoreCraftableEquipment.esp`) | `dca11:Skyrim.esm`; `9b1:MoreCraftableEquipment.esp` | 24 hours |
| Enchanter `198c5:Skyrim.esm` | master, enchanter, bladebinder | 2 Stalhrim Boots (`1cd9e:Dragonborn.esm`); 2 Ragged Robes (`13105:Skyrim.esm`) | `2b070:Dragonborn.esm`; `924:MoreCraftableEquipment.esp` | 48 hours |
| Cook `198a0:Skyrim.esm` | advanced, cook, hearthcook | 2 Braided Bread (`9db:HearthFires.esm`); 1 Potato Bread (`3537:HearthFires.esm`) | `a11:HearthFires.esm`; `117f8:HearthFires.esm` | 12 hours |
| Cook `198a0:Skyrim.esm` | expert, cook, hearthcook | 2 Cabbage and Tomato Soup (`eba01:Skyrim.esm`); 2 Bread Loaf (`65c97:Skyrim.esm`) | `f4312:Skyrim.esm`; `117f6:HearthFires.esm` | 24 hours |
| Cook `198a0:Skyrim.esm` | master, farmer | 2 Mammoth Stew (`818:Gourmet.esp`); 2 Braided Bread (`9db:HearthFires.esm`) | `819:Gourmet.esp`; `a11:HearthFires.esm` | 48 hours |
| Alchemist `198d2:Skyrim.esm` | novice, alchemist, physicker | 3 Namira's Rot (`4da24:Skyrim.esm`); 3 Hanging Moss (`57f91:Skyrim.esm`) | `4da0a:Skyrim.esm`; `bb94f:Skyrim.esm` | 6 hours |
| Alchemist `198d2:Skyrim.esm` | advanced, alchemist, blightbrewer | 4 Purple Mountain Flower (`77e1e:Skyrim.esm`); 4 Blue Mountain Flower (`77e1c:Skyrim.esm`) | `b91f8:Skyrim.esm`; `8b5c4:Skyrim.esm` | 12 hours |
| Alchemist `198d2:Skyrim.esm` | expert, alchemist, physicker | 5 Elves Ear (`34d31:Skyrim.esm`); 5 Blue Mountain Flower (`77e1c:Skyrim.esm`) | `34d2d:Skyrim.esm`; `8b5c4:Skyrim.esm` | 24 hours |
| Alchemist `198d2:Skyrim.esm` | master, alchemist, blightbrewer | 6 Ash Creep Cluster (`1cd74:Dragonborn.esm`); 6 Yellow Mountain Flower (`2a78:Dawnguard.esm`) | `195dc:Dragonborn.esm`; `2a76:Dawnguard.esm` | 48 hours |

Difficulty uses the lowest measured public producer tier across recipes, harvests and ores, including recipe input supply floors. Selecting a harder recipe cannot turn an easily obtained item into higher-tier evidence. Exact canonical producer evidence and ordinary role buy permission both apply; traded supplies can come from another craft. A lower-rank recipe needing Master inputs remains a lower-rank recipe, even though its supply requires Master work. Only actual Master recipes counted as Master evidence need two batches.

The original published Whiterun Tailor order keeps its exact three Novice robe batches and three Expert cloak batches. Its immutable hash identifies that exception. New Master Tailor logistics require six Expert batches; copying the older name or identity cannot copy its exemption.

Full copied proofs and immutable activation pins are in `game/data/merchant-ranked-quests.json` and `merchant-quest-activation.json`. Compiled controller tests execute every admitted parcel against actual eligibility, original quote, complete-delivery conservation, restart, stale-session and cooldown boundaries. The four-hold coverage test checks all 96 slots. The subsequent remaining-hold section completes those six holds and all Master-half/school coverage. The original scarce-resource and retrieval work is bound separately, all ten scarce works and all seven retrievals ([Appointed specialists for original work](merchant-legacy-offers.md)).
