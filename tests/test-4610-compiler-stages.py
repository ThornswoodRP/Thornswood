"""Actual source compilers, synthetic records only; no game or native build."""
import importlib.util
import pathlib
import struct
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/mods'))

def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

C = module('content_4610', 'scripts/mods/Add-ContentRecords.py')
L = module('last_4610', 'scripts/mods/Build-LastPlugin.py')
SALT, GARLIC = '34cdf:Skyrim.esm', '34d22:Skyrim.esm'
BASE, SOURCE = 'e8448:Skyrim.esm', '8ad:Gourmet.esp'
ITEMS = ['1c0c6:Thornswood-Content.esp', '1c0c9:Thornswood-Content.esp']
RECIPES = ['1c0c8:Thornswood-Content.esp', '1c0cb:Thornswood-Content.esp']

def groups():
    result = {'items': {BASE: 'cooked'}, 'season': {'extras': {GARLIC:'guard', SALT:'stamina'},
              'recipes': {BASE:SOURCE}, 'dishes': {}}, 'quality': {'fine':{}}}
    for item, recipe, extra in zip(ITEMS, RECIPES, [GARLIC,SALT]):
        fine = '%x:Thornswood-Content.esp' % (int(item.split(':')[0],16)+1)
        result['items'][item]=result['items'][fine]='cooked'
        result['season']['dishes'][item]={'of':BASE,'extra':extra,'recipe':recipe}
        result['season']['dishes'][fine]={'of':BASE,'extra':extra}
        result['quality']['fine'][item]=fine
    return result

class Plugin:
    def __init__(self,name,masters,index):
        self.name,self.masters,self.index,self.localised=name,masters,index,False
        self.records={}
    def owner(self,fid): return (self.masters+[self.name])[fid>>24]
    def gid(self,fid): return (self.owner(fid).lower(),fid&0xffffff)
    def data(self,entry): return self.records[entry.fid]
    def add(self,fid,pairs):
        self.records[fid]=L.pack_subrecords(pairs)
        return SimpleNamespace(fid=fid,pi=self.index,tag=b'COBJ',flags=0)

def fixture():
    gourmet=Plugin('Gourmet.esp',['Skyrim.esm'],0)
    content=Plugin(C.PLUGIN,list(C.PLUGIN_MASTERS),1)
    ctda=bytearray(32); ctda[0]=0x60
    struct.pack_into('<f',ctda,4,1);struct.pack_into('<H',ctda,8,47);struct.pack_into('<I',ctda,12,0x10008ac)
    source=gourmet.add(0x10008ad,[(b'EDID',b'MAG_RecipeCookedSkeever\0'),(b'COCT',struct.pack('<I',2)),
        (b'CNTO',struct.pack('<Ii',0x10008ac,1)),(b'CNTO',struct.pack('<Ii',0x34cdf,1)),
        (b'CTDA',bytes(ctda)),(b'CNAM',struct.pack('<I',0xe8448)),(b'BNAM',struct.pack('<I',0xa5cb3)),(b'NAM1',struct.pack('<H',1))])
    win={(b'COBJ',L.ref_key(SOURCE)):source}
    for item,recipe in zip(ITEMS,RECIPES):
        fid=C.local_fid(recipe,list(C.PLUGIN_MASTERS),C.PLUGIN)
        entry=content.add(fid,[(b'EDID',C.zstr('ThornswoodRecipeSeasoned'+item.split(':')[0])),
            (b'COCT',struct.pack('<I',0)),(b'CTDA',C.NEVER_TRUE),(b'CNAM',struct.pack('<I',C.local_fid(item,list(C.PLUGIN_MASTERS),C.PLUGIN))),
            (b'BNAM',struct.pack('<I',0)),(b'NAM1',struct.pack('<H',1))])
        win[(b'COBJ',L.ref_key(recipe))]=entry
    return [gourmet,content],win

class Stages(unittest.TestCase):
    def test_content_shells_are_unusable_before_last(self):
        with patch.object(C,'food_groups',groups),patch.object(C,'dish_names',return_value={BASE:'Cooked Skeever'}),patch.object(C,'dish_look',return_value=[]):
            records=C.seasoned_records('unused','unused',list(C.PLUGIN_MASTERS),[])
        recipes=[r for r in records if r.tag==b'COBJ']
        self.assertEqual(len(recipes),2)
        for record in recipes:
            pairs=C.subrecords(record.data);data=dict(pairs)
            self.assertEqual(struct.unpack('<I',data[b'BNAM'])[0],0)
            self.assertIn((b'CTDA',C.NEVER_TRUE),pairs)
            self.assertFalse(any(t==b'CNTO' for t,_ in pairs))
    def test_full_order_preserves_external_meat_and_adds_exact_extra(self):
        plugins,win=fixture();entries=L.seasoned_recipe_entries(groups(),plugins,win,set())
        rn=L.Renumber();rn.masters=['skyrim.esm','gourmet.esp',C.PLUGIN.lower()]
        for entry in entries:
            pairs=L.seasoned_recipe_pairs(entry,plugins,rn,lambda *_:None)
            inputs={struct.unpack_from('<I',b)[0]:struct.unpack_from('<i',b,4)[0] for t,b in pairs if t==b'CNTO'}
            self.assertEqual(inputs[0x10008ac],1)
            self.assertEqual(inputs[0x34cdf],2 if entry['extra']==SALT else 1)
            self.assertEqual(inputs.get(0x34d22,0),1 if entry['extra']==GARLIC else 0)
            self.assertEqual(dict(pairs)[b'NAM1'],struct.pack('<H',1))
            self.assertEqual(struct.unpack('<I',dict(pairs)[b'CNAM'])[0],rn.gid(L.ref_key(entry['item'])))
            self.assertTrue(dict(pairs)[b'EDID'].startswith(b'ThornswoodRecipeSeasoned'))
            actual=[b for t,b in pairs if t==b'CTDA']
            expected=[rn.ctda(plugins[0],b,'fixture') for t,b in L.subrecords(plugins[0].data(win[(b'COBJ',L.ref_key(SOURCE))])) if t==b'CTDA']
            self.assertEqual(actual,expected)
    def test_missing_or_enabled_shell_is_refused(self):
        plugins,win=fixture();del win[(b'COBJ',L.ref_key(RECIPES[0]))]
        with self.assertRaises((ValueError,SystemExit)):L.seasoned_recipe_entries(groups(),plugins,win,set())
        plugins,win=fixture();entry=win[(b'COBJ',L.ref_key(RECIPES[0]))]
        plugins[1].records[entry.fid]=L.pack_subrecords([(t,struct.pack('<I',0xa5cb3) if t==b'BNAM' else b) for t,b in L.subrecords(plugins[1].data(entry))])
        with self.assertRaises((ValueError,SystemExit)):L.seasoned_recipe_entries(groups(),plugins,win,set())
    def test_cut_or_wrong_output_base_is_refused(self):
        plugins,win=fixture()
        with self.assertRaises((ValueError,SystemExit)):L.seasoned_recipe_entries(groups(),plugins,win,{L.ref_key(SOURCE)})
        entry=win[(b'COBJ',L.ref_key(SOURCE))]
        plugins[0].records[entry.fid]=L.pack_subrecords([(t,struct.pack('<I',0x123) if t==b'CNAM' else b) for t,b in L.subrecords(plugins[0].data(entry))])
        with self.assertRaises((ValueError,SystemExit)):L.seasoned_recipe_entries(groups(),plugins,win,set())

if __name__=='__main__':unittest.main()
