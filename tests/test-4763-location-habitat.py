"""Habitat follows authored location types; display/editor names are not types."""
import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('habitat_fixtures', ROOT/'tests/test-npc-population.py')
F = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(F)
M = F.load_module('habitat_under_test', 'Build-NpcPopulation.py')


class HabitatTypes(unittest.TestCase):
    def habitat(self, place, editor, display):
        catalogue = F.Catalogue()
        cell = catalogue.tables[b'CELL'][catalogue.cells[place]]
        cell.update(interior=True, edid=editor, name=display)
        _, actor = catalogue.placement('vendor', place)
        return M.habitat_at(F.CAST.Cast(catalogue.tables), actor)[0]

    def test_warmaidens_is_a_town_shop_not_an_animal_den(self):
        self.assertEqual(self.habitat('city','WhiterunWarmaidens',"Warmaiden's"),'city')

    def test_house_editor_ids_do_not_turn_city_houses_into_mines(self):
        for editor, display in [('LeftHandMineSkaggisHouse',"Skaggi's House"),
                                ('LeftHandMineDaighresHouse',"Daighre's House"),
                                ('KolskeggrMinePavosHouse',"Pavo's House")]:
            with self.subTest(editor=editor):
                self.assertEqual(self.habitat('city',editor,display),'city')

    def test_a_cave_keyword_keeps_its_type_despite_a_misleading_room_name(self):
        self.assertEqual(self.habitat('cave','WhiterunWarmaidens',"Warmaiden's"),'cave')

    def test_real_typed_underground_habitats_survive_names_without_any_habitat_word(self):
        for place in ('sewer','cave','dungeon'):
            with self.subTest(place=place):
                self.assertEqual(self.habitat(place,'Room01','A quiet room'),place)

    def test_city_location_names_do_not_override_the_city_keyword(self):
        catalogue = F.Catalogue()
        cell = catalogue.tables[b'CELL'][catalogue.cells['city']]
        cell.update(interior=True,edid='Shop01',name='A shop')
        location = catalogue.tables[b'LCTN'][catalogue.locations['city']]
        location.update(edid='SewerViewTownLocation',name='Ratway View')
        _, actor = catalogue.placement('vendor','city')
        self.assertEqual(M.habitat_at(F.CAST.Cast(catalogue.tables),actor)[0],'city')

    def test_an_unproved_room_does_not_get_a_habitat_from_its_name(self):
        catalogue = F.Catalogue()
        cell = catalogue.tables[b'CELL'][catalogue.cells['wild']]
        cell.update(interior=True,edid='AnUnknownCave',name='A dungeon cave')
        _, actor = catalogue.placement('bandit','wild')
        self.assertEqual(M.habitat_at(F.CAST.Cast(catalogue.tables),actor)[0],'interior')


class AnnotationContract(unittest.TestCase):
    def setUp(self):
        self.catalogue = F.Catalogue()
        self.context = F.CAST.Cast(self.catalogue.tables)
        self.row = {'form':self.catalogue.cells['sewer'],'recordType':'CELL','habitat':'sewer',
                    'location':self.catalogue.locations['sewer'],'reason':'Authored underground sewer room, with its existing shared location cap.'}

    def read(self, rows):
        return self.read_text(json.dumps({'version':1,'places':rows}))

    def read_text(self, text):
        (ROOT/'temp').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='4763-annotations-',dir=ROOT/'temp') as folder:
            file = pathlib.Path(folder)/'habitats.json'
            file.write_text(text,encoding='utf8')
            return M.read_habitat_annotations(file,self.context)

    def test_existing_cell_and_location_group_are_accepted(self):
        loaded = self.read([self.row])
        self.assertEqual(loaded[self.row['form']]['location'],self.row['location'])

    def test_duplicate_record_aliases_are_refused(self):
        other = dict(self.row)
        local, plugin = self.row['form'].split(':')
        other['form'] = '00'+local.upper()+':'+plugin.lower()
        with self.assertRaises(ValueError):
            self.read([self.row,other])

    def test_missing_or_wrong_record_type_is_refused(self):
        for changes in ({'form':'ffffff:Skyrim.esm'},{'recordType':'NPC_'},
                        {'form':self.catalogue.locations['sewer']}):
            with self.subTest(changes=changes),self.assertRaises(ValueError):
                self.read([dict(self.row,**changes)])

    def test_cap_role_and_unrelated_group_overrides_are_refused(self):
        for changes in ({'cap':100},{'role':'trader'},{'location':self.catalogue.locations['cave']},
                        {'habitat':'invented'},{'reason':'  '}):
            with self.subTest(changes=changes),self.assertRaises(ValueError):
                self.read([dict(self.row,**changes)])

    def test_invalid_document_versions_and_shapes_are_refused(self):
        for document in ([],{}, {'version':True,'places':[]},{'version':2,'places':[]},
                         {'version':1,'places':{}},{'version':1,'places':[],'cap':100}):
            with self.subTest(document=document),self.assertRaises(ValueError):
                self.read_text(json.dumps(document))

    def test_duplicate_json_fields_are_refused(self):
        with self.assertRaisesRegex(ValueError,'Duplicate'):
            self.read_text('{"version":1,"version":1,"places":[]}')

    def test_unhashable_field_types_and_invalid_descriptors_are_refused(self):
        for changes in ({'recordType':[]},{'habitat':[]},{'form':None},{'form':'0:Skyrim.esm'},
                        {'form':'123:../Skyrim.esm'},{'location':[]}):
            with self.subTest(changes=changes),self.assertRaises(ValueError):
                self.read([dict(self.row,**changes)])

    def test_an_exterior_cell_cannot_be_an_underground_annotation(self):
        self.catalogue.tables[b'CELL'][self.row['form']]['interior'] = False
        with self.assertRaisesRegex(ValueError,'interior'):
            self.read([self.row])

    def test_loaded_annotations_preserve_an_untyped_underground_cell_and_group(self):
        cell = self.catalogue.tables[b'CELL'][self.row['form']]
        cell['location'] = self.catalogue.locations['city']
        self.row['location'] = self.catalogue.locations['city']
        self.catalogue.cells['sewer'] = self.row['form']
        _, actor = self.catalogue.placement('bandit','sewer')
        actor['location'] = self.catalogue.locations['city']
        self.context.habitat_annotations = self.read([self.row])
        self.assertEqual(M.habitat_at(self.context,actor),('sewer',self.row['location']))


if __name__ == '__main__':
    unittest.main()
