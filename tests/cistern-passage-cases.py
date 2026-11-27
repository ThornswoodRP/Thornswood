"""Synthetic plugins through the real Last serializer; no game files."""
import importlib.util
import pathlib
import struct
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/mods'))
spec = importlib.util.spec_from_file_location('fixture_last', ROOT / 'scripts/mods/Build-LastPlugin.py')
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)
spec = importlib.util.spec_from_file_location('rift_fixture', ROOT / 'tests/riftweald-unlock-cases.py')
F = importlib.util.module_from_spec(spec); spec.loader.exec_module(F)
POLICY = {'cisternPassage': {'enabled': True}}
DOORS = [(0x16c1d, 0x4d233, 0x16d1e, 0x16be0, 'CrypttoGuildDoorBefore', False),
         (0x16d1e, 0x2d2ff, 0x16c1d, 0x16bd0, 'RiftenTGHQDirecttoSurfaceDoorBefore', False),
         (0x2d2dd, 0x49b02, 0x2d2fa, 0x16be0, 'CrypttoGuildDoorAfter', True),
         (0x2d2fa, 0x48b39, 0x2d2dd, 0x16bd0, 'RiftenTGHQDirecttoSurfaceDoorAfter', True)]


def vmad(name, props=(), quest=False):
    return L.vmad_write({'ver': 5, 'fmt': 2, 'scripts': [{'name': name.encode(), 'status': 0,
         'props': [{'name': key.encode(), 'type': 1, 'status': 1,
                    'value': {'fid': value, 'alias': -1, 'unused': 0}} for key,value in props]}],
         'quest': {'unk': 2, 'frags': [], 'file': b'', 'aliases': []} if quest else None, 'rest': b''})


def source(change=None, extra=()):
    pairs, flags = {}, {}
    for fid, base, to, cell, edid, after in DOORS:
        # Same placed position per side, distinct authored arrival transforms.
        pairs[fid] = [(b'EDID', edid.encode()+b'\0'), (b'NAME', struct.pack('<I',base)),
          (b'XTEL',struct.pack('<I6fI',to, *(range(6) if after else range(1,7)),0)),
          (b'XNDP',bytes(8)),(b'DATA',struct.pack('<6f',cell,2,3,4,5,6))]
        flags[fid] = 0x40000400 | (0x800 if after else 0)
        pairs[base] = [(b'EDID', (('RiftenRWPortholeDoor01' if cell==0x16be0 else 'RiftenRWHallLadderDoor01')+
                                 ('' if after else 'MinUse')).encode()+b'\0'), (b'FNAM',bytes([0 if after else 12]))]
        flags[base] = 0
    pairs[0xc730a] = [(b'VMAD',vmad('RiftenCasketDoorScript')),(b'NAME',struct.pack('<I',0xe9350)),
         (b'XAPD',b'\0'),(b'XAPR',struct.pack('<If',0xc7312,0)),(b'XAPR',struct.pack('<If',0xebec3,0)),
         (b'XLKR',struct.pack('<II',0,0xebec3)),(b'DATA',bytes(24))]
    flags[0xc730a]=0x40000400
    pairs[0xe9350]=[(b'EDID',b'RTMausoleumDoor\0'),(b'FNAM',b'\0')]; flags[0xe9350]=0
    pairs[0x1f326]=[(b'EDID',b'TG01\0'),(b'VMAD',vmad('TG01QuestScript',[(
         'pTG01Door'+('After' if after else 'Before')+('Outside' if cell==0x16be0 else 'Inside'),fid)
          for fid,base,to,cell,edid,after in DOORS],True))];flags[0x1f326]=0
    # A separate same-class placement must remain unchanged.
    pairs[0x12345]=[(b'NAME',struct.pack('<I',0xe9350)),(b'VMAD',vmad('RiftenCasketDoorScript')),(b'DATA',bytes(24))]
    flags[0x12345]=0x40000400
    if change: change(pairs,flags)
    def cell(fid, refs):
        body=F.record(b'CELL',fid,[(b'DATA',b'\1\0')])
        body+=F.group(struct.pack('<I',fid),6,F.group(struct.pack('<I',fid),8,b''.join(
             F.record(b'REFR',ref,pairs[ref],flags[ref]) for ref in refs)))
        return F.group(struct.pack('<i',0),2,F.group(struct.pack('<i',0),3,body))
    data=F.plugin([F.group(b'DOOR',0,b''.join(F.record(b'DOOR',base,pairs[base]) for base in (0x4d233,0x2d2ff,0x49b02,0x48b39))),
       F.group(b'ACTI',0,F.record(b'ACTI',0xe9350,pairs[0xe9350])),
       F.group(b'QUST',0,F.record(b'QUST',0x1f326,pairs[0x1f326])),
       F.group(b'CELL',0,cell(0x16be0,[0x16c1d,0x2d2dd,0xc730a,0x12345])+cell(0x16bd0,[0x16d1e,0x2d2fa]))])
    plugins=[L.read_plugin(data,'Skyrim.esm',0)]+list(extra)
    return plugins,L.winners(plugins,{b'REFR',b'DOOR',b'ACTI',b'QUST',b'CELL'})


class CisternTests(unittest.TestCase):
    def module(self):
        return getattr(L,'cistern_passage',None)

    def entries(self,plugins,win):
        module=self.module()
        return [] if module is None else module.entries(plugins,win,POLICY,L.subrecords,L.vmad_parse)

    def test_absent_policy_preserves_existing_builds(self):
        plugins,win=source();module=self.module()
        self.assertEqual(module.entries(plugins,win,{},L.subrecords,L.vmad_parse),[])
        self.assertIsNone(module.receipt({}))
        module.require_stopped({}, {})

    def test_route_uses_only_normal_pair_and_retires_physical_cover(self):
        plugins,win=source(); chosen=self.entries(plugins,win)
        self.assertEqual({e.fid for e,mode in chosen},{0x16c1d,0x16d1e,0x2d2dd,0x2d2fa,0xc730a})
        self.assertEqual({e.fid for e,mode in chosen if mode=='enable'},{0x2d2dd,0x2d2fa})
        self.assertNotIn(0x12345,{e.fid for e,mode in chosen})

    def test_changed_roles_refuse(self):
        def replace(p,fid,tag,body): p[fid]=[(t,body if t==tag else b) for t,b in p[fid]]
        changes=[lambda p,f:replace(p,0x2d2dd,b'XTEL',struct.pack('<I',0x16d1e)+bytes(28)),
          lambda p,f:replace(p,0x2d2fa,b'DATA',bytes(24)),
          lambda p,f:replace(p,0x49b02,b'FNAM',b'\x0c'),
          lambda p,f:p[0x2d2dd].append((b'XESP',bytes(8))),
          lambda p,f:p[0xc730a].append((b'XLOC',bytes(12))),
          lambda p,f:replace(p,0xc730a,b'XAPD',b'\1'),
          lambda p,f:replace(p,0xc730a,b'VMAD',vmad('OtherScript')),
          lambda p,f:f.update({0x2d2dd:0x40000400}),
          lambda p,f:replace(p,0x1f326,b'VMAD',vmad('TG01QuestScript',[],True))]
        for index,change in enumerate(changes):
            with self.subTest(index=index),self.assertRaises(SystemExit):
                plugins,win=source(change); self.entries(plugins,win)

    def test_custom_quest_or_external_enable_child_refuses(self):
        for tag,fields in [(b'QUST',[(b'ALFR',struct.pack('<I',0x2d2dd))]),
          (b'QUST',[(b'VMAD',vmad('ThornswoodQuest',[('Gate',0xc730a)],True))]),
          (b'REFR',[(b'NAME',struct.pack('<I',0xe9350)),(b'XESP',struct.pack('<II',0x16c1d,0))])]:
            with self.subTest(tag=tag),self.assertRaises(SystemExit):
                extra=L.read_plugin(F.plugin([F.group(tag,0,F.record(tag,0x1000042,fields))],['Skyrim.esm']),'Thornswood-Content.esp',1)
                plugins,win=source(extra=[extra]);self.entries(plugins,win)

    def test_nonvanilla_leaf_override_is_not_treated_as_vanilla(self):
        extra=L.read_plugin(F.plugin([F.group(b'REFR',0,F.record(b'REFR',0x2d2dd,[]))],['Skyrim.esm']),
                            'Thornswood-Content.esp',1)
        plugins,win=source(extra=[extra])
        with self.assertRaises(SystemExit): self.entries(plugins,win)

    def test_unrelated_windhelm_same_script_instance_is_not_selected(self):
        extra=L.read_plugin(F.plugin([F.group(b'ACTI',0,F.record(b'ACTI',0x1272d82,
            [(b'EDID',b'RTMausoleumDoorWH\0')])), F.group(b'REFR',0,F.record(b'REFR',0x126dc4d,
            [(b'NAME',struct.pack('<I',0x1272d82)),(b'VMAD',vmad('RiftenCasketDoorScript')),(b'DATA',bytes(24))]))],
             ['Skyrim.esm']),'WindhelmSSE.esp',1)
        plugins,win=source(extra=[extra]);chosen=self.entries(plugins,win)
        self.assertEqual(len(chosen),5)
        self.assertNotIn(0x126dc4d,[entry.fid for entry,mode in chosen])
        self.assertEqual(win[b'REFR',('windhelmsse.esp',0x26dc4d)].pi,1)

    def test_quest_kept_in_manifest_refuses(self):
        plugins,win=source();module=self.module()
        self.assertIsNotNone(module)
        with self.assertRaises(SystemExit):
            module.require_stopped({'quests':{'stopped':[]}},POLICY)

    def test_actual_serializer_recipe_and_missing_corrupt_final_controls(self):
        plugins,source_win=source(); src=plugins[0];module=self.module(); chosen=self.entries(plugins,source_win)
        self.assertEqual(len(chosen),5)
        rn=L.Renumber();rn.masters=['dummy.esm','skyrim.esm']
        made={'achr':[],'refr':[],'cell':{},'wrld':{},'qust':[],'lctn':[],'cobj':[],'alch':[]}
        for entry,mode in chosen:
            fields=module.copy_pairs(src,L.subrecords(src.data(entry)),rn,mode)
            made['refr'].append((rn.one(src,entry.fid,'fixture'),module.flags(entry,mode),L.pack_subrecords(fields),entry))
            ce=source_win[b'CELL',src.gid(entry.ctx[1])]
            made['cell'][src.gid(ce.fid)]=(rn.one(src,ce.fid,'fixture cell'),ce.flags,src.data(ce),ce)
        final=L.read_plugin(L.write_plugin(made,['Dummy.esm','Skyrim.esm'],plugins,rn),'Thornswood-Last.esp',1)
        recipe,_=L.make_recipe(final.buf,made,plugins)
        self.assertEqual(L.last_recipe.apply(recipe,lambda _:src.buf,lambda _:None),final.buf)
        allplugins=plugins+[final];win=L.winners(allplugins,{b'REFR'})
        receipt={'cisternPassage':module.receipt(POLICY),'quests':{'stopped':[{'quest':'1f326:Skyrim.esm'},{'quest':'21553:Skyrim.esm'}]}}
        def verify(rows=win):return module.verify(allplugins,source_win,rows,final,receipt,POLICY,L.subrecords,L.vmad_parse,rn)
        self.assertEqual(verify(),[])
        for entry,mode in chosen:
            actual=win[b'REFR',src.gid(entry.fid)]
            self.assertEqual(L.subrecords(final.data(actual)),module.copy_pairs(src,L.subrecords(src.data(entry)),rn,mode))
            original=dict(L.subrecords(src.data(entry))); output=dict(L.subrecords(final.data(actual)))
            for tag in (b'EDID',b'DATA',b'XAPD'):
                self.assertEqual(original.get(tag),output.get(tag))
            if b'XTEL' in original:
                self.assertEqual(original[b'XTEL'][4:],output[b'XTEL'][4:])
                self.assertEqual(src.gid(struct.unpack_from('<I',original[b'XTEL'])[0]),final.gid(struct.unpack_from('<I',output[b'XTEL'])[0]))
            self.assertEqual(bool(actual.flags&0x800),mode=='disable')
            omitted=dict(win);del omitted[b'REFR',src.gid(entry.fid)];self.assertTrue(verify(omitted))
            actual.flags^=0x800;self.assertTrue(verify());actual.flags^=0x800
        unrelated=win[b'REFR',('skyrim.esm',0x12345)]
        self.assertEqual(unrelated.pi,0)
        self.assertEqual(verify(),[])

if __name__=='__main__': unittest.main(verbosity=2)
