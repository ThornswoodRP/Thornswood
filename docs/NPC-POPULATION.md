# NPC population catalogue

Generated from the winning records in the 107-plugin load order.
These are source policies and counts. Release proof is recorded separately.

14,668 placements inspected; 4,883 retained; 9,785 excluded.

Named pets and named enemies are excluded even when their source record lacks the Unique flag.
Merchant traders and exterior transport services remain available.

[All retained spawn coordinates](../game/data/NPC-SPAWNS.csv) and [animal habitat coordinates](../game/data/HUNTING-SPOTS.csv)
list source identities, species, location, tier, cap, return interval and home radius.
Each row is one authored identity, not a per-person spawn. A dead identity returns once after its
listed interval; the deadline persists through restart. A corpse yields one shared dressing per life.

| Hold | Retained NPCs |
|---|---:|
| Eastmarch | 475 |
| Falkreath | 401 |
| Haafingar | 349 |
| Hjaalmarch | 382 |
| Solstheim | 451 |
| Whiterun | 523 |
| Winterhold | 505 |
| no hold | 304 |
| the Pale | 377 |
| the Reach | 531 |
| the Rift | 585 |

City animals: at most six per location. Farm livestock: at most eight per location.
Bandit camps: at most seven enemies, 45-minute returns. Giant camps: at most two giants
and four mammoths, four-hour returns. Camps have separate type baselines, without location tiers.
Wilderness tiles are 4,096 units: at most four enemies, three wolves, two other large predators
and six of each other animal species per tile. Cave and dungeon caps are shared across their rooms.

| Tier | Cave/dungeon cap | Return minutes |
|---|---:|---:|
| 1 | 8 | 30 |
| 2 | 12 | 45 |
| 3 | 16 | 60 |
| 4 | 20 | 90 |

## Locations

| Location | Hold | Habitat | Tier | NPC count | Return minutes |
|---|---|---|---:|---:|---|
| Stendarr's Beacon | the Rift | wilderness |  | 2 | 20 |
| Forgotten Vale Cave | no hold | cave | 2 | 5 | 45 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 45 |
| Markarth Side | Hjaalmarch | city |  | 4 | 20, 360 |
| Solitude Sewers | Haafingar | sewer | 1 | 8 | 30 |
| Riverwood | Whiterun | city |  | 6 | 20 |
| Redbelly Mine | the Rift | dungeon | 1 | 6 | 30 |
| Fort Frostmoth | Solstheim | dungeon | 3 | 16 | 60 |
| Beast Stone | Solstheim | wilderness |  | 1 | 45 |
| Benkongerike | Solstheim | dungeon | 1 | 8 | 30 |
| Raven Rock Mine | Solstheim | dungeon | 4 | 20 | 90 |
| Brodir Grove | Solstheim | bandit-camp |  | 3 | 45 |
| Castle Karstaag Ruins | Solstheim | dungeon | 1 | 8 | 30 |
| Fahlbtharz | Solstheim | dungeon | 3 | 16 | 60 |
| Kagrumez | Solstheim | dungeon | 3 | 1 | 60 |
| Frossel | Solstheim | dungeon | 1 | 8 | 30 |
| Gyldenhul Barrow | Solstheim | dungeon | 4 | 2 | 90 |
| Horker Island | Solstheim | wilderness |  | 4 | 20 |
| Apocrypha | no hold | wilderness |  | 3 | 45 |
| Nchardak | Solstheim | dungeon | 3 | 16 | 60 |
| Temple of Miraak | Solstheim | dungeon | 4 | 20 | 90 |
| Vahlok's Tomb | Solstheim | dungeon | 4 | 20 | 90 |
| Kolbjorn Barrow | Solstheim | dungeon | 4 | 7 | 90 |
| White Ridge Barrow | Solstheim | dungeon | 4 | 17 | 90 |
| Broken Tusk Mine | Solstheim | dungeon | 1 | 8 | 30 |
| Haknir's Shoal | Solstheim | bandit-camp |  | 2 | 45 |
| Hrodulf's House | Solstheim | bandit-camp |  | 4 | 45 |
| Glacial Cave | Solstheim | dungeon | 1 | 5 | 30 |
| Ashfallow Citadel | Solstheim | dungeon | 3 | 1 | 60 |
| Northshore Landing | Solstheim | wilderness |  | 5 | 20 |
| Strident Squall | Solstheim | bandit-camp |  | 5 | 45 |
| Moesring Pass | Solstheim | dungeon | 1 | 6 | 30 |
| Sun Stone | Solstheim | wilderness |  | 4 | 45 |
| Water Stone | Solstheim | wilderness |  | 3 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 15 | 20, 30, 45 |
| Apocrypha | no hold | dungeon | 3 | 7 | 60 |
| Apocrypha | no hold | dungeon | 3 | 10 | 60 |
| Raven Rock | Solstheim | city |  | 6 | 45, 360 |
| Skaal Village | Solstheim | city |  | 2 | 20, 360 |
| Tel Mithryn | Solstheim | interior |  | 1 | 360 |
| Sea Cave | Winterhold | cave | 1 | 4 | 30 |
| Kolskeggr Mine | the Reach | dungeon | 1 | 5 | 30 |
| Glacial Crevice | no hold | interior |  | 1 | 20 |
| WindhelmMarketplaceExterior | Eastmarch | city |  | 6 | 20 |
| RiftenCitySoutheast | the Rift | city |  | 2 | 20 |
| Solstheim | Solstheim | wilderness |  | 3 | 45 |
| Bloodlet Throne | Falkreath | dungeon | 1 | 8 | 30 |
| Dockside Warehouse | Eastmarch | dungeon | 1 | 8 | 30 |
| Hrothmund's Barrow | Solstheim | wilderness |  | 2 | 20 |
| Highpoint Tower | Solstheim | dungeon | 3 | 16 | 60 |
| Rorikstead | Whiterun | city |  | 6 | 20 |
| Granite Hill | Falkreath | city |  | 4 | 20, 360 |
| Falkreath | Falkreath | city |  | 10 | 20, 45, 360 |
| Helgen | Falkreath | interior |  | 6 | 20 |
| Ivarstead | the Rift | city |  | 6 | 20, 45 |
| Shor's Stone | the Rift | city |  | 4 | 20 |
| Darkwater Crossing | Eastmarch | wilderness |  | 4 | 20 |
| Kynesgrove | Eastmarch | wilderness |  | 5 | 20 |
| Dawnstar | the Pale | city |  | 12 | 20, 45, 360 |
| Winterhold | Winterhold | city |  | 11 | 20, 45, 360 |
| Stonehills | Hjaalmarch | wilderness |  | 1 | 20 |
| Morthal | Hjaalmarch | city |  | 9 | 20, 45, 360 |
| Karthwasten | the Reach | city |  | 5 | 20 |
| Old Hroldan | the Reach | wilderness |  | 1 | 20 |
| Whiterun | Whiterun | city |  | 13 | 20, 45, 360 |
| Windhelm | Eastmarch | city |  | 9 | 45, 360 |
| Riften | the Rift | city |  | 11 | 20, 45, 360 |
| Markarth | the Reach | city |  | 13 | 20, 45, 360 |
| Solitude | Haafingar | city |  | 8 | 45, 360 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 45 |
| Anga's Mill | the Pale | wilderness |  | 9 | 20 |
| Barleydark Farm | Whiterun | wilderness |  | 2 | 20 |
| Battle-Born Farm | Whiterun | farm |  | 4 | 20 |
| Brandy-Mug Farm | Eastmarch | farm |  | 3 | 20 |
| Chillfurrow Farm | Whiterun | farm |  | 1 | 20 |
| Thalmor Embassy | Haafingar | wilderness |  | 3 | 20 |
| Goldenglow Estate | the Rift | wilderness |  | 1 | 20 |
| Heartwood Mill | the Rift | wilderness |  | 3 | 20, 45 |
| Hlaalu Farm | Eastmarch | farm |  | 4 | 20 |
| Hollyfrost Farm | Eastmarch | farm |  | 5 | 20 |
| Katla's Farm | Haafingar | farm |  | 6 | 20 |
| Kolskeggr Mine | the Reach | wilderness |  | 7 | 20, 45 |
| Loreius Farm | the Pale | farm |  | 6 | 20 |
| Merryfair Farm | the Rift | farm |  | 5 | 20 |
| Mixwater Mill | Eastmarch | wilderness |  | 4 | 20 |
| Half-moon Mill | Falkreath | wilderness |  | 4 | 20 |
| Pelagia Farm | Whiterun | farm |  | 1 | 20 |
| Salvius Farm | the Reach | farm |  | 4 | 20 |
| Sarethi Farm | the Rift | farm |  | 3 | 20 |
| Snow-Shod Farm | the Rift | farm |  | 6 | 20 |
| Solitude Sawmill | Haafingar | wilderness |  | 2 | 20 |
| Whistling Mine | Winterhold | wilderness |  | 2 | 30 |
| Alftand | Winterhold | dungeon | 2 | 12 | 45 |
| Swindler's Den | Whiterun | dungeon | 1 | 9 | 30, 45 |
| Angarvunde | the Rift | dungeon | 1 | 8 | 30 |
| Autumnshade Clearing | the Rift | dungeon | 1 | 4 | 30 |
| Avanchnzel | the Rift | dungeon | 2 | 12 | 45 |
| Blackreach | Winterhold | dungeon | 2 | 12 | 45 |
| Bleak Falls Barrow | Falkreath | dungeon | 1 | 8 | 30 |
| Bleakcoast Cave | Winterhold | cave | 1 | 4 | 30 |
| Bleakwind Basin | Whiterun | giant-camp |  | 3 | 240 |
| Bleakwind Bluff | the Reach | dungeon | 1 | 4 | 30 |
| Blind Cliff Cave | the Reach | cave | 1 | 8 | 30 |
| Blizzard Rest | the Pale | giant-camp |  | 3 | 240 |
| Bloated Man's Grotto | Falkreath | dungeon | 1 | 2 | 30 |
| The Mind Of A Madman | Haafingar | interior |  | 1 | 20 |
| Twilight Sepulcher | Falkreath | wilderness |  | 1 | 20 |
| Southfringe Sanctum | Falkreath | dungeon | 1 | 8 | 30 |
| Broken Fang Cave | Whiterun | cave | 1 | 5 | 30 |
| Broken Helm Hollow | the Rift | bandit-camp |  | 5 | 45 |
| Broken Tower Redoubt | the Reach | dungeon | 2 | 11 | 45 |
| Brood Cavern | Hjaalmarch | dungeon | 1 | 5 | 30 |
| Bruca's Leap Redoubt | the Reach | dungeon | 1 | 6 | 30 |
| Bthardamz | the Reach | dungeon | 2 | 12 | 45 |
| Broken Oar Grotto | Haafingar | bandit-camp |  | 7 | 45 |
| Chillwind Depths | Hjaalmarch | dungeon | 2 | 12 | 45 |
| Clearpine Pond | Haafingar | dungeon | 1 | 5 | 30 |
| Clearspring Tarn | the Rift | dungeon | 1 | 4 | 30 |
| Cradlecrush Rock | Eastmarch | giant-camp |  | 1 | 240 |
| Cragslane Cavern | Eastmarch | bandit-camp |  | 6 | 30, 45 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| Cragwallow Slope | Eastmarch | dungeon | 1 | 8 | 30 |
| Cronvangr Hall | Eastmarch | dungeon | 1 | 8 | 30 |
| Crystaldrift Cave | the Rift | dungeon | 1 | 7 | 30 |
| Darklight Tower | the Rift | dungeon | 1 | 8 | 30 |
| Darkshade Copse | Falkreath | dungeon | 1 | 6 | 30 |
| Darkwater Pass | the Rift | dungeon | 1 | 8 | 30 |
| Dead Crone Rock | the Reach | dungeon | 1 | 8 | 30 |
| Dead Men's Respite | Hjaalmarch | dungeon | 1 | 8 | 30 |
| Deepwood Redoubt | the Reach | dungeon | 1 | 8 | 30 |
| Dragontooth Crater | the Reach | dungeon | 1 | 3 | 30 |
| Eldersblood Peak | Hjaalmarch | dungeon | 3 | 4 | 60 |
| Skyborn Altar | Hjaalmarch | dungeon | 1 | 5 | 30 |
| Ancient's Ascent | Falkreath | dungeon | 1 | 2 | 30 |
| Dragon Lair 3 | Falkreath | wilderness |  | 1 | 20 |
| Autumnwatch Tower | the Rift | dungeon | 1 | 6 | 30 |
| Northwind Summit | the Rift | dungeon | 1 | 3 | 30 |
| Lost Tongue Overlook | the Rift | dungeon | 1 | 3 | 30 |
| Bonestrewn Crest | Eastmarch | dungeon | 1 | 8 | 30 |
| Steamcrag Camp | Eastmarch | giant-camp |  | 2 | 240 |
| Driftshade Sanctuary | Winterhold | dungeon | 1 | 1 | 30 |
| Druadach Redoubt | the Reach | cave | 2 | 1 | 45 |
| Red Eagle Redoubt | the Reach | dungeon | 1 | 8 | 30 |
| Dushnikh Yal | the Reach | wilderness |  | 1 | 20 |
| Duskglow Crevice | the Pale | dungeon | 2 | 11 | 45 |
| Dustman's Cairn | the Reach | dungeon | 1 | 8 | 30 |
| Evergreen Grove | Falkreath | dungeon | 1 | 2 | 30 |
| Faldar's Tooth | the Rift | bandit-camp |  | 20 | 45 |
| Fallowstone Cave | the Rift | dungeon | 1 | 8 | 30 |
| Fellglow Keep | Whiterun | dungeon | 1 | 8 | 30 |
| Folgunthur | Hjaalmarch | dungeon | 1 | 8 | 30 |
| Forelhost | the Rift | dungeon | 3 | 16 | 60 |
| Forsaken Cave | the Pale | cave | 1 | 8 | 30 |
| Fort Amol | Eastmarch | wilderness |  | 6 | 20, 45 |
| Fort Greymoor | Whiterun | wilderness |  | 8 | 45 |
| Fort Dunstad | the Pale | wilderness |  | 13 | 20, 45 |
| Fort Fellhammer | Winterhold | bandit-camp |  | 8 | 30, 45 |
| Fort Greenwall | the Rift | wilderness |  | 7 | 20, 45 |
| Fort Hraggstad | Haafingar | wilderness |  | 4 | 45 |
| Fort Kastav | Winterhold | wilderness |  | 4 | 45 |
| Fort Neugrad | Falkreath | wilderness |  | 5 | 20, 45 |
| Fort Snowhawk | Hjaalmarch | wilderness |  | 4 | 45 |
| Fort Sungard | the Reach | wilderness |  | 5 | 45 |
| Frostflow Lighthouse | Winterhold | dungeon | 2 | 12 | 45 |
| Gallows Rock | Eastmarch | bandit-camp |  | 2 | 45 |
| Geirmund's Hall | the Rift | dungeon | 1 | 8 | 30 |
| Glenmoril Coven | Falkreath | dungeon | 2 | 3 | 45 |
| Gloomreach | the Reach | dungeon | 2 | 12 | 45 |
| Graywinter Watch | Whiterun | dungeon | 1 | 2 | 30 |
| Greywater Grotto | Falkreath | dungeon | 1 | 5 | 30 |
| Cracked Tusk Keep | Falkreath | bandit-camp |  | 7 | 45 |
| Guldun Rock | Whiterun | giant-camp |  | 2 | 240 |
| Haemar's Shame | Falkreath | dungeon | 1 | 8 | 30 |
| Hag Rock Redoubt | the Reach | dungeon | 1 | 8 | 30 |
| Hag's End | the Reach | dungeon | 2 | 8 | 45 |
| Halldir's Cairn | Falkreath | dungeon | 1 | 8 | 30 |
| Halted Stream Camp | Whiterun | bandit-camp |  | 7 | 45 |
| Harmugstahl | the Reach | dungeon | 1 | 8 | 30 |
| High Gate Ruins | the Pale | dungeon | 3 | 16 | 60 |
| Hillgrund's Tomb | the Pale | dungeon | 1 | 8 | 30 |
| Brittleshin Pass | Falkreath | dungeon | 1 | 6 | 30 |
| Hob's Fall Cave | Winterhold | cave | 1 | 8 | 30 |
| Honeystrand Grove | the Rift | cave | 1 | 3 | 30 |
| Greenspring Hollow | Whiterun | dungeon | 1 | 1 | 30 |
| Ilinalta's Deep | Falkreath | dungeon | 1 | 8 | 30 |
| Irkngthand | the Pale | cave | 2 | 12 | 45 |
| Karthspire | the Reach | dungeon | 1 | 8 | 30 |
| Kilkreath Ruins | Haafingar | dungeon | 3 | 16 | 60 |
| Korvanjund | the Pale | dungeon | 2 | 12 | 45 |
| Labyrinthian | Hjaalmarch | dungeon | 3 | 16 | 60 |
| Largashbur | the Rift | wilderness |  | 2 | 20 |
| Liar's Retreat | the Reach | dungeon | 2 | 12 | 45 |
| Ysgramor's Tomb | Winterhold | dungeon | 1 | 8 | 30 |
| Lost Echo Cave | Falkreath | dungeon | 1 | 8 | 30 |
| Lost Knife Hideout | Eastmarch | bandit-camp |  | 16 | 30, 45 |
| Lost Valley Redoubt | the Reach | dungeon | 1 | 8 | 30 |
| Bilegulch Mine | Falkreath | bandit-camp |  | 4 | 30, 45 |
| Sons of Skyrim Military Camp | the Reach | dungeon | 1 | 4 | 30 |
| Imperial Military Camp | Eastmarch | dungeon | 1 | 2 | 30 |
| Sons of Skyrim Military Camp | the Rift | dungeon | 1 | 1 | 30 |
| Imperial Military Camp | the Rift | dungeon | 1 | 3 | 30 |
| Sons of Skyrim Military Camp | Falkreath | dungeon | 1 | 2 | 30 |
| Imperial Military Camp | Whiterun | dungeon | 1 | 1 | 30 |
| Sons of Skyrim Military Camp | Haafingar | dungeon | 1 | 2 | 30 |
| Sons of Skyrim Military Camp | Hjaalmarch | dungeon | 1 | 3 | 30 |
| Imperial Military Camp | the Pale | dungeon | 1 | 4 | 30 |
| Sons of Skyrim Military Camp | the Pale | dungeon | 1 | 1 | 30 |
| Imperial Military Camp | Winterhold | dungeon | 1 | 2 | 30 |
| Sons of Skyrim Military Camp | Winterhold | dungeon | 1 | 1 | 30 |
| Mor Khazgur | the Reach | wilderness |  | 1 | 20 |
| Morvunskar | Eastmarch | dungeon | 1 | 8 | 30 |
| Moss Mother Cavern | Falkreath | dungeon | 1 | 5 | 30 |
| Mount Anthor | Winterhold | dungeon | 1 | 7 | 30 |
| Mzinchaleft | Hjaalmarch | dungeon | 2 | 12 | 45 |
| Mzulft | Eastmarch | dungeon | 2 | 12 | 45 |
| Narzulbur | Eastmarch | wilderness |  | 3 | 20 |
| Nchuand-Zel | the Reach | dungeon | 2 | 12 | 45 |
| Nilheim | the Rift | bandit-camp |  | 1 | 45 |
| Northwatch Keep | Haafingar | dungeon | 2 | 2 | 45 |
| Orotheim | Hjaalmarch | bandit-camp |  | 5 | 45 |
| Pinemoon Cave | Haafingar | cave | 1 | 5 | 30 |
| Pinepeak Cavern | the Rift | cave | 2 | 2 | 45 |
| Pinewatch | Falkreath | dungeon | 1 | 8 | 30 |
| Potema's Catacombs | Haafingar | dungeon | 1 | 8 | 30 |
| Ragnvald | the Reach | dungeon | 3 | 16 | 60 |
| Ravenscar Hollow | Haafingar | dungeon | 2 | 6 | 45 |
| Reachcliff Cave | the Reach | cave | 1 | 8 | 30 |
| Reachwater Rock | the Reach | dungeon | 1 | 8 | 30 |
| Red Road Pass | the Pale | giant-camp |  | 2 | 240 |
| Redoran's Retreat | Whiterun | bandit-camp |  | 4 | 45 |
| Rimerock Burrow | Haafingar | dungeon | 2 | 2 | 45 |
| Saarthal | Winterhold | dungeon | 1 | 8 | 30 |
| Secunda's Shelf | Falkreath | giant-camp |  | 2 | 240 |
| Robber's Gorge | Hjaalmarch | bandit-camp |  | 9 | 45 |
| Shadowgreen Cavern | Haafingar | dungeon | 1 | 8 | 30 |
| Shimmermist Cave | Whiterun | cave | 2 | 12 | 45 |
| The Icerunner | Hjaalmarch | dungeon | 1 | 4 | 30 |
| Brinehammer | the Pale | dungeon | 1 | 7 | 30 |
| Pride of Tel Vos | Winterhold | dungeon | 1 | 4 | 30 |
| Winter War | Winterhold | bandit-camp |  | 4 | 45 |
| Orphan's Tear | Haafingar | dungeon | 1 | 3 | 30 |
| Shrouded Grove | the Pale | cave | 1 | 5 | 30 |
| Sightless Pit | Winterhold | dungeon | 2 | 12 | 45 |
| Silent Moons Camp | Whiterun | bandit-camp |  | 7 | 45 |
| Silverdrift Lair | the Pale | dungeon | 1 | 8 | 30 |
| Skuldafn | Eastmarch | dungeon | 1 | 8 | 30 |
| Sleeping Tree Camp | Whiterun | giant-camp |  | 4 | 30, 240 |
| Snapleg Cave | Eastmarch | cave | 2 | 12 | 45 |
| Snow Veil Sanctum | Winterhold | dungeon | 1 | 8 | 30 |
| Soljund's Sinkhole | the Reach | dungeon | 1 | 8 | 30 |
| Steepfall Burrow | Haafingar | dungeon | 1 | 5 | 30 |
| Stillborn Cave | Winterhold | dungeon | 2 | 12 | 45 |
| Stonehill Bluff | Hjaalmarch | giant-camp |  | 1 | 240 |
| Frostmere Crypt | the Pale | dungeon | 1 | 9 | 30, 45 |
| Nightcaller Temple | the Pale | dungeon | 2 | 12 | 45 |
| Talking Stone Camp | Hjaalmarch | giant-camp |  | 4 | 240 |
| Tolvald's Cave | the Rift | dungeon | 2 | 12 | 45 |
| Treva's Watch | the Rift | bandit-camp |  | 9 | 45 |
| Tumble Arch Pass | the Pale | giant-camp |  | 2 | 240 |
| Ustengrav | Hjaalmarch | bandit-camp |  | 10 | 45 |
| Uttering Hills Camp | Eastmarch | cave | 1 | 10 | 30, 45 |
| Valtheim Keep | Whiterun | bandit-camp |  | 6 | 45 |
| Volskygge | Haafingar | dungeon | 3 | 16 | 60 |
| Volunruud | the Pale | dungeon | 2 | 12 | 45 |
| Serpent's Bluff Redoubt | Whiterun | dungeon | 1 | 8 | 30 |
| White River Watch | Whiterun | bandit-camp |  | 9 | 45 |
| Witchmist Grove | Eastmarch | dungeon | 3 | 1 | 60 |
| Wolfskull Cave | Haafingar | cave | 1 | 8 | 30 |
| Yngol Barrow | Winterhold | dungeon | 1 | 1 | 30 |
| Yngvild | Winterhold | dungeon | 1 | 7 | 30 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 4 | 45 |
| open ground in Tamriel | Haafingar | wilderness |  | 4 | 45 |
| Saering's Watch | Solstheim | wilderness |  | 4 | 45 |
| WhiterunPLainsDistrict03 | Whiterun | city |  | 6 | 20 |
| DLC2ThirskMeadHallExterior01 | Solstheim | wilderness |  | 4 | 45 |
| Oakwood | Falkreath | city |  | 3 | 20 |
| Movarth's Lair | Hjaalmarch | dungeon | 1 | 8 | 30 |
| Ansilvund | Eastmarch | dungeon | 1 | 8 | 30 |
| open ground in DLC1HunterHQWorld | no hold | wilderness |  | 1 | 20 |
| Apocrypha | no hold | dungeon | 3 | 14 | 60 |
| POIBlackreach07 | no hold | wilderness |  | 1 | 45 |
| open ground in Blackreach | no hold | wilderness |  | 1 | 20 |
| open ground in Blackreach | no hold | wilderness |  | 2 | 20 |
| Dragon Bridge Farm | Haafingar | farm |  | 1 | 45 |
| East Empire Company Warehouse | Haafingar | wilderness |  | 1 | 20 |
| Northkeep | Falkreath | wilderness |  | 2 | 20, 45 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| Kagrenzel | Eastmarch | dungeon | 2 | 5 | 45 |
| open ground in Blackreach | no hold | wilderness |  | 1 | 45 |
| open ground in Blackreach | no hold | wilderness |  | 1 | 20 |
| BlackreachWeatherTest3 | no hold | wilderness |  | 1 | 45 |
| open ground in Blackreach | no hold | wilderness |  | 1 | 20 |
| open ground in Blackreach | no hold | wilderness |  | 2 | 20 |
| BlackreachWeatherTest2 | no hold | wilderness |  | 1 | 45 |
| open ground in Blackreach | no hold | wilderness |  | 2 | 20 |
| BlackreachTowers | no hold | wilderness |  | 1 | 45 |
| BlackreachCity | no hold | wilderness |  | 1 | 20 |
| BlackreachOverpass | no hold | wilderness |  | 1 | 45 |
| ThroatofTheWorldPath01 | Whiterun | wilderness |  | 6 | 20, 45 |
| Reeking Cave | Haafingar | cave | 1 | 1 | 30 |
| Volkihar Ruins | Haafingar | dungeon | 2 | 12 | 45 |
| Volkihar Undercroft | Haafingar | dungeon | 2 | 12 | 45 |
| DLC2 WarehouseSpiders | no hold | interior |  | 13 | 20 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 13 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 1 | 45 |
| SoulCairnTest | no hold | wilderness |  | 2 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 1 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 1 | 45 |
| DLC01SoulCairnOrigin | no hold | wilderness |  | 4 | 45 |
| 0BearQOrigin | no hold | wilderness |  | 2 | 20 |
| open ground in 0WHMiniBearQuestWorld | no hold | wilderness |  | 1 | 20 |
| Damphall Mine | Solstheim | dungeon | 2 | 15 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 1 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 1 | 45 |
| SoulCairnPOI06 | no hold | wilderness |  | 1 | 45 |
| The Midden | Winterhold | dungeon | 1 | 2 | 30 |
| DLC01SoulCairnCraterKeeper | no hold | wilderness |  | 3 | 45 |
| SoulCairnPOIRJ08 | no hold | wilderness |  | 4 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 1 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 3 | 45 |
| SoulCairnPOIRJ02 | no hold | wilderness |  | 2 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 1 | 45 |
| SoulCairnPOIRJ07 | no hold | wilderness |  | 1 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 1 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 1 | 45 |
| SoulCairnPOIRJ09 | no hold | wilderness |  | 2 | 45 |
| SoulCairnTome03 | no hold | wilderness |  | 2 | 45 |
| SoulCairnPOIRJ05 | no hold | wilderness |  | 2 | 20 |
| SoulCairnTest2 | no hold | wilderness |  | 2 | 45 |
| DLC01SoulCairnForestKeeper | no hold | wilderness |  | 2 | 45 |
| SoulCairnPOI03 | no hold | wilderness |  | 1 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 1 | 45 |
| SoulCairnPOI08 | no hold | wilderness |  | 3 | 45 |
| SoulCairnPOIMaze | no hold | wilderness |  | 2 | 45 |
| SCTest1 | no hold | wilderness |  | 2 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 2 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 1 | 45 |
| SoulCairnPOI05 | no hold | wilderness |  | 2 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 4 | 45 |
| SoulCairnPOI04 | no hold | wilderness |  | 3 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 1 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 1 | 45 |
| SoulCairnTome02 | no hold | wilderness |  | 4 | 45 |
| SoulCairnPOI01 | no hold | wilderness |  | 4 | 45 |
| SoulCairnStartAmbush | no hold | wilderness |  | 3 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 2 | 45 |
| DLC01SoulCairnCemetaryKeeper01 | no hold | wilderness |  | 1 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 2 | 45 |
| open ground in DLC01SoulCairn | no hold | wilderness |  | 1 | 45 |
| SoulCairnHuskMerchant | no hold | wilderness |  | 1 | 45 |
| open ground in Blackreach | no hold | wilderness |  | 4 | 20 |
| Lakeview Manor | Falkreath | wilderness |  | 4 | 20 |
| Apocrypha | no hold | dungeon | 3 | 8 | 60 |
| Bristleback Cave | Solstheim | cave | 1 | 8 | 30 |
| Valthume | the Reach | dungeon | 3 | 16 | 60 |
| open ground in BluePalaceWingWorld | no hold | wilderness |  | 1 | 45 |
| Ironbind Barrow | Winterhold | dungeon | 1 | 8 | 30 |
| Ebony Warrior's Camp | the Rift | wilderness |  | 1 | 30 |
| Apocrypha | no hold | wilderness |  | 3 | 45 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 3 | 20, 30 |
| WinterholdJailExteriorNew | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 3 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20, 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| Headwaters of Harstrad | Solstheim | wilderness |  | 2 | 20 |
| Frozen Caverns | Eastmarch | cave | 1 | 8 | 30 |
| Bloodskal Barrow | Solstheim | bandit-camp |  | 7 | 45 |
| Colcinder Cave | Solstheim | cave | 3 | 7 | 60 |
| The Estates' Edge | Falkreath | interior |  | 1 | 360 |
| Apocrypha | no hold | dungeon | 3 | 6 | 60 |
| The Ratway | the Rift | sewer | 1 | 2 | 30 |
| Moldering Ruins | Whiterun | dungeon | 1 | 5 | 30 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 3 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| Darkfall Cave | the Reach | cave | 2 | 12 | 45 |
| Whiterun Sewers | Whiterun | sewer | 1 | 8 | 30 |
| Windhelm Sewers | Eastmarch | sewer | 1 | 8 | 30 |
| Bronze Water Cave | the Pale | cave | 1 | 2 | 30 |
| Bannermist Tower | Falkreath | wilderness |  | 4 | 20, 45 |
| Roadside Ruins | Falkreath | wilderness |  | 1 | 45 |
| Peak's Shade Tower | Falkreath | dungeon | 1 | 1 | 30 |
| Crossroads Watchtower | Falkreath | dungeon | 1 | 1 | 30 |
| DLC1AncestorGladePortcullis | no hold | wilderness |  | 2 | 45 |
| open ground in DLC1AncestorsGladeWorld | no hold | wilderness |  | 1 | 45 |
| North Skybound Watch | Falkreath | dungeon | 1 | 8 | 30 |
| open ground in DLC1DarkfallPassageWorld | no hold | wilderness |  | 5 | 20 |
| Castle Volkihar | Haafingar | wilderness |  | 4 | 45 |
| Arkngthamz | Falkreath | dungeon | 2 | 12 | 45 |
| Redwater Den | the Rift | dungeon | 1 | 8 | 30 |
| Dimhollow Crypt | the Pale | cave | 1 | 8 | 30 |
| Granite Hill Crawl Space | Falkreath | dungeon | 2 | 12 | 45 |
| Markarth Sewers | the Reach | sewer | 1 | 8 | 30 |
| open ground in BrinewaterGrottoWorld | no hold | wilderness |  | 1 | 20 |
| BrinewaterGrottoStart | no hold | wilderness |  | 2 | 20 |
| Windstad Manor | Hjaalmarch | wilderness |  | 5 | 20 |
| Heljarchen Hall | the Pale | wilderness |  | 4 | 20 |
| Abandoned Shack | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in DLC01Boneyard | no hold | wilderness |  | 15 | 45 |
| Markarth Ruins | the Reach | dungeon | 2 | 4 | 45 |
| Obscured Passage | the Reach | dungeon | 1 | 4 | 30 |
| open ground in DLC1DarkfallPassageWorld | no hold | wilderness |  | 1 | 45 |
| open ground in DLC1DarkfallPassageWorld | no hold | wilderness |  | 1 | 45 |
| open ground in DLC1DarkfallPassageWorld | no hold | wilderness |  | 1 | 45 |
| open ground in DLC1DarkfallPassageWorld | no hold | wilderness |  | 1 | 45 |
| DLC1DarkfallPassageEndStart | no hold | wilderness |  | 1 | 60 |
| open ground in DLC1DarkfallPassageWorld | no hold | wilderness |  | 4 | 20, 60 |
| open ground in DLC1DarkfallPassageWorld | no hold | wilderness |  | 3 | 45 |
| WinterholdCollegeJailExterior | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 5 | 20, 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in BrinewaterGrottoWorld | no hold | wilderness |  | 1 | 20 |
| BrinewaterGrottoOrigin | no hold | wilderness |  | 3 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 4 | 20, 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 30 |
| Fort Sungard, Underworks | the Reach | sewer | 1 | 2 | 30 |
| Brinewater Grotto | Haafingar | wilderness |  | 5 | 20, 45 |
| Fort Greenwall, Underworks | the Rift | sewer | 1 | 5 | 30 |
| Sunderstone Gorge | Falkreath | dungeon | 1 | 8 | 30 |
| Reaper's Lair | no hold | dungeon | 2 | 4 | 45 |
| POIReach34 | the Reach | wilderness |  | 2 | 45 |
| Morvunskar Crypts | Eastmarch | dungeon | 2 | 12 | 45 |
| Shroud Hearth Barrow | the Rift | dungeon | 1 | 8 | 30 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 3 | 20 |
| DLC1IcewaterJetty | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 30 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | no hold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 30 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| POIReach10 | the Reach | wilderness |  | 2 | 45 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 60 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 60 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| DragonMoundReach03 | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20, 60 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 30 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| TestReach | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| POIReach05 | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| POIReach33 | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| POIReach03 | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 30 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| POIReach01 | the Reach | wilderness |  | 1 | 30 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| POIReach22b | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 30 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 3 | 20 |
| POIReach28 | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| aaLSDmaisonchamp | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| Quick Test Cell | no hold | interior |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| MarkarthPass | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| Oakwood Sewer | Falkreath | sewer | 1 | 2 | 30 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| Winterhold College | Winterhold | interior |  | 1 | 360 |
| Ruunvald Excavation | the Rift | dungeon | 2 | 3 | 45 |
| Dainty Sload | Haafingar | wilderness |  | 2 | 45 |
| open ground in DLC1HunterHQWorld | no hold | wilderness |  | 1 | 20 |
| DLC1HunterWorldStart | no hold | wilderness |  | 1 | 20 |
| open ground in DLC1HunterHQWorld | no hold | wilderness |  | 3 | 20, 45 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 1 | 20 |
| Stony Creek Cave | Eastmarch | cave | 1 | 5 | 30 |
| Sharpslope Cave | no hold | cave | 2 | 5 | 45 |
| open ground in Tamriel | Winterhold | wilderness |  | 6 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| POINorthernCoast18 | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 3 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| Knifepoint Ridge | Falkreath | bandit-camp |  | 8 | 30, 45 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| Mossy Glen Cave | the Rift | cave | 2 | 5 | 45 |
| open ground in Tamriel | the Pale | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 4 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 4 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 30 |
| POINorthernCoast14 | the Pale | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20, 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| POINorthernCoast01 | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 45 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| POINorthernCoast21 | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| POISnowy16 | the Pale | wilderness |  | 2 | 45 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 3 | 20 |
| DragonMoundSnowy01 | the Pale | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| POINorthernCoast13 | Winterhold | wilderness |  | 2 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| POISnowy31 | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20, 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 3 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 30 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 45 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 3 | 20, 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| POISnowy12 | Winterhold | wilderness |  | 2 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 3 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| POISnowy24 | Winterhold | wilderness |  | 2 | 45 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| POISnowy09 | Hjaalmarch | wilderness |  | 3 | 30 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| Raldbthar | the Pale | dungeon | 2 | 12 | 45 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 20, 30 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| POISnowy27a | Hjaalmarch | wilderness |  | 1 | 30 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| StonehillBluffExterior04 | Hjaalmarch | wilderness |  | 1 | 45 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 30 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 30 |
| POISnowy25 | the Pale | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 30 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 20, 45 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| POISnowy28 | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 45 |
| POITundra03 | the Pale | wilderness |  | 2 | 45 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 30 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 45 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| POITundra07 | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20, 45 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| Wilderness | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 3 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 30 |
| OrphansTearExterior02 | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 6 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| POINorthernCoast17 | Hjaalmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| POINorthernCoast08 | Haafingar | wilderness |  | 2 | 60 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 30 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 30 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 30 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 30 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 45 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 45 |
| open ground in Tamriel | Haafingar | wilderness |  | 3 | 20 |
| IrontreeMillExterior | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| POINorthernCoast11 | Haafingar | wilderness |  | 1 | 30 |
| Shrine of Azura | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 30 |
| open ground in Tamriel | the Pale | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 3 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 30 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 3 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 30 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| POISnowy02 | Hjaalmarch | wilderness |  | 1 | 45 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 30 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| POITundra25 | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 3 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 3 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| POIReach09 | Haafingar | wilderness |  | 1 | 60 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 4 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| POITundra39 | Haafingar | wilderness |  | 3 | 20, 45 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 30 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| TestFrozenMarsh | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| POINorthernCoast07 | Hjaalmarch | wilderness |  | 6 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 30 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 4 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 3 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 3 | 30 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 5 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 30 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | Haafingar | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| POITundra18 | Hjaalmarch | wilderness |  | 1 | 45 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| POITundra23 | Hjaalmarch | wilderness |  | 1 | 60 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 60 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 30 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| DragonMoundTundraMarsh03 | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| LabyrinthianExterior04 | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| POITundra20 | Hjaalmarch | wilderness |  | 1 | 60 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 60 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 30 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| LabyrinthianExterior05 | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| POISnowy05 | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| JaphetsFollyMarkers | no hold | wilderness |  | 2 | 45 |
| JaphetsFollyOrigin | no hold | wilderness |  | 3 | 45 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| MilitaryCampReachSonsOLD | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| Whiterun Catacombs | Whiterun | dungeon | 1 | 3 | 30 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 45 |
| POIReach32 | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| POITundra27 | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 60 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 45 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 30 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20, 240 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| POITundra28 | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 45 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 4 | 20, 30 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 5 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Hjaalmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 4 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20, 30 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| POITundra12 | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20, 30 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| POIVolcanicTundra10 | Eastmarch | wilderness |  | 2 | 20, 45 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| POITundra01 | Whiterun | wilderness |  | 1 | 45 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 4 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 4 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| TestVolcanicTundra | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| POITundra06 | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 4 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Pale | wilderness |  | 4 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| POIVolcanicTundra03 | Eastmarch | wilderness |  | 1 | 45 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 30, 45 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| RiverwoodPath | Whiterun | wilderness |  | 1 | 30 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| POIFallForest25 | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| BleakFallsTower | Falkreath | wilderness |  | 3 | 45 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 3 | 20, 60 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20, 45 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 45 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| POIFallForest11 | the Rift | wilderness |  | 1 | 20 |
| HHpathShrine02 | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 30 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 30 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 30 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20, 30 |
| POIPineForest12 | Falkreath | wilderness |  | 2 | 45 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| HHPathShrine03 | Whiterun | wilderness |  | 2 | 20, 30 |
| HHpathShrine05 | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| HelgenRiverwoodCrossroads | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| POIFallForest12b | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| POIFallForest10 | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| POIFallForest24 | the Rift | wilderness |  | 1 | 45 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 30 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 60 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| TestWispExt02 | Falkreath | wilderness |  | 1 | 20 |
| TestFallForest | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| POIPineForest23 | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 30 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 30 |
| open ground in Tamriel | Falkreath | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| DragonMoundFallForest03 | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 60 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 45 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 45 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| POIFallForest29 | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| E3 Bleak Falls Barrow | Falkreath | dungeon | 1 | 8 | 30 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 240 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| POIReach14b | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| POITundra36 | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| POITundra29 | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| POITundra32 | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 240 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| POITundra11b | Whiterun | wilderness |  | 2 | 20, 45 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| POITundra10 | Whiterun | wilderness |  | 5 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| POIReach16 | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| POITundra11 | Whiterun | wilderness |  | 3 | 20, 45 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 3 | 20 |
| POIReach17 | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Whiterun | wilderness |  | 2 | 45 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 60 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 30 |
| open ground in Tamriel | Whiterun | wilderness |  | 3 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 2 | 20 |
| DragonMoundTundra01 | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Reach | wilderness |  | 2 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 2 | 20 |
| DragonMoundPineForest03 | Falkreath | wilderness |  | 1 | 20 |
| POIPineForest10 | Falkreath | wilderness |  | 1 | 20 |
| POIPineForest11 | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 2 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 2 | 20 |
| POITundra08 | Falkreath | wilderness |  | 4 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| POIPineForest02 | Falkreath | wilderness |  | 2 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 4 | 20, 45 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| POIPineForest25 | Falkreath | wilderness |  | 2 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| POIPineForest04 | Falkreath | wilderness |  | 2 | 30 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| POIPineForest24 | Falkreath | wilderness |  | 1 | 45 |
| POIPineForest13 | Falkreath | wilderness |  | 1 | 45 |
| open ground in Tamriel | Falkreath | wilderness |  | 3 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 2 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 2 | 20 |
| POIPineForest06 | Falkreath | wilderness |  | 2 | 20 |
| POIPineForest20 | Falkreath | wilderness |  | 2 | 45 |
| POIPineForest21 | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| POIPineForest29 | Falkreath | wilderness |  | 3 | 30 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| POITundra26 | Falkreath | wilderness |  | 2 | 45 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 3 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 2 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 3 | 30 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| POIPineForest17 | Falkreath | wilderness |  | 2 | 45 |
| open ground in Tamriel | Falkreath | wilderness |  | 3 | 20 |
| POIPineForest33 | Falkreath | wilderness |  | 2 | 45 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 30 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| POIPineForest19 | Falkreath | wilderness |  | 2 | 60 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 2 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| open ground in Tamriel | Falkreath | wilderness |  | 1 | 20 |
| Goldenglow Estate Sewer | the Rift | sewer | 1 | 7 | 30 |
| Shriekwind Bastion | Falkreath | dungeon | 1 | 8 | 30 |
| The Ratway Vaults | the Rift | sewer | 1 | 4 | 30 |
| The Midden Dark | Winterhold | dungeon | 1 | 5 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 3 | 20, 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| Dragon Bridge Overlook | the Reach | wilderness |  | 2 | 45 |
| Cradle Stone Tower | the Reach | wilderness |  | 2 | 20, 45 |
| Four Skull Lookout | the Reach | bandit-camp |  | 3 | 45 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 3 | 20, 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20, 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 4 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| POINorthernCoast06b | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| POINorthernCoast19 | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| POINorthernCoast06a | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20, 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 4 | 20 |
| POISnowy20 | Winterhold | wilderness |  | 3 | 20 |
| POINorthernCoast05 | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 3 | 30, 45 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 3 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| RockjointIslandExterior02 | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| KarliahCampsiteExterior | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| RockjointIslandExteriorOld | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20, 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 3 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 20 |
| open ground in Tamriel | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20, 30 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 30 |
| open ground in Tamriel | Winterhold | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 30 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 30 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| POISnowy18 | Eastmarch | wilderness |  | 1 | 20 |
| POIVolcanicTundra02 | Eastmarch | wilderness |  | 3 | 30 |
| open ground in Tamriel | Eastmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 3 | 30 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| Embershard | Falkreath | bandit-camp |  | 8 | 30, 45 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20, 60 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 4 | 20, 45 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| POIVolcanicTundra14 | Eastmarch | wilderness |  | 1 | 45 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| POIVolcanicTundra15 | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| MzulftExterior02 | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 3 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| DragonMoundVolcanicTundra01 | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 45 |
| POIVolcanicTundra13 | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| POIVolcanicTundra09 | Eastmarch | wilderness |  | 3 | 45 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 30 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 5 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 4 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 1 | 20 |
| open ground in Tamriel | Eastmarch | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| POIVolcanicTundra12 | the Rift | wilderness |  | 3 | 30 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| DLC1RuunvaldExit | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| POIFallForest17 | the Rift | wilderness |  | 2 | 30 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 3 | 20 |
| TESTLOD | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| The Katariah | Haafingar | dungeon | 1 | 2 | 30 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| Cold Rock Pass | Whiterun | wilderness |  | 2 | 30, 45 |
| Weynon Stones | the Pale | wilderness |  | 2 | 45 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| POIFallForest04 | the Rift | wilderness |  | 1 | 45 |
| open ground in Tamriel | the Rift | wilderness |  | 3 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| POIFallForest21 | the Rift | wilderness |  | 4 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 4 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| POIFallForest19 | the Rift | wilderness |  | 2 | 45 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 4 | 20, 30 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| SnowShodFarmExterior | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| DLC1DawnguardHQExt01 | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 30 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 4 | 20 |
| POIFallForest26 | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| DragonMoundFallForest01 | the Rift | wilderness |  | 2 | 20 |
| POIFallForest03 | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| POIFallForest27 | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 60 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| POIFallForest06 | the Rift | wilderness |  | 1 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 2 | 20 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 45 |
| open ground in Tamriel | the Rift | wilderness |  | 1 | 20 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 2 | 20 |
| TempleStart | no hold | wilderness |  | 4 | 45 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 1 | 45 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 1 | 45 |
| Traitor's Post | Eastmarch | wilderness |  | 4 | 45 |
| Windward Ruins | the Pale | wilderness |  | 2 | 20 |
| Snowpoint Beacon | Winterhold | bandit-camp |  | 2 | 45 |
| Yorgrim Overlook | the Pale | wilderness |  | 4 | 20, 45 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 2 | 45 |
| DLC1FVWayShrine01 | no hold | wilderness |  | 1 | 20 |
| KynesgroveBurialMound09 | Eastmarch | wilderness |  | 4 | 20 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 1 | 60 |
| DLC1FalmerValleyPOI04 | no hold | wilderness |  | 1 | 45 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 1 | 20 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 1 | 45 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 2 | 45 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 1 | 20 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 3 | 20, 45 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 1 | 60 |
| DLC1FalmerValleyPOI02 | no hold | wilderness |  | 1 | 20 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 2 | 45 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 1 | 45 |
| FalmerTempleExterior01 | no hold | wilderness |  | 1 | 45 |
| FalmerPlayground | no hold | wilderness |  | 2 | 45 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 1 | 45 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 2 | 20 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 2 | 45 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 2 | 20 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 1 | 60 |
| FalmerValleyStart | no hold | wilderness |  | 3 | 20, 60 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 1 | 60 |
| DLC1FalmerValleyPOI07 | no hold | wilderness |  | 4 | 20, 45 |
| DLC1FalmerValleyPOI06 | no hold | wilderness |  | 1 | 45 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 1 | 45 |
| Froki's Shack | the Rift | wilderness |  | 3 | 20 |
| Rift Watchtower | the Rift | bandit-camp |  | 4 | 45 |
| Rkund | the Rift | wilderness |  | 3 | 45 |
| Shor's Watchtower | the Rift | wilderness |  | 1 | 20 |
| Bthalft | the Rift | bandit-camp |  | 3 | 45 |
| The Apprentice Doomstone | Hjaalmarch | wilderness |  | 3 | 20 |
| The Atronach Doomstone | Eastmarch | wilderness |  | 1 | 20 |
| The Lord Doomstone | Hjaalmarch | wilderness |  | 3 | 45 |
| The Ritual Doomstone | Whiterun | wilderness |  | 1 | 45 |
| The Serpent Doomstone | Winterhold | wilderness |  | 2 | 20, 45 |
| The Shadow Doomstone | the Rift | wilderness |  | 1 | 45 |
| The Tower Doomstone | Winterhold | wilderness |  | 1 | 30 |
| open ground in Tamriel | Falkreath | wilderness |  | 218 | 20, 30, 45, 60, 240 |
| Solitude Catacombs | Haafingar | dungeon | 1 | 3 | 30 |
| CWMission07ImperialCamp01 | Hjaalmarch | wilderness |  | 1 | 20 |
| CWMission07SonsCamp02 | the Rift | wilderness |  | 3 | 20 |
| Lund's Hut | Whiterun | interior |  | 6 | 20 |
| Drelas Cottage | Whiterun | wilderness |  | 5 | 20 |
| Warehouses | Falkreath | interior |  | 3 | 20 |
| open ground in DLC01FalmerValley | no hold | wilderness |  | 5 | 45 |
| Valkygg | Hjaalmarch | dungeon | 3 | 1 | 60 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 3 | 20 |
| DLC2POIDragonMound01DB | Solstheim | wilderness |  | 3 | 20 |
| DLC2POIJS04 | Solstheim | wilderness |  | 2 | 20 |
| Abandoned Prison | Eastmarch | dungeon | 1 | 3 | 30 |
| Riverside Shack | Eastmarch | wilderness |  | 1 | 20 |
| Mara's Eye Pond | Eastmarch | dungeon | 1 | 7 | 30 |
| Broken Limb Camp | Eastmarch | giant-camp |  | 2 | 240 |
| DLC2POINorth03DB | Solstheim | wilderness |  | 4 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 2 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 3 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 3 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 2 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 4 | 30, 45, 60 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 20 |
| DLC2POINorthRJ01 | Solstheim | wilderness |  | 4 | 20 |
| DLC2POINorth01DB | Solstheim | wilderness |  | 2 | 20, 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 30 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 2 | 30 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 30 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 3 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 2 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 2 | 30 |
| DLC2POINorthRJ03 | Solstheim | wilderness |  | 1 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 2 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 20 |
| DLC2POIWestRJ01 | Solstheim | wilderness |  | 3 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 2 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 2 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 60 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 3 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 2 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 2 | 45 |
| DLC2POINorthRJ02 | Solstheim | wilderness |  | 1 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 45 |
| DLC2POIEast01DB | Solstheim | wilderness |  | 3 | 20, 30, 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 20 |
| DLC2POIEast02DB | Solstheim | wilderness |  | 2 | 20 |
| DLC2POIAsh02 | Solstheim | wilderness |  | 2 | 20 |
| DLC2POISpider02 | Solstheim | wilderness |  | 2 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 3 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 45 |
| DLC2POIAsh03DB | Solstheim | wilderness |  | 2 | 45 |
| DLC2POIAsh01 | Solstheim | wilderness |  | 2 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 4 | 45 |
| DLC2POIAsh04DB | Solstheim | wilderness |  | 3 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 45 |
| DLC2TelMithrynGraveyard | Solstheim | wilderness |  | 3 | 20, 45 |
| DLC2POIJS03 | Solstheim | wilderness |  | 2 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 4 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 45 |
| Hamvir's Rest | Whiterun | wilderness |  | 4 | 45 |
| Widow's Watch Ruins | Haafingar | wilderness |  | 1 | 45 |
| Skytemple Ruins | Winterhold | wilderness |  | 7 | 20, 45 |
| Pinefrost Tower | Haafingar | wilderness |  | 2 | 30 |
| TestAsh01 | Solstheim | wilderness |  | 2 | 20, 45 |
| DLC2POIAsh01DB | Solstheim | wilderness |  | 3 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 3 | 45 |
| DLC2POIJS01 | Solstheim | wilderness |  | 2 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 2 | 20 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 4 | 20 |
| DLC2POIAshRJ01 | Solstheim | wilderness |  | 3 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 3 | 20 |
| DLC2POIAsh02DB | Solstheim | wilderness |  | 1 | 45 |
| Ironback Hideout | Haafingar | wilderness |  | 3 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 45 |
| Journeyman's Nook | Winterhold | wilderness |  | 1 | 45 |
| Refugees' Rest | Eastmarch | wilderness |  | 3 | 20, 30 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 3 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 1 | 45 |
| open ground in DLC2SolstheimWorld | Solstheim | wilderness |  | 2 | 20 |
| Boulderfall Cave | the Rift | dungeon | 1 | 2 | 30 |
| Arcwind Point | the Rift | wilderness |  | 9 | 30, 45 |
| Bonechill Passage | Falkreath | dungeon | 1 | 2 | 30 |
| Northwind Mine | the Rift | dungeon | 2 | 5 | 45 |
