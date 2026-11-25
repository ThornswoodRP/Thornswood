"""Population policy against small winning-record tables, without game files."""
import copy
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEV = ROOT / "scripts" / "dev"
sys.path.insert(0, str(DEV))


def load_module(name, filename):
    path = DEV / filename
    if not path.is_file():
        raise AssertionError("Required population implementation is missing: " + filename)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


CAST = load_module("population_test_cast", "Build-CastTable.py")


def desc(number):
    return "%x:Skyrim.esm" % number


class Catalogue:
    def __init__(self):
        self.tables = {tag: {} for tag in CAST.WANTED}
        self.tables.update({b"ACHR": {}, b"REFR": {}})
        self.keywords = {}
        for index, name in enumerate([
            "ActorTypeNPC", "LocTypeHold", "LocTypeCity", "LocTypeTown",
            "LocTypeFarm", "LocTypeBanditCamp", "LocTypeGiantCamp",
            "LocTypeDungeon", "LocTypeCave", "LocTypeSewer", "LocTypeWilderness"
        ], 1):
            key = desc(index)
            self.keywords[name] = key
            self.tables[b"KYWD"][key] = {"edid": name}
        self.races = {}
        for index, name in enumerate([
            "NordRace", "WolfRace", "BearBrownRace", "GiantRace", "ChickenRace", "CowRace"
        ], 0x200):
            key = desc(index)
            self.races[name] = key
            self.tables[b"RACE"][key] = {"edid": name, "keywords":
                [self.keywords["ActorTypeNPC"]] if name == "NordRace" else []}
        self.factions = {}
        for index, (name, flags, sells) in enumerate([
            ("GuardFactionWhiterun", 0, None),
            ("ServicesWhiterunGeneralGoods", CAST.VENDOR, desc(0x900)),
            ("JobMerchantFaction", 0, None),
            ("WhiterunBanneredMareFaction", CAST.VENDOR, None),
            ("BanditFaction", 0, None), ("GiantFaction", 0, None),
        ], 0x400):
            key = desc(index)
            self.factions[name] = key
            self.tables[b"FACT"][key] = {"edid": name, "flags": flags, "sells": sells}
        self.world = desc(0x500)
        self.city_world = desc(0x501)
        self.tables[b"WRLD"][self.world] = {"edid": "Tamriel"}
        self.tables[b"WRLD"][self.city_world] = {"edid": "WhiterunWorld"}
        self.locations = {}
        self.cells = {}
        self.location("hold", "WhiterunHoldLocation", "LocTypeHold", None)
        self.location("city", "WhiterunLocation", "LocTypeCity", "hold")
        self.location("town", "RiverwoodLocation", "LocTypeTown", "hold")
        self.location("farm", "BattleBornFarmLocation", "LocTypeFarm", "hold")
        self.location("bandit", "HaltedStreamCampLocation", "LocTypeBanditCamp", "hold")
        self.location("giant", "SecundasKissLocation", "LocTypeGiantCamp", "hold")
        self.location("dungeon", "WhiterunCatacombsLocation", "LocTypeDungeon", "city")
        self.location("sewer", "WhiterunSewersLocation", "LocTypeSewer", "city")
        self.location("cave", "GreywinterWatchLocation", "LocTypeCave", "hold")
        self.location("wild", "WhiterunForestLocation", "LocTypeWilderness", "hold")
        self.bases = {}
        self.base("guard", "WhiterunGuard", "NordRace", ["GuardFactionWhiterun"])
        self.base("court", "BalgruufCourtMember", "NordRace")
        self.base("vendor", "WhiterunGuildTrader", "NordRace", ["ServicesWhiterunGeneralGoods"])
        self.base("bandit", "BanditMelee", "NordRace", ["BanditFaction"])
        self.base("giant", "EncGiant", "GiantRace", ["GiantFaction"])
        self.base("wolf", "EncWolf", "WolfRace")
        self.base("bear", "EncBrownBear", "BearBrownRace")
        self.base("chicken", "Chicken", "ChickenRace")
        self.base("cow", "Cow", "CowRace")

    def location(self, key, edid, keyword, parent):
        number = 0x600 + len(self.locations)
        identity = desc(number)
        self.locations[key] = identity
        self.tables[b"LCTN"][identity] = {"edid": edid, "name": edid,
            "keywords": [self.keywords[keyword]],
            "parent": self.locations.get(parent)}
        cell = desc(number + 0x100)
        self.cells[key] = cell
        self.tables[b"CELL"][cell] = {"edid": edid + "Cell", "location": identity,
            "interior": key in ("dungeon", "sewer", "cave"), "persistent": False,
            "world": self.city_world if key == "city" else self.world,
            "grid": (number, 0)}

    def base(self, key, edid, race, factions=(), rank=0):
        identity = desc(0x800 + len(self.bases))
        self.bases[key] = identity
        self.tables[b"NPC_"][identity] = {"edid": edid, "name": edid,
            "race": self.races[race], "factions": [(self.factions[f], rank) for f in factions],
            "uses": 0, "acbs": 0}
        return identity

    def placement(self, base, location, index=0x1000):
        identity = desc(index)
        cell = self.tables[b"CELL"][self.cells[location]]
        row = {"base": self.bases[base], "cell": self.cells[location],
            "world": cell["world"], "location": self.locations[location],
            "pos": (10.0, 10.0), "disabled": False, "deleted": False}
        self.tables[b"ACHR"][identity] = row
        return identity, row


class PopulationTests(unittest.TestCase):
    def test_transport_classification_sees_unlisted_active_factions(self):
        for edid, known, custom in [
            ('DLC2RRGjalundSaltSageWindhelm', None, 'CustomFerryFaction'),
            ('DLC2RRGjalundSaltSageWindhelm', None, 'CustomCarriageFaction'),
            ('KmodCarriageDriverWinterhold', 'JobCarriageFaction', 'CustomFerryFaction'),
            ('KmodFerrymanDragonBridge', 'DLC1FerrySystemFaction', 'CustomCarriageFaction'),
        ]:
            with self.subTest(edid=edid, custom=custom):
                self.setUp()
                factions = [name for name in [known, custom] if name]
                for index, name in enumerate(factions):
                    identity = desc(0xf000 + index)
                    self.catalogue.factions[name] = identity
                    self.catalogue.tables[b'FACT'][identity] = {'edid': name, 'flags': 0}
                self.catalogue.bases['transport'] = self.catalogue.base('transport', edid, 'NordRace', factions)
                ref, actor = self.catalogue.placement('transport', 'town')
                with self.assertRaisesRegex(ValueError, 'ambiguous'):
                    self.population.classify(CAST.Cast(self.catalogue.tables), ref, actor)

    def test_transport_classification_ignores_inactive_conflicting_factions(self):
        identity = desc(0xf000)
        self.catalogue.factions['CustomFerryFaction'] = identity
        self.catalogue.tables[b'FACT'][identity] = {'edid': 'CustomFerryFaction', 'flags': 0}
        base = self.catalogue.base('captain', 'DLC2RRGjalundSaltSageWindhelm',
                                   'NordRace', ['CustomFerryFaction'], rank=-1)
        self.catalogue.bases['captain'] = base
        ref, actor = self.catalogue.placement('captain', 'town')
        result = self.population.classify(CAST.Cast(self.catalogue.tables), ref, actor)
        self.assertTrue(result['keep'])
        self.assertEqual(result['displayName'], 'Ship Captain')

    def test_descriptive_transport_titles_use_source_role(self):
        self.assertEqual(self.population.transport_title('KmodCarriageDriverWinterhold', ['KmodFastTravelDialogueFaction']), 'Coach Driver')
        self.assertEqual(self.population.transport_title('KmodFerrymanDragonBridge', ['KmodFerryRoute1Faction']), 'Ferry Operator')
        self.assertEqual(self.population.transport_title('DLC2RRGjalundSaltSageWindhelm', []), 'Ship Captain')
        for faction in ['DLC1FerrySystemFaction', 'JobCarriageFaction']:
            with self.assertRaises(ValueError):
                self.population.transport_title('DLC2RRGjalundSaltSageWindhelm', [faction])
        with self.assertRaises(ValueError):
            self.population.transport_title('UnclassifiedService', ['KmodFastTravelDialogueFaction'])

    def test_authored_corpses_do_not_consume_live_encounter_capacity(self):
        ref, actor = self.catalogue.placement('bandit', 'dungeon')
        actor['startsDead'] = True
        result = self.population.classify(CAST.Cast(self.catalogue.tables), ref, actor)
        self.assertFalse(result['keep'])

    def test_named_creatures_without_unique_flag_are_cut(self):
        for name, family in [('Meeko', 'wolf'), ('Lord Tusk', 'bear'),
                             ('Old Salty', 'wolf'), ('Krosis', 'bandit')]:
            with self.subTest(name=name):
                self.setUp()
                self.catalogue.tables[b'NPC_'][self.catalogue.bases[family]]['name'] = name
                self.classify(family, 'wild', False)

    @classmethod
    def setUpClass(cls):
        cls.population = load_module("population_test_builder", "Build-NpcPopulation.py")
        if not callable(getattr(cls.population, "classify", None)):
            raise AssertionError("Population builder must expose classify(Cast, ref, actor)")

    def setUp(self):
        self.catalogue = Catalogue()

    def classify(self, base, location, keep, index=0x1000):
        ref, actor = self.catalogue.placement(base, location, index)
        result = self.population.classify(CAST.Cast(self.catalogue.tables), ref, actor)
        self.assertIsInstance(result, dict)
        for key in ("role", "reason", "habitat", "keep"):
            self.assertIn(key, result)
        self.assertTrue(result["role"])
        self.assertTrue(result["reason"])
        self.assertTrue(result["habitat"])
        self.assertIs(result["keep"], keep, (base, location, result))
        return result

    def test_a_race_that_swims_and_cannot_walk_is_marked_to_keep_to_water(self):
        # RACE DATA flags: 0x40 swims, 0x100 walks (#2067).
        fish = desc(0x2f0)
        self.catalogue.tables[b"RACE"][fish] = {"edid": "SlaughterfishRace", "keywords": [], "raceFlags": 0x40}
        self.catalogue.races["SlaughterfishRace"] = fish
        self.catalogue.base("fish", "EncSlaughterfish", "SlaughterfishRace")
        self.assertTrue(self.classify("fish", "wild", True)["swims"])
        self.catalogue.tables[b"RACE"][self.catalogue.races["WolfRace"]]["raceFlags"] = 0x40 | 0x100
        self.assertFalse(self.classify("wolf", "wild", True, 0x1001)["swims"], "A wolf that can swim still walks")

    def test_ambush_bases_are_marked(self):
        base = self.catalogue.base("ambush", "LvlDraugrAmbushMelee1HMale", "NordRace", ["BanditFaction"])
        self.catalogue.tables[b"NPC_"][base]["name"] = "Draugr"
        self.assertTrue(self.classify("ambush", "dungeon", True)["ambush"])
        self.assertFalse(self.classify("bandit", "dungeon", True, 0x1001)["ambush"])

    def test_test_worlds_and_test_interiors_are_cut_but_real_cells_named_test_are_not(self):
        cells = self.catalogue.tables[b"CELL"]
        # A worldspace the game keeps for testing (CWTestHold).
        self.catalogue.tables[b"WRLD"][self.catalogue.world]["edid"] = "CWTestHold"
        result = self.classify("wolf", "wild", False)
        self.assertEqual(result["reason"], "Test or holding cell, never in the world as placed")
        self.catalogue.tables[b"WRLD"][self.catalogue.world]["edid"] = "Tamriel"
        # Tamriel has real exterior cells named Test... (TestReach): kept.
        cells[self.catalogue.cells["wild"]]["edid"] = "TestReach"
        self.classify("wolf", "wild", True, 0x1001)
        # An interior that holds actors until a script moves them: cut.
        cells[self.catalogue.cells["cave"]]["edid"] = "WerewolfPreload"
        result = self.classify("wolf", "cave", False, 0x1002)
        self.assertEqual(result["reason"], "Test or holding cell, never in the world as placed")
        # A bank called Holdings is not a holding cell.
        cells[self.catalogue.cells["cave"]]["edid"] = "RiftenRethanHoldingsBank"
        self.assertNotEqual(self.classify("bandit", "cave", True, 0x1003)["reason"],
                            "Test or holding cell, never in the world as placed")

    def test_guards_and_courts_are_cut_from_city_and_open_world_town(self):
        for habitat in ("city", "town"):
            for base in ("guard", "court"):
                with self.subTest(base=base, habitat=habitat):
                    self.classify(base, habitat, False)

    def test_real_vendor_membership_survives_but_negative_rank_is_not_membership(self):
        self.classify("vendor", "city", True)
        self.catalogue.base("negative_vendor", "NegativeVendor", "NordRace",
                            ["ServicesWhiterunGeneralGoods"], -1)
        self.classify("negative_vendor", "city", False)

    def test_job_faction_and_owner_flag_without_vendor_list_do_not_make_traders(self):
        for faction in ("JobMerchantFaction", "WhiterunBanneredMareFaction"):
            self.catalogue.base("fake_vendor", "NotAGuildVendor", "NordRace", [faction])
            with self.subTest(faction=faction):
                self.classify("fake_vendor", "city", False)

    def test_bandit_and_giant_camps_survive_outside_the_city(self):
        self.classify("bandit", "bandit", True)
        self.classify("giant", "giant", True)
        self.classify("wolf", "wild", True)
        self.classify("bear", "wild", True)

    def test_camp_enemies_and_predators_do_not_belong_on_city_streets(self):
        for base in ("bandit", "giant", "wolf", "bear"):
            with self.subTest(base=base):
                self.classify(base, "city", False)

    def test_dungeon_and_sewer_habitats_override_their_city_parent(self):
        for habitat in ("dungeon", "sewer"):
            for base in ("bandit", "wolf"):
                with self.subTest(base=base, habitat=habitat):
                    self.classify(base, habitat, True)

    def test_farms_keep_domestic_animals_and_reject_a_bear(self):
        self.classify("cow", "farm", True)
        self.classify("chicken", "farm", True)
        self.classify("bear", "farm", False)

    def test_templates_supply_race_and_vendor_factions_instead_of_leftover_traits(self):
        child = self.catalogue.base("thin_vendor", "ThinVendor", "WolfRace",
                                   ["GuardFactionWhiterun"])
        self.catalogue.tables[b"NPC_"][child].update({
            "template": self.catalogue.bases["vendor"],
            "uses": CAST.USE_TRAITS | CAST.USE_FACTIONS})
        self.classify("thin_vendor", "city", True)
        child = self.catalogue.base("thin_bear", "ThinBear", "CowRace")
        self.catalogue.tables[b"NPC_"][child].update({
            "template": self.catalogue.bases["bear"], "uses": CAST.USE_TRAITS})
        self.classify("thin_bear", "farm", False)

    def test_leveled_template_resolves_its_real_vendor_traits(self):
        level = desc(0x900)
        self.catalogue.tables[b"LVLN"][level] = {"entries": [self.catalogue.bases["vendor"]]}
        child = self.catalogue.base("leveled_vendor", "LeveledVendor", "WolfRace")
        self.catalogue.tables[b"NPC_"][child].update({
            "template": level, "uses": CAST.USE_TRAITS | CAST.USE_FACTIONS})
        self.classify("leveled_vendor", "city", True)

    def test_winning_reference_changes_are_classified_once_from_the_current_row(self):
        ref, row = self.catalogue.placement("guard", "city")
        self.catalogue.tables[b"ACHR"][ref] = dict(row, base=self.catalogue.bases["vendor"])
        context = CAST.Cast(self.catalogue.tables)
        result = self.population.classify(context, ref, self.catalogue.tables[b"ACHR"][ref])
        self.assertTrue(result["keep"])
        self.assertEqual(len(self.catalogue.tables[b"ACHR"]), 1)

    def test_city_domestic_cap_uses_shared_deterministic_reference_order(self):
        rows = []
        for index in range(9):
            ref, actor = self.catalogue.placement("chicken", "city", 0x1000 + index)
            result = self.population.classify(CAST.Cast(self.catalogue.tables), ref, actor)
            self.assertTrue(result["keep"], "The cap must limit suitable animals, not remove them all")
            rows.append({**actor, **result, "ref": ref, "species": "chicken"})
        reordered = list(reversed(copy.deepcopy(rows)))
        self.population.assign_caps(rows)
        self.population.assign_caps(reordered)
        expected = set(sorted(row["ref"] for row in rows)[:6])
        self.assertEqual({row["ref"] for row in rows if row["keep"]}, expected)
        self.assertEqual({row["ref"] for row in reordered if row["keep"]}, expected)
        self.assertTrue(all(row["reason"] for row in rows if not row["keep"]))


    def make_transport(self, unique=False):
        faction = desc(0x950)
        self.catalogue.factions["CarriageSystemFaction"] = faction
        self.catalogue.tables[b"FACT"][faction] = {
            "edid": "CarriageSystemFaction", "flags": 0, "sells": None}
        base = self.catalogue.base("transport", "NamedCarriageDriver", "NordRace",
                                   ["CarriageSystemFaction"])
        if unique:
            self.catalogue.tables[b"NPC_"][base]["acbs"] = CAST.UNIQUE
        return base

    def test_unique_named_animals_and_enemy_leaders_are_cut(self):
        for key, edid, race, factions in (
            ("named_bear", "NamedBrownBear", "BearBrownRace", []),
            ("named_wolf", "NamedWolf", "WolfRace", []),
            ("named_bandit", "NamedBanditLeader", "NordRace", ["BanditFaction"]),
        ):
            base = self.catalogue.base(key, edid, race, factions)
            self.catalogue.tables[b"NPC_"][base]["acbs"] = CAST.UNIQUE
            with self.subTest(base=key):
                self.classify(key, "wild", False)

    def test_generic_unflagged_bear_and_bandit_chief_remain(self):
        self.catalogue.base("chief", "BanditChief", "NordRace", ["BanditFaction"])
        self.classify("bear", "wild", True)
        self.classify("chief", "bandit", True)

    def test_old_thalmor_titles_are_cut_without_a_unique_flag(self):
        for name in ("Thalmor Justiciar", "Thalmor Soldier", "Thalmor Wizard"):
            with self.subTest(name=name):
                self.setUp()
                self.catalogue.base("thalmor", "EncThalmor", "NordRace", ["BanditFaction"])
                self.catalogue.tables[b"NPC_"][self.catalogue.bases["thalmor"]]["name"] = name
                self.classify("thalmor", "wild", False)

    def test_unique_named_guild_traders_and_transport_are_preserved(self):
        self.catalogue.tables[b"NPC_"][self.catalogue.bases["vendor"]]["acbs"] = CAST.UNIQUE
        self.make_transport(unique=True)
        self.classify("vendor", "city", True)
        self.classify("transport", "wild", True)

    def test_interior_catacombs_override_a_city_location_without_dungeon_keyword(self):
        cell = self.catalogue.tables[b"CELL"][self.catalogue.cells["dungeon"]]
        cell.update(edid="WhiterunCatacombs", location=self.catalogue.locations["city"])
        ref, actor = self.catalogue.placement("bandit", "dungeon")
        actor["location"] = self.catalogue.locations["city"]
        context = CAST.Cast(self.catalogue.tables)
        (ROOT/'temp').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='npc-catacomb-', dir=ROOT/'temp') as folder:
            path = pathlib.Path(folder)/'habitats.json'
            path.write_text(json.dumps({'version':1,'places':[{'form':actor['cell'],'recordType':'CELL',
                'habitat':'dungeon','reason':'Explicit fixture catacomb below the city.'}]}),encoding='utf8')
            context.habitat_annotations = self.population.read_habitat_annotations(path,context)
        result = self.population.classify(context, ref, actor)
        self.assertTrue(result["keep"], result)
        self.assertEqual(result["habitat"], "dungeon")

    def test_hostile_vendor_faction_combination_does_not_make_a_city_guild_trader(self):
        self.catalogue.base("hostile_vendor", "HostileShopBandit", "NordRace",
                            ["BanditFaction", "ServicesWhiterunGeneralGoods"])
        self.classify("hostile_vendor", "city", False)

    def test_transport_stop_outside_city_world_survives_city_location_parent(self):
        self.make_transport()
        self.catalogue.location("stop", "WhiterunStableCarriageStop", "LocTypeWilderness", "city")
        result = self.classify("transport", "stop", True)
        self.assertEqual(result["role"], "transport")
        ref, actor = self.catalogue.placement("transport", "stop", 0x1001)
        actor["world"] = self.catalogue.city_world
        self.catalogue.tables[b"CELL"][actor["cell"]]["world"] = self.catalogue.city_world
        result = self.population.classify(CAST.Cast(self.catalogue.tables), ref, actor)
        self.assertFalse(result["keep"], "Transport stops inside the city world remain cut")

    def test_wilderness_bandits_have_a_shared_four_actor_tile_cap(self):
        rows = []
        for index in range(50):
            ref, actor = self.catalogue.placement("bandit", "wild", 0x2000 + index)
            actor["pos"] = (10.0 + index, 20.0, 0.0)
            result = self.population.classify(CAST.Cast(self.catalogue.tables), ref, actor)
            self.assertTrue(result["keep"], result)
            rows.append({**actor, **result, "ref": ref})
        reversed_rows = list(reversed(copy.deepcopy(rows)))
        self.population.assign_caps(rows)
        self.population.assign_caps(reversed_rows)
        expected = set(sorted(row["ref"] for row in rows)[:4])
        self.assertEqual({row["ref"] for row in rows if row["keep"]}, expected)
        self.assertEqual({row["ref"] for row in reversed_rows if row["keep"]}, expected)
        self.assertTrue(all(row["reason"] for row in rows if not row["keep"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
