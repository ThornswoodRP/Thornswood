# Deliveries in the remaining six holds

This section adds 141 distinct parcels in Hjaalmarch, Falkreath, Eastmarch, the Pale, Winterhold and Solstheim. The authored catalogue now contains 245 definitions: 241 deliveries and four combat jobs, covering all 240 merchant/rank slots for 60 specialists in ten holds. Five additional class Novice jobs share already covered slots. Every class/profession has at least two distinct jobs; every 14 non-Mage profession half has a specifically gated Master job, all five schools have a Master-spell gate, and each class has a Master job without a profession half.

This completes the authored rank coverage. The original scarce-resource and retrieval work has its bound specialists too: all ten scarce works and all seven retrievals ([Appointed specialists for original work](merchant-legacy-offers.md)). Aggregate authoring flags remain false; only explicit immutable manifest pins enable runtime offers.

Every item set differs from all earlier commissions, independent of its title or quantity. NPC locations, counts and return rates remain unchanged: 60 guild specialists, six trades in every hold. No item/source/spawn/yield, recipe condition, asset, engine, purse grant or refill changes. Exact original roster identities and public recipe/harvest proofs are pinned in the source JSON. Payments are the sum of required counts times the guild's reward prices, which staff set, paid as new gold (#6180, [Commission pay](merchant-quest-catalogue.md#commission-pay)). A missing reward price or no room refuses acceptance. Existing or traded goods qualify. Complete parcels settle once with original payment and inventory metadata; a partial parcel moves nothing. Personal rests are 6/12/24/48 hours from final saved settlement.

Master professions require mastery in the named half; classes require Master class standing without a half. Master Mage work requires its school at Master and at least one learned mapped Master spell from that school. Different producer halves may supply traded goods. New Master Tailor logistical orders require six Expert production batches; the exact earlier Whiterun mixed order remains immutable. Other Master orders include a proven Master supply source. Difficulty uses the lowest measured public source, including recipe input supply floors. No particular enchantment or unenchanted blank is promised.

## Hjaalmarch

| Offering specialist and exact reference | Rank and requirement | Complete parcel | Existing source references | Personal rest |
| --- | --- | --- | --- | --- |
| Smith `e24:JKs Skyrim.esp` | novice, smith, platewright | 1 Stormcloak Helmet (`a6d79:Skyrim.esm`); 1 Stormcloak Officer Armor (`8697e:Skyrim.esm`) | `8db:MoreCraftableEquipment.esp`; `8d5:MoreCraftableEquipment.esp` | 6 hours |
| Smith `e24:JKs Skyrim.esp` | advanced, smith, edgewright | 2 Orcish Warhammer (`13992:Skyrim.esm`); 1 Stormcloak Officer Bracers (`86983:Skyrim.esm`) | `db8a1:Skyrim.esm`; `8d6:MoreCraftableEquipment.esp` | 12 hours |
| Smith `e24:JKs Skyrim.esp` | expert, smith, platewright | 2 Stormcloak Officer Helmet (`86985:Skyrim.esm`); 2 Stormcloak Helmet (`a6d79:Skyrim.esm`) | `8d7:MoreCraftableEquipment.esp`; `8db:MoreCraftableEquipment.esp` | 24 hours |
| Smith `e24:JKs Skyrim.esp` | master, smith, edgewright | 2 Ebony War Axe (`139ab:Skyrim.esm`); 2 Steel Warhammer (`1398a:Skyrim.esm`) | `db8bd:Skyrim.esm`; `db89e:Skyrim.esm` | 48 hours |
| Woodworker `b818d:Arena - Markarth Side.esp` | novice, woodworker, woodwright | 1 Crude Fishing Pole (`15498:Thornswood-Content.esp`); 1 Iron Ingot (`5ace4:Skyrim.esm`) | `1549c:Thornswood-Content.esp`; `a30c3:Skyrim.esm` | 6 hours |
| Woodworker `b818d:Arena - Markarth Side.esp` | advanced, woodworker, charburner | 2 Charcoal (`33760:Skyrim.esm`); 1 Crossbow (`801:Dawnguard.esm`) | `15486:Thornswood-Content.esp`; `f80e:Dawnguard.esm` | 12 hours |
| Woodworker `b818d:Arena - Markarth Side.esp` | expert, woodworker, woodwright | 96 Falmer Arrow (`38341:Skyrim.esm`); 2 Nordic Bow (`26232:Dragonborn.esm`) | `8f0:MoreCraftableEquipment.esp`; `2b07f:Dragonborn.esm` | 24 hours |
| Woodworker `b818d:Arena - Markarth Side.esp` | master, woodworker, charburner | 2 Coke (`15485:Thornswood-Content.esp`); 2 Tool Handle (`15490:Thornswood-Content.esp`) | `15488:Thornswood-Content.esp`; `15491:Thornswood-Content.esp` | 48 hours |
| Tailor `13c008:Arena - Markarth Side.esp` | novice, tailor, haberdasher | 1 Fur-Trimmed Cloak (`8698c:Skyrim.esm`); 1 Archmage's Hood (`828:MoreCraftableEquipment.esp`) | `985:MoreCraftableEquipment.esp`; `995:MoreCraftableEquipment.esp` | 6 hours |
| Tailor `13c008:Arena - Markarth Side.esp` | advanced, tailor, haberdasher | 2 Wedding Wreath (`8895a:Skyrim.esm`); 1 Fur-Trimmed Cloak (`8698c:Skyrim.esm`) | `9d1:MoreCraftableEquipment.esp`; `985:MoreCraftableEquipment.esp` | 12 hours |
| Tailor `13c008:Arena - Markarth Side.esp` | expert, tailor, haberdasher | 2 Fur Cloak (Snowy Sabre) (`2885:Cloaks&Capes.esp`); 2 Fur-Trimmed Cloak (`8698c:Skyrim.esm`) | `2e06:Cloaks&Capes.esp`; `985:MoreCraftableEquipment.esp` | 24 hours |
| Tailor `13c008:Arena - Markarth Side.esp` | master, tailor, liverywright | 3 Fur Cloak (Black) (`2883:Cloaks&Capes.esp`); 3 Fur Cloak (Snowy Sabre) (`2885:Cloaks&Capes.esp`) | `2e04:Cloaks&Capes.esp`; `2e06:Cloaks&Capes.esp` | 48 hours |
| Enchanter `1aa5e:Skyrim.esm` | novice, enchanter, wardweaver | 1 Fur-Trimmed Cloak (`8698c:Skyrim.esm`); 1 Stormcloak Helmet (`a6d79:Skyrim.esm`) | `985:MoreCraftableEquipment.esp`; `8db:MoreCraftableEquipment.esp` | 6 hours |
| Enchanter `1aa5e:Skyrim.esm` | advanced, enchanter, wardweaver | 2 Chitin Shield (`26235:Dragonborn.esm`); 1 Stormcloak Officer Boots (`86981:Skyrim.esm`) | `2b053:Dragonborn.esm`; `8d4:MoreCraftableEquipment.esp` | 12 hours |
| Enchanter `1aa5e:Skyrim.esm` | expert, enchanter, wardweaver | 2 Fur Cloak (White) (`1d8e:Cloaks&Capes.esp`); 2 Stormcloak Officer Armor (`8697e:Skyrim.esm`) | `2e03:Cloaks&Capes.esp`; `8d5:MoreCraftableEquipment.esp` | 24 hours |
| Enchanter `1aa5e:Skyrim.esm` | master, enchanter, wardweaver | 2 Nordic Carved Armor (`1cd97:Dragonborn.esm`); 2 Stormcloak Officer Helmet (`86985:Skyrim.esm`) | `2b067:Dragonborn.esm`; `8d7:MoreCraftableEquipment.esp` | 48 hours |
| Cook `1aa62:Skyrim.esm` | novice, cook, hearthcook | 1 Roasted Mushrooms (`901:Gourmet.esp`); 1 Cooked Beef (`721e8:Skyrim.esm`) | `904:Gourmet.esp`; `f4309:Skyrim.esm` | 6 hours |
| Cook `1aa62:Skyrim.esm` | advanced, cook, hearthcook | 2 Roasted Wild Mushrooms (`902:Gourmet.esp`); 1 Roasted Mushrooms (`901:Gourmet.esp`) | `905:Gourmet.esp`; `904:Gourmet.esp` | 12 hours |
| Cook `1aa62:Skyrim.esm` | expert, cook, hearthcook | 2 Mushroom Stew (`8f5:Gourmet.esp`); 2 Roasted Glowing Mushroom (`903:Gourmet.esp`) | `8f8:Gourmet.esp`; `906:Gourmet.esp` | 24 hours |
| Cook `1aa62:Skyrim.esm` | master, cook, hearthcook | 2 Mammoth Steak (`722bb:Skyrim.esm`); 2 Roasted Mushrooms (`901:Gourmet.esp`) | `f430d:Skyrim.esm`; `904:Gourmet.esp` | 48 hours |
| Alchemist `1aa61:Skyrim.esm` | advanced, alchemist, blightbrewer | 4 Deathbell (`516c8:Skyrim.esm`); 4 Glowing Mushroom (`7ee01:Skyrim.esm`) | `bb94b:Skyrim.esm`; `7ee00:Skyrim.esm` | 12 hours |
| Alchemist `1aa61:Skyrim.esm` | expert, alchemist, physicker | 5 Nirnroot (`59b86:Skyrim.esm`); 5 Glowing Mushroom (`7ee01:Skyrim.esm`) | `110c8:HearthFires.esm`; `7ee00:Skyrim.esm` | 24 hours |
| Alchemist `1aa61:Skyrim.esm` | master, gatherer | 6 Ash Creep Cluster (`1cd74:Dragonborn.esm`); 6 Swamp Fungal Pod (`7e8b7:Skyrim.esm`) | `195dc:Dragonborn.esm`; `7e8b8:Skyrim.esm` | 48 hours |

## Falkreath

| Offering specialist and exact reference | Rank and requirement | Complete parcel | Existing source references | Personal rest |
| --- | --- | --- | --- | --- |
| Smith `3a19f:Skyrim.esm` | novice, smith, platewright | 1 Fur Boots (`a6d7f:Skyrim.esm`); 1 Stormcloak Officer Boots (`86981:Skyrim.esm`) | `8d8:MoreCraftableEquipment.esp`; `8d4:MoreCraftableEquipment.esp` | 6 hours |
| Smith `3a19f:Skyrim.esm` | advanced, smith, platewright | 2 Nordic Shield (`26236:Dragonborn.esm`); 1 Fur Boots (`a6d7f:Skyrim.esm`) | `2b065:Dragonborn.esm`; `8d8:MoreCraftableEquipment.esp` | 12 hours |
| Smith `3a19f:Skyrim.esm` | expert, smith, platewright | 2 Stormcloak Officer Helmet (`86985:Skyrim.esm`); 2 Fur Armor (`6f393:Skyrim.esm`) | `8d7:MoreCraftableEquipment.esp`; `844:MoreCraftableEquipment.esp` | 24 hours |
| Smith `3a19f:Skyrim.esm` | master, smith, platewright | 2 Ebony Boots (`13960:Skyrim.esm`); 2 Fur Boots (`a6d7f:Skyrim.esm`) | `dd988:Skyrim.esm`; `8d8:MoreCraftableEquipment.esp` | 48 hours |
| Woodworker `1981e:Skyrim.esm` | novice, woodworker, woodwright | 4 Leather Strips (`800e4:Skyrim.esm`); 24 Iron Arrow (`1397d:Skyrim.esm`) | `f7f43:Skyrim.esm`; `b64f:Dawnguard.esm` | 6 hours |
| Woodworker `1981e:Skyrim.esm` | advanced, woodworker, woodwright | 20 Steel Bolt (`bb3:Dawnguard.esm`); 1 Orichalcum Ingot (`5ad99:Skyrim.esm`) | `f813:Dawnguard.esm`; `a30db:Skyrim.esm` | 12 hours |
| Woodworker `1981e:Skyrim.esm` | expert, woodworker, woodwright | 2 Elven Bow (`1399d:Skyrim.esm`); 2 Crude Fishing Pole (`15498:Thornswood-Content.esp`) | `108cfa:Skyrim.esm`; `1549c:Thornswood-Content.esp` | 24 hours |
| Woodworker `1981e:Skyrim.esm` | master, woodworker, woodwright | 2 Ebony Bow (`139ad:Skyrim.esm`); 2 Crude Fishing Pole (`15498:Thornswood-Content.esp`) | `108cf9:Skyrim.esm`; `1549c:Thornswood-Content.esp` | 48 hours |
| Tailor `1939ba:aaaGraniteHill.esp` | advanced, tailor, liverywright | 2 Silver Ingot (`5ace3:Skyrim.esm`); 1 Fur-Trimmed Cloak (`8698c:Skyrim.esm`) | `a30dd:Skyrim.esm`; `985:MoreCraftableEquipment.esp` | 12 hours |
| Tailor `1939ba:aaaGraniteHill.esp` | expert, tailor, haberdasher | 2 Fur Cloak (Black) (`2883:Cloaks&Capes.esp`); 2 Fur-Trimmed Cloak (`8698c:Skyrim.esm`) | `2e04:Cloaks&Capes.esp`; `985:MoreCraftableEquipment.esp` | 24 hours |
| Tailor `1939ba:aaaGraniteHill.esp` | master, hunter | 3 Fur Cloak (Brown) (`2884:Cloaks&Capes.esp`); 3 Fur Cloak (Snowy Sabre) (`2885:Cloaks&Capes.esp`) | `2e05:Cloaks&Capes.esp`; `2e06:Cloaks&Capes.esp` | 48 hours |
| Enchanter `72c89:North Keep.esp` | novice, enchanter, wardweaver | 1 Fur Boots (`a6d7f:Skyrim.esm`); 1 Fur Helmet (`6f39e:Skyrim.esm`) | `8d8:MoreCraftableEquipment.esp`; `849:MoreCraftableEquipment.esp` | 6 hours |
| Enchanter `72c89:North Keep.esp` | advanced, enchanter, wardweaver | 2 Scaled Boots (`1b39f:Skyrim.esm`); 1 Fur-lined Boots (`5db7e:Skyrim.esm`) | `dca05:Skyrim.esm`; `98a:MoreCraftableEquipment.esp` | 12 hours |
| Enchanter `72c89:North Keep.esp` | expert, enchanter, wardweaver | 2 Fur Cloak (Vale Sabre) (`2886:Cloaks&Capes.esp`); 2 Stormcloak Officer Helmet (`86985:Skyrim.esm`) | `2e07:Cloaks&Capes.esp`; `8d7:MoreCraftableEquipment.esp` | 24 hours |
| Enchanter `72c89:North Keep.esp` | master, enchanter, wardweaver | 2 Nordic Carved Armor (`1cd97:Dragonborn.esm`); 2 Stormcloak Officer Armor (`8697e:Skyrim.esm`) | `2b067:Dragonborn.esm`; `8d5:MoreCraftableEquipment.esp` | 48 hours |
| Cook `3a198:Skyrim.esm` | novice, cook, hearthcook | 1 Venison Stew (`f431d:Skyrim.esm`); 1 Venison Chop (`722bd:Skyrim.esm`) | `f4317:Skyrim.esm`; `f4311:Skyrim.esm` | 6 hours |
| Cook `3a198:Skyrim.esm` | advanced, cook, hearthcook | 2 Ash Yam Soup (`3cd5b:Dragonborn.esm`); 1 Venison Stew (`f431d:Skyrim.esm`) | `3cd5d:Dragonborn.esm`; `f4317:Skyrim.esm` | 12 hours |
| Cook `3a198:Skyrim.esm` | expert, cook, hearthcook | 2 Mushroom Stew (`8f5:Gourmet.esp`); 2 Venison Stew (`f431d:Skyrim.esm`) | `8f8:Gourmet.esp`; `f4317:Skyrim.esm` | 24 hours |
| Cook `3a198:Skyrim.esm` | master, cook, confectioner | 2 Mammoth Stew (`818:Gourmet.esp`); 2 Apple Pie (`64b43:Skyrim.esm`) | `819:Gourmet.esp`; `117fe:HearthFires.esm` | 48 hours |
| Alchemist `3a19b:Skyrim.esm` | novice, alchemist, physicker | 3 Emperor Parasol Moss (`1ff75:Dragonborn.esm`); 3 Hanging Moss (`57f91:Skyrim.esm`) | `1ff64:Dragonborn.esm`; `bb94f:Skyrim.esm` | 6 hours |
| Alchemist `3a19b:Skyrim.esm` | advanced, alchemist, blightbrewer | 2 Physicker's Remedy (`154c3:Thornswood-Content.esp`); 4 Emperor Parasol Moss (`1ff75:Dragonborn.esm`) | `154c7:Thornswood-Content.esp`; `1ff64:Dragonborn.esm` | 12 hours |
| Alchemist `3a19b:Skyrim.esm` | expert, alchemist, physicker | 5 Nightshade (`2f44c:Skyrim.esm`); 5 Hanging Moss (`57f91:Skyrim.esm`) | `c43b0:Skyrim.esm`; `bb94f:Skyrim.esm` | 24 hours |
| Alchemist `3a19b:Skyrim.esm` | master, alchemist, blightbrewer | 6 Ash Creep Cluster (`1cd74:Dragonborn.esm`); 6 Nightshade (`2f44c:Skyrim.esm`) | `195dc:Dragonborn.esm`; `c43b0:Skyrim.esm` | 48 hours |

## Eastmarch

| Offering specialist and exact reference | Rank and requirement | Complete parcel | Existing source references | Personal rest |
| --- | --- | --- | --- | --- |
| Smith `1b135:Skyrim.esm` | novice, smith, platewright | 1 Fur Boots (`a6d7f:Skyrim.esm`); 1 Stormcloak Officer Bracers (`86983:Skyrim.esm`) | `8d8:MoreCraftableEquipment.esp`; `8d6:MoreCraftableEquipment.esp` | 6 hours |
| Smith `1b135:Skyrim.esm` | advanced, smith, platewright | 2 Steel Shield (`13955:Skyrim.esm`); 1 Fur Armor (`6f393:Skyrim.esm`) | `dd978:Skyrim.esm`; `844:MoreCraftableEquipment.esp` | 12 hours |
| Smith `1b135:Skyrim.esm` | expert, smith, platewright | 2 Stormcloak Officer Helmet (`86985:Skyrim.esm`); 2 Steel Armor (`13952:Skyrim.esm`) | `8d7:MoreCraftableEquipment.esp`; `dd975:Skyrim.esm` | 24 hours |
| Smith `1b135:Skyrim.esm` | master, warrior, bulwark | 2 Stalhrim Shield (`26237:Dragonborn.esm`); 2 Stormcloak Officer Helmet (`86985:Skyrim.esm`) | `2b06f:Dragonborn.esm`; `8d7:MoreCraftableEquipment.esp` | 48 hours |
| Woodworker `1b123:Skyrim.esm` | novice, woodworker, woodwright | 1 Crude Fishing Pole (`15498:Thornswood-Content.esp`); 4 Leather Strips (`800e4:Skyrim.esm`) | `1549c:Thornswood-Content.esp`; `f7f43:Skyrim.esm` | 6 hours |
| Woodworker `1b123:Skyrim.esm` | advanced, woodworker, woodwright | 20 Steel Bolt (`bb3:Dawnguard.esm`); 1 Steel Ingot (`5ace5:Skyrim.esm`) | `f813:Dawnguard.esm`; `a30e4:Skyrim.esm` | 12 hours |
| Woodworker `1b123:Skyrim.esm` | expert, woodworker, woodwright | 2 Glass Bow (`139a5:Skyrim.esm`); 2 Steel Ingot (`5ace5:Skyrim.esm`) | `108cfb:Skyrim.esm`; `a30e4:Skyrim.esm` | 24 hours |
| Woodworker `1b123:Skyrim.esm` | master, woodworker, charburner | 2 Coke (`15485:Thornswood-Content.esp`); 2 Poor Charcoal (`15481:Thornswood-Content.esp`) | `15488:Thornswood-Content.esp`; `15480:Thornswood-Content.esp` | 48 hours |
| Tailor `1b124:Skyrim.esm` | novice, tailor, haberdasher | 1 Fur-lined Boots (`5db7e:Skyrim.esm`); 1 Fur-Trimmed Cloak (`8698c:Skyrim.esm`) | `98a:MoreCraftableEquipment.esp`; `985:MoreCraftableEquipment.esp` | 6 hours |
| Tailor `1b124:Skyrim.esm` | advanced, tailor, haberdasher | 2 Wedding Wreath (`8895a:Skyrim.esm`); 1 Fur-lined Boots (`5db7e:Skyrim.esm`) | `9d1:MoreCraftableEquipment.esp`; `98a:MoreCraftableEquipment.esp` | 12 hours |
| Tailor `1b124:Skyrim.esm` | expert, tailor, haberdasher | 2 Fur Cloak (Brown) (`2884:Cloaks&Capes.esp`); 2 Fur-lined Boots (`5db7e:Skyrim.esm`) | `2e05:Cloaks&Capes.esp`; `98a:MoreCraftableEquipment.esp` | 24 hours |
| Tailor `1b124:Skyrim.esm` | master, tailor, haberdasher | 3 Fur Cloak (Black) (`2883:Cloaks&Capes.esp`); 3 Fur Cloak (White) (`1d8e:Cloaks&Capes.esp`) | `2e04:Cloaks&Capes.esp`; `2e03:Cloaks&Capes.esp` | 48 hours |
| Enchanter `1b132:Skyrim.esm` | novice, enchanter, wardweaver | 1 Fur Armor (`6f393:Skyrim.esm`); 1 Fur Boots (`a6d7f:Skyrim.esm`) | `844:MoreCraftableEquipment.esp`; `8d8:MoreCraftableEquipment.esp` | 6 hours |
| Enchanter `1b132:Skyrim.esm` | advanced, enchanter, wardweaver | 2 Steel Plate Boots (`1395b:Skyrim.esm`); 1 Steel Armor (`13952:Skyrim.esm`) | `dd97e:Skyrim.esm`; `dd975:Skyrim.esm` | 12 hours |
| Enchanter `1b132:Skyrim.esm` | expert, enchanter, wardweaver | 2 Fur Cloak (Brown) (`2884:Cloaks&Capes.esp`); 2 Steel Helmet (`13954:Skyrim.esm`) | `2e05:Cloaks&Capes.esp`; `dd977:Skyrim.esm` | 24 hours |
| Enchanter `1b132:Skyrim.esm` | master, enchanter, bladebinder | 2 Ebony Boots (`13960:Skyrim.esm`); 2 Steel Shield (`13955:Skyrim.esm`) | `dd988:Skyrim.esm`; `dd978:Skyrim.esm` | 48 hours |
| Cook `1b11a:Skyrim.esm` | novice, cook, hearthcook | 1 Beef Stew (`f4314:Skyrim.esm`); 1 Rabbit Stew (`8ea:Gourmet.esp`) | `f4313:Skyrim.esm`; `8ec:Gourmet.esp` | 6 hours |
| Cook `1b11a:Skyrim.esm` | advanced, cook, confectioner | 2 Snowberry Crostata (`353b:HearthFires.esm`); 1 Goat Stew (`81c:Gourmet.esp`) | `117fd:HearthFires.esm`; `81d:Gourmet.esp` | 12 hours |
| Cook `1b11a:Skyrim.esm` | expert, cook, hearthcook | 2 Wild Mushroom Stew (`8f6:Gourmet.esp`); 2 Rabbit Stew (`8ea:Gourmet.esp`) | `8f9:Gourmet.esp`; `8ec:Gourmet.esp` | 24 hours |
| Cook `1b11a:Skyrim.esm` | master, cook, hearthcook | 2 Mammoth Stew (`818:Gourmet.esp`); 2 Pheasant Stew (`8eb:Gourmet.esp`) | `819:Gourmet.esp`; `8ed:Gourmet.esp` | 48 hours |
| Alchemist `1b115:Skyrim.esm` | novice, alchemist, physicker | 3 Imp Stool (`4da23:Skyrim.esm`); 3 Tundra Cotton (`3f7f8:Skyrim.esm`) | `4da08:Skyrim.esm`; `bb947:Skyrim.esm` | 6 hours |
| Alchemist `1b115:Skyrim.esm` | advanced, alchemist, blightbrewer | 4 Snowberries (`1b3bd:Skyrim.esm`); 4 Emperor Parasol Moss (`1ff75:Dragonborn.esm`) | `bcf33:Skyrim.esm`; `1ff64:Dragonborn.esm` | 12 hours |
| Alchemist `1b115:Skyrim.esm` | expert, alchemist, physicker | 5 Nightshade (`2f44c:Skyrim.esm`); 5 Snowberries (`1b3bd:Skyrim.esm`) | `c43b0:Skyrim.esm`; `bcf33:Skyrim.esm` | 24 hours |
| Alchemist `1b115:Skyrim.esm` | master, alchemist, physicker | 6 Ash Creep Cluster (`1cd74:Dragonborn.esm`); 6 Snowberries (`1b3bd:Skyrim.esm`) | `195dc:Dragonborn.esm`; `bcf33:Skyrim.esm` | 48 hours |

## the Pale

| Offering specialist and exact reference | Rank and requirement | Complete parcel | Existing source references | Personal rest |
| --- | --- | --- | --- | --- |
| Smith `1a6be:Skyrim.esm` | novice, smith, platewright | 1 Stormcloak Cuirass (`a6d7b:Skyrim.esm`); 1 Fur Boots (`a6d7f:Skyrim.esm`) | `8d9:MoreCraftableEquipment.esp`; `8d8:MoreCraftableEquipment.esp` | 6 hours |
| Smith `1a6be:Skyrim.esm` | advanced, smith, edgewright | 2 Orcish Battleaxe (`1398c:Skyrim.esm`); 1 Stormcloak Helmet (`a6d79:Skyrim.esm`) | `db899:Skyrim.esm`; `8db:MoreCraftableEquipment.esp` | 12 hours |
| Smith `1a6be:Skyrim.esm` | expert, smith, platewright | 2 Stormcloak Officer Helmet (`86985:Skyrim.esm`); 2 Fur Boots (`a6d7f:Skyrim.esm`) | `8d7:MoreCraftableEquipment.esp`; `8d8:MoreCraftableEquipment.esp` | 24 hours |
| Smith `1a6be:Skyrim.esm` | master, smith, edgewright | 2 Stalhrim Greatsword (`1cdb6:Dragonborn.esm`); 2 Steel Greatsword (`13987:Skyrim.esm`) | `2b079:Dragonborn.esm`; `a5cd6:Skyrim.esm` | 48 hours |
| Woodworker `33a2:JKs Skyrim.esp` | novice, woodworker, woodwright | 1 Fish Trap (`1549b:Thornswood-Content.esp`); 1 Iron Ingot (`5ace4:Skyrim.esm`) | `1549f:Thornswood-Content.esp`; `a30c3:Skyrim.esm` | 6 hours |
| Woodworker `33a2:JKs Skyrim.esp` | advanced, woodworker, charburner | 2 Orichalcum Ingot (`5ad99:Skyrim.esm`); 1 Fish Trap (`1549b:Thornswood-Content.esp`) | `a30db:Skyrim.esm`; `1549f:Thornswood-Content.esp` | 12 hours |
| Woodworker `33a2:JKs Skyrim.esp` | expert, woodworker, woodwright | 2 Fine Fishing Pole (`15499:Thornswood-Content.esp`); 2 Fish Trap (`1549b:Thornswood-Content.esp`) | `1549d:Thornswood-Content.esp`; `1549f:Thornswood-Content.esp` | 24 hours |
| Woodworker `33a2:JKs Skyrim.esp` | master, woodworker, woodwright | 2 Master Fishing Pole (`1549a:Thornswood-Content.esp`); 2 Crude Fishing Pole (`15498:Thornswood-Content.esp`) | `1549e:Thornswood-Content.esp`; `1549c:Thornswood-Content.esp` | 48 hours |
| Tailor `1a6bf:Skyrim.esm` | novice, tailor, haberdasher | 1 Fur-Trimmed Cloak (`8698c:Skyrim.esm`); 1 Ulfric's Boots (`62311:Skyrim.esm`) | `985:MoreCraftableEquipment.esp`; `9e0:MoreCraftableEquipment.esp` | 6 hours |
| Tailor `1a6bf:Skyrim.esm` | advanced, tailor, liverywright | 2 Silver Ingot (`5ace3:Skyrim.esm`); 1 Fur-lined Boots (`5db7e:Skyrim.esm`) | `a30dd:Skyrim.esm`; `98a:MoreCraftableEquipment.esp` | 12 hours |
| Tailor `1a6bf:Skyrim.esm` | expert, tailor, haberdasher | 2 Fur Cloak (Vale Sabre) (`2886:Cloaks&Capes.esp`); 2 Fur-Trimmed Cloak (`8698c:Skyrim.esm`) | `2e07:Cloaks&Capes.esp`; `985:MoreCraftableEquipment.esp` | 24 hours |
| Tailor `1a6bf:Skyrim.esm` | master, tailor, liverywright | 3 Fur Cloak (Black) (`2883:Cloaks&Capes.esp`); 3 Fur Cloak (Vale Sabre) (`2886:Cloaks&Capes.esp`) | `2e04:Cloaks&Capes.esp`; `2e07:Cloaks&Capes.esp` | 48 hours |
| Enchanter `1a6c3:Skyrim.esm` | novice, enchanter, wardweaver | 1 Stormcloak Helmet (`a6d79:Skyrim.esm`); 1 Fur Boots (`a6d7f:Skyrim.esm`) | `8db:MoreCraftableEquipment.esp`; `8d8:MoreCraftableEquipment.esp` | 6 hours |
| Enchanter `1a6c3:Skyrim.esm` | advanced, enchanter, wardweaver | 2 Dawnguard Heavy Boots (`14757:Dawnguard.esm`); 1 Fur Armor (`6f393:Skyrim.esm`) | `85f:MoreCraftableEquipment.esp`; `844:MoreCraftableEquipment.esp` | 12 hours |
| Enchanter `1a6c3:Skyrim.esm` | expert, enchanter, wardweaver | 2 Fur Cloak (Black) (`2883:Cloaks&Capes.esp`); 2 Fur Armor (`6f393:Skyrim.esm`) | `2e04:Cloaks&Capes.esp`; `844:MoreCraftableEquipment.esp` | 24 hours |
| Enchanter `1a6c3:Skyrim.esm` | master, enchanter, bladebinder | 2 Stalhrim Gauntlets (`1cda0:Dragonborn.esm`); 2 Stormcloak Officer Bracers (`86983:Skyrim.esm`) | `2b072:Dragonborn.esm`; `8d6:MoreCraftableEquipment.esp` | 48 hours |
| Cook `3a22:JKs Skyrim.esp` | novice, cook, hearthcook | 1 Gourd Soup (`8b1:Gourmet.esp`); 1 Carrot Soup (`8b3:Gourmet.esp`) | `8bb:Gourmet.esp`; `8ba:Gourmet.esp` | 6 hours |
| Cook `3a22:JKs Skyrim.esp` | advanced, cook, confectioner | 2 Snowberry Dumpling (`11801:HearthFires.esm`); 1 Snowberry Crostata (`353b:HearthFires.esm`) | `11802:HearthFires.esm`; `117fd:HearthFires.esm` | 12 hours |
| Cook `3a22:JKs Skyrim.esp` | expert, cook, hearthcook | 2 Vegetable Soup (`f431e:Skyrim.esm`); 2 Snowberry Crostata (`353b:HearthFires.esm`) | `f4319:Skyrim.esm`; `117fd:HearthFires.esm` | 24 hours |
| Cook `3a22:JKs Skyrim.esp` | master, cook, confectioner | 2 Mammoth Steak (`722bb:Skyrim.esm`); 2 Snowberry Crostata (`353b:HearthFires.esm`) | `f430d:Skyrim.esm`; `117fd:HearthFires.esm` | 48 hours |
| Alchemist `1a6b5:Skyrim.esm` | novice, alchemist, physicker | 3 Lavender (`45c28:Skyrim.esm`); 3 Ashen Grass Pod (`16e26:Dragonborn.esm`) | `1bb3d:Skyrim.esm`; `16e24:Dragonborn.esm` | 6 hours |
| Alchemist `1a6b5:Skyrim.esm` | advanced, alchemist, blightbrewer | 4 Snowberries (`1b3bd:Skyrim.esm`); 4 Nordic Barnacle (`7edf5:Skyrim.esm`) | `bcf33:Skyrim.esm`; `7edf6:Skyrim.esm` | 12 hours |
| Alchemist `1a6b5:Skyrim.esm` | expert, alchemist, physicker | 5 Nightshade (`2f44c:Skyrim.esm`); 5 Emperor Parasol Moss (`1ff75:Dragonborn.esm`) | `c43b0:Skyrim.esm`; `1ff64:Dragonborn.esm` | 24 hours |
| Alchemist `1a6b5:Skyrim.esm` | master, alchemist, blightbrewer | 6 Ash Creep Cluster (`1cd74:Dragonborn.esm`); 6 Imp Stool (`4da23:Skyrim.esm`) | `195dc:Dragonborn.esm`; `4da08:Skyrim.esm` | 48 hours |

## Winterhold

| Offering specialist and exact reference | Rank and requirement | Complete parcel | Existing source references | Personal rest |
| --- | --- | --- | --- | --- |
| Smith `1c18c:Skyrim.esm` | novice, smith, platewright | 1 Stormcloak Helmet (`a6d79:Skyrim.esm`); 1 Stormcloak Officer Bracers (`86983:Skyrim.esm`) | `8db:MoreCraftableEquipment.esp`; `8d6:MoreCraftableEquipment.esp` | 6 hours |
| Smith `1c18c:Skyrim.esm` | advanced, smith, platewright | 2 Forsworn Armor (`d8d50:Skyrim.esm`); 1 Stormcloak Cuirass (`a6d7b:Skyrim.esm`) | `8ab:MoreCraftableEquipment.esp`; `8d9:MoreCraftableEquipment.esp` | 12 hours |
| Smith `1c18c:Skyrim.esm` | expert, smith, platewright | 2 Stormcloak Officer Helmet (`86985:Skyrim.esm`); 2 Stormcloak Officer Boots (`86981:Skyrim.esm`) | `8d7:MoreCraftableEquipment.esp`; `8d4:MoreCraftableEquipment.esp` | 24 hours |
| Smith `1c18c:Skyrim.esm` | master, smith, platewright | 2 Stalhrim Light Bracers (`1cda5:Dragonborn.esm`); 2 Stormcloak Officer Armor (`8697e:Skyrim.esm`) | `2b06d:Dragonborn.esm`; `8d5:MoreCraftableEquipment.esp` | 48 hours |
| Woodworker `b4a3:Populated Cities Towns Villages Legendary.esp` | novice, woodworker, woodwright | 1 Splint (`154c1:Thornswood-Content.esp`); 1 Poor Charcoal (`15481:Thornswood-Content.esp`) | `154c5:Thornswood-Content.esp`; `15480:Thornswood-Content.esp` | 6 hours |
| Woodworker `b4a3:Populated Cities Towns Villages Legendary.esp` | advanced, woodworker, woodwright | 2 Nordic Bow (`26232:Dragonborn.esm`); 1 Charcoal (`33760:Skyrim.esm`) | `2b07f:Dragonborn.esm`; `15486:Thornswood-Content.esp` | 12 hours |
| Woodworker `b4a3:Populated Cities Towns Villages Legendary.esp` | expert, woodworker, woodwright | 2 Elven Bow (`1399d:Skyrim.esm`); 2 Nordic Bow (`26232:Dragonborn.esm`) | `108cfa:Skyrim.esm`; `2b07f:Dragonborn.esm` | 24 hours |
| Woodworker `b4a3:Populated Cities Towns Villages Legendary.esp` | master, woodworker, charburner | 2 Coke (`15485:Thornswood-Content.esp`); 2 Charcoal (`33760:Skyrim.esm`) | `15488:Thornswood-Content.esp`; `15486:Thornswood-Content.esp` | 48 hours |
| Tailor `1c18e:Skyrim.esm` | novice, tailor, liverywright | 1 Hooded Black Robes (`107108:Skyrim.esm`); 1 Grey Robes (`10cff1:Skyrim.esm`) | `9c3:MoreCraftableEquipment.esp`; `9a3:MoreCraftableEquipment.esp` | 6 hours |
| Tailor `1c18e:Skyrim.esm` | advanced, tailor, haberdasher | 2 Wedding Wreath (`8895a:Skyrim.esm`); 1 Vampire Robes (`19adf:Dawnguard.esm`) | `9d1:MoreCraftableEquipment.esp`; `94b:MoreCraftableEquipment.esp` | 12 hours |
| Tailor `1c18e:Skyrim.esm` | expert, tailor, haberdasher | 2 Fur Cloak (Snowy Sabre) (`2885:Cloaks&Capes.esp`); 2 Archmage's Robes (`826:MoreCraftableEquipment.esp`) | `2e06:Cloaks&Capes.esp`; `996:MoreCraftableEquipment.esp` | 24 hours |
| Tailor `1c18e:Skyrim.esm` | master, tailor, haberdasher | 3 Fur Cloak (Brown) (`2884:Cloaks&Capes.esp`); 3 Fur Cloak (Vale Sabre) (`2886:Cloaks&Capes.esp`) | `2e05:Cloaks&Capes.esp`; `2e07:Cloaks&Capes.esp` | 48 hours |
| Enchanter `1e7d6:Skyrim.esm` | advanced, enchanter, wardweaver | 2 Chitin Helmet (`1cd89:Dragonborn.esm`); 1 Ragged Robes (`13105:Skyrim.esm`) | `2b054:Dragonborn.esm`; `924:MoreCraftableEquipment.esp` | 12 hours |
| Enchanter `1e7d6:Skyrim.esm` | expert, enchanter, wardweaver | 2 Stormcloak Officer Helmet (`86985:Skyrim.esm`); 2 Ragged Robes (`13105:Skyrim.esm`) | `8d7:MoreCraftableEquipment.esp`; `924:MoreCraftableEquipment.esp` | 24 hours |
| Enchanter `1e7d6:Skyrim.esm` | master, mage, restoration | 2 Stalhrim Shield (`26237:Dragonborn.esm`); 2 Archmage's Robes (`826:MoreCraftableEquipment.esp`) | `2b06f:Dragonborn.esm`; `996:MoreCraftableEquipment.esp` | 48 hours |
| Cook `1c18d:Skyrim.esm` | novice, cook, hearthcook | 1 Gourd Soup (`8b1:Gourmet.esp`); 1 Potato Soup (`353d:HearthFires.esm`) | `8bb:Gourmet.esp`; `3542:HearthFires.esm` | 6 hours |
| Cook `1c18d:Skyrim.esm` | advanced, cook, hearthcook | 2 Tomato Soup (`f431c:Skyrim.esm`); 1 Carrot Soup (`8b3:Gourmet.esp`) | `f4318:Skyrim.esm`; `8ba:Gourmet.esp` | 12 hours |
| Cook `1c18d:Skyrim.esm` | expert, cook, hearthcook | 2 Vegetable Soup (`f431e:Skyrim.esm`); 2 Snowberry Dumpling (`11801:HearthFires.esm`) | `f4319:Skyrim.esm`; `11802:HearthFires.esm` | 24 hours |
| Cook `1c18d:Skyrim.esm` | master, cook, hearthcook | 2 Mammoth Stew (`818:Gourmet.esp`); 2 Gourd Soup (`8b1:Gourmet.esp`) | `819:Gourmet.esp`; `8bb:Gourmet.esp` | 48 hours |
| Alchemist `1c1aa:Skyrim.esm` | novice, alchemist, physicker | 3 Scathecraw (`17e97:Dragonborn.esm`); 3 Grass Pod (`83e64:Skyrim.esm`) | `17e93:Dragonborn.esm`; `be3e0:Skyrim.esm` | 6 hours |
| Alchemist `1c1aa:Skyrim.esm` | advanced, alchemist, blightbrewer | 4 Snowberries (`1b3bd:Skyrim.esm`); 4 Dragon's Tongue (`889a2:Skyrim.esm`) | `bcf33:Skyrim.esm`; `bb94d:Skyrim.esm` | 12 hours |
| Alchemist `1c1aa:Skyrim.esm` | expert, alchemist, physicker | 5 Elves Ear (`34d31:Skyrim.esm`); 5 Snowberries (`1b3bd:Skyrim.esm`) | `34d2d:Skyrim.esm`; `bcf33:Skyrim.esm` | 24 hours |
| Alchemist `1c1aa:Skyrim.esm` | master, alchemist, physicker | 6 Ash Creep Cluster (`1cd74:Dragonborn.esm`); 6 Elves Ear (`34d31:Skyrim.esm`) | `195dc:Dragonborn.esm`; `34d2d:Skyrim.esm` | 48 hours |

## Solstheim

| Offering specialist and exact reference | Rank and requirement | Complete parcel | Existing source references | Personal rest |
| --- | --- | --- | --- | --- |
| Smith `1828f:Dragonborn.esm` | novice, smith, platewright | 1 Leather Helmet (`13922:Skyrim.esm`); 1 Iron Boots (`12e4b:Skyrim.esm`) | `dca04:Skyrim.esm`; `db290:Skyrim.esm` | 6 hours |
| Smith `1828f:Dragonborn.esm` | advanced, smith, platewright | 2 Chitin Heavy Helmet (`1cd8c:Dragonborn.esm`); 1 Chitin Helmet (`1cd89:Dragonborn.esm`) | `2b052:Dragonborn.esm`; `2b054:Dragonborn.esm` | 12 hours |
| Smith `1828f:Dragonborn.esm` | expert, smith, platewright | 2 Falmer Shield (`5c06c:Skyrim.esm`); 2 Nordic War Axe (`1cdb2:Dragonborn.esm`) | `8a9:MoreCraftableEquipment.esp`; `2b084:Dragonborn.esm` | 24 hours |
| Smith `1828f:Dragonborn.esm` | master, smith, edgewright | 2 Stalhrim Warhammer (`1cdba:Dragonborn.esm`); 2 Nordic Battleaxe (`1cdad:Dragonborn.esm`) | `2b07d:Dragonborn.esm`; `2b07e:Dragonborn.esm` | 48 hours |
| Woodworker `18293:Dragonborn.esm` | novice, woodworker, woodwright | 1 Crude Fishing Pole (`15498:Thornswood-Content.esp`); 24 Iron Arrow (`1397d:Skyrim.esm`) | `1549c:Thornswood-Content.esp`; `b64f:Dawnguard.esm` | 6 hours |
| Woodworker `18293:Dragonborn.esm` | advanced, woodworker, woodwright | 48 Nordic Arrow (`2623b:Dragonborn.esm`); 1 Nordic Bow (`26232:Dragonborn.esm`) | `3cf53:Dragonborn.esm`; `2b07f:Dragonborn.esm` | 12 hours |
| Woodworker `18293:Dragonborn.esm` | expert, woodworker, woodwright | 2 Glass Bow (`139a5:Skyrim.esm`); 48 Nordic Arrow (`2623b:Dragonborn.esm`) | `108cfb:Skyrim.esm`; `3cf53:Dragonborn.esm` | 24 hours |
| Woodworker `18293:Dragonborn.esm` | master, woodworker, woodwright | 2 Master Fishing Pole (`1549a:Thornswood-Content.esp`); 48 Nordic Arrow (`2623b:Dragonborn.esm`) | `1549e:Thornswood-Content.esp`; `3cf53:Dragonborn.esm` | 48 hours |
| Tailor `18fc0:Dragonborn.esm` | novice, tailor, liverywright | 1 Black Robes (`106661:Skyrim.esm`); 1 Boots (`4223d:Skyrim.esm`) | `9c1:MoreCraftableEquipment.esp`; `98f:MoreCraftableEquipment.esp` | 6 hours |
| Tailor `18fc0:Dragonborn.esm` | advanced, tailor, liverywright | 2 Silver Ingot (`5ace3:Skyrim.esm`); 1 Temple Priest Robes (`9f0:MoreCraftableEquipment.esp`) | `a30dd:Skyrim.esm`; `966:MoreCraftableEquipment.esp` | 12 hours |
| Tailor `18fc0:Dragonborn.esm` | expert, tailor, haberdasher | 2 Fur Cloak (Black) (`2883:Cloaks&Capes.esp`); 2 Psijic Robes (`65b94:Skyrim.esm`) | `2e04:Cloaks&Capes.esp`; `9bc:MoreCraftableEquipment.esp` | 24 hours |
| Tailor `18fc0:Dragonborn.esm` | master, tailor, liverywright | 3 Gilded Wristguards (`e84c1:Skyrim.esm`); 3 Fur Cloak (Vale Sabre) (`2886:Cloaks&Capes.esp`) | `988:MoreCraftableEquipment.esp`; `2e07:Cloaks&Capes.esp` | 48 hours |
| Enchanter `177da:Dragonborn.esm` | novice, enchanter, wardweaver | 1 Hooded Archmage's Robes (`827:MoreCraftableEquipment.esp`); 1 Boots (`209a5:Skyrim.esm`) | `997:MoreCraftableEquipment.esp`; `96c:MoreCraftableEquipment.esp` | 6 hours |
| Enchanter `177da:Dragonborn.esm` | advanced, enchanter, wardweaver | 2 Chitin Bracers (`1cd88:Dragonborn.esm`); 1 Chitin Heavy Gauntlets (`1cd8b:Dragonborn.esm`) | `2b051:Dragonborn.esm`; `2b057:Dragonborn.esm` | 12 hours |
| Enchanter `177da:Dragonborn.esm` | expert, enchanter, wardweaver | 2 Falmer Helmet (`4c3cb:Skyrim.esm`); 2 Chitin Bracers (`1cd88:Dragonborn.esm`) | `89c:MoreCraftableEquipment.esp`; `2b051:Dragonborn.esm` | 24 hours |
| Enchanter `177da:Dragonborn.esm` | master, mage, conjuration | 2 Nordic Carved Armor (`1cd97:Dragonborn.esm`); 2 Chitin Bracers (`1cd88:Dragonborn.esm`) | `2b067:Dragonborn.esm`; `2b051:Dragonborn.esm` | 48 hours |
| Cook `18291:Dragonborn.esm` | novice, cook, hearthcook | 1 Clam Chowder (`353e:HearthFires.esm`); 1 Cooked Beef (`721e8:Skyrim.esm`) | `3543:HearthFires.esm`; `f4309:Skyrim.esm` | 6 hours |
| Cook `18291:Dragonborn.esm` | advanced, cook, hearthcook | 2 Ash Hopper Stew (`816:Gourmet.esp`); 1 Ash Yam Soup (`3cd5b:Dragonborn.esm`) | `81b:Gourmet.esp`; `3cd5d:Dragonborn.esm` | 12 hours |
| Cook `18291:Dragonborn.esm` | expert, cook, hearthcook | 2 Cabbage Potato Soup (`f431b:Skyrim.esm`); 2 Roasted Yams (`8e4:Gourmet.esp`) | `f431a:Skyrim.esm`; `8e5:Gourmet.esp` | 24 hours |
| Cook `18291:Dragonborn.esm` | master, cook, confectioner | 2 Mammoth Steak (`722bb:Skyrim.esm`); 2 Sweet Roll (`64b3d:Skyrim.esm`) | `f430d:Skyrim.esm`; `117fb:HearthFires.esm` | 48 hours |
| Alchemist `182a2:Dragonborn.esm` | novice, alchemist, physicker | 3 Trama Root (`17008:Dragonborn.esm`); 3 Ashen Grass Pod (`16e26:Dragonborn.esm`) | `17005:Dragonborn.esm`; `16e24:Dragonborn.esm` | 6 hours |
| Alchemist `182a2:Dragonborn.esm` | advanced, alchemist, blightbrewer | 4 Nordic Barnacle (`7edf5:Skyrim.esm`); 4 Trama Root (`17008:Dragonborn.esm`) | `7edf6:Skyrim.esm`; `17005:Dragonborn.esm` | 12 hours |
| Alchemist `182a2:Dragonborn.esm` | expert, alchemist, physicker | 5 Nirnroot (`59b86:Skyrim.esm`); 5 Nordic Barnacle (`7edf5:Skyrim.esm`) | `110c8:HearthFires.esm`; `7edf6:Skyrim.esm` | 24 hours |
| Alchemist `182a2:Dragonborn.esm` | master, alchemist, blightbrewer | 6 Ash Creep Cluster (`1cd74:Dragonborn.esm`); 6 Trama Root (`17008:Dragonborn.esm`) | `195dc:Dragonborn.esm`; `17005:Dragonborn.esm` | 48 hours |
