'use strict';
const STATE=typeof MERCHANT_COMMISSION_STATE!=='undefined'?MERCHANT_COMMISSION_STATE:require('./merchant-commission-state');
const INVENTORY=typeof MERCHANT_SETTLEMENT!=='undefined'?MERCHANT_SETTLEMENT:require('./merchant-settlement');
const copy=value=>JSON.parse(JSON.stringify(value));
const hash=value=>require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Published jobs remain routable while their accepted promises exist.
const publication=Object.freeze({
 'q-whiterun-smith-straps':'8f03bdc903aaf1e37727f54a3e49bfdea5a2b817bc7534ba0111c88d25502734',
 'q-rift-woodworker-hunt-arrows':'84b31663cd265c9b26068ff7343622f04b332ddce394e58b52a55b0b6cbb3a89',
 'q-falkreath-tailor-mourning-thread':'8dded80c9b0e56c8a18158136ca200481a444582a41cc98000fe8ad612ec0aef',
 'q-haafingar-cook-dock-supper':'cfd57250d82ce20c23fa8db5c802509e103d6dd8c0e0a55654b1ed4da12c8a11',
 'q-hjaalmarch-alchemist-marsh-poultices':'5b8b08e462680c7249f9359498a84f1e1ccbc7ff30020ed1d15fbdd204703652',
 'q-whiterun-smith-spare-pick':'df7c54b9f75be97be6c525080c59640af7448efa017dc9d3ed0c7d5c649f00b0',
 'q-rift-woodworker-spare-pole':'5c443c243872afe4c5068bc66345def10fc3efdb3c4bb8291a4bc2222c1f2e74',
 'q-falkreath-tailor-trail-boots':'c80cf0cfa03d0d7bbd02dac97a3ba10a92d6b112c6f18a21df6c77404e22acb1',
 'q-haafingar-cook-field-soup':'7f3e208a1bf02b1e44e007a77e18baa712e74a70c12c06efeea716f6af0210ac',
 'q-hjaalmarch-alchemist-cotton-dressings':'7dd3a8f94cecd900b4211180e69ed764bd684b32512d1d262ae97feb972b78a9',
 'q-whiterun-smith-ebony-seam-account':'d09451fa3306f0743d0e68bd78ae43bde11dcd0fdc2761abe37c350d37a70faa',
 'q-whiterun-woodworker-outfitter-reserve':'a94934368484eaf0bcfa65564909260c8b1da3e198a11495b31a8d1c070836e0',
 'q-whiterun-tailor-winter-vestments':'68f0406f1fe3db80d3b820d13413c0419a960da038eef3a54ac103091d9af2e0',
 'q-whiterun-enchanter-ward-demonstration':'8f19b0da990fc2102dd312016717dc92a48f23d6bcfdec622aaf3adc621d169e',
 'q-whiterun-cook-mammoth-supper':'d8731860a77c3864c7b01ab6fa45c5311e0dfc1b68e8fbfec91e7b2b34fab5d4',
 'q-whiterun-alchemist-ash-expedition':'75d2ee9fbfc5902fe6b9d200feeb7ede1b0773d57c1dbad4e6b14db5b11479df',
 'q-whiterun-alchemist-travelling-case':'7131990508cefa6f7c7601227b888ed4f4c70c28990dda2a863b37436760a9da',
 'q-whiterun-enchanter-commission-rack':'531aabc2aaf3355f9867da014fb417e68b0a6171df577e82d7b39b61c5713787',
 'q-whiterun-smith-steel-blade-set':'b40b831c7c694b54bc1ae5d771e78136855044c542e78c02b492d0232970a43c',
 'q-whiterun-smith-glass-defence':'014841f818c26e6d1cf81ce9343f7554256fe0f12fd649d27d0a21a3e8ff91d3',
 'q-whiterun-woodworker-first-water-kit':'853bb28de7faec0ea0bdf90055369f01567e22b984055c9c835994db1c38ed06',
 'q-whiterun-woodworker-orcish-bow-kit':'7bdfd4fe29bd068d09aca13dddb8622317c7dda4d7410a07876a0bce1799d72c',
 'q-whiterun-woodworker-briquette-tools':'40fc07a8bd93a29fdaabc2cbbeb9fc97ac872cf2cafdbd8dfbe61341575c3507',
 'q-whiterun-tailor-hunt-feast-ribbons':'ebc1fece8c87c358e29c25945d428355036fd4bfe89d2c220c4f630d78b9ad89',
 'q-whiterun-tailor-white-fur-trimmings':'c914eff5b96246ef00a834b319b63d4289ba6f8c925c85220d732a0ca083f4f4',
 'q-whiterun-enchanter-glass-blade-supplies':'9b7585d22ff171b69fdd036ac4a72b191f34797d92350b77dde6c766d24eab37',
 'q-whiterun-cook-field-meal-parcel':'2ea942805da47f530b5bacfac762e1d6fa70c4c2f8d04603e0d06b266c977d79',
 'q-whiterun-cook-tomato-bread-order':'cc4f4f0682b62ef1b3029f500cf17baa8aa0fe689e93bbeaaf7e58260adcff63',
 'q-whiterun-cook-apple-dessert-order':'8abf81285bad8141f47e8908b28158537dd2856e240ba88317a541ede5411ddf',
 'q-whiterun-alchemist-lavender-cotton':'67ab5bbdfc39ab76203ab4b745ee9273277966436811ea357144d99efa1107ae',
 'q-whiterun-alchemist-fungal-collection':'5cb145a895c223d243bdb074f7ff5bd9f5704b75567358fbfab6b87105d87286',
 'q-solitude-smith-novice-parcel':'df7211e51512ad2baaa9b5ac808534cbb2dee4665a81d44fd152ef57a4128efb',
 'q-solitude-smith-advanced-parcel':'a1822b9c559eaf81c5b344087327bc324763cc4a0d7892086822c7962bb7ef09',
 'q-solitude-smith-expert-parcel':'c83f6c333a4a6dab26d77b3060a501ea3410e374148fe6cfe9f82e4ebe7de1d5',
 'q-solitude-smith-master-parcel':'145ec5099550e94b549a8467002eda9be6a95f0013a9c098e15a755f1059b52f',
 'q-solitude-woodworker-novice-parcel':'eff78b719516104c504065fd236abc5b5cf6a0b55aa7dd6d3d73e62acd6c0618',
 'q-solitude-woodworker-advanced-parcel':'5c670ce213b54dda267885e71d68fa98c1e4ff3a26cecef57da5a6bb0e451483',
 'q-solitude-woodworker-expert-parcel':'83b5039ab24f758b03542d82e36e998b802bdb098b788985ba860d84a5714efc',
 'q-solitude-woodworker-master-parcel':'8adf898f6904b8c48693a6f36d3e8979735774b25aa9f23f95756af1722d5af0',
 'q-solitude-tailor-novice-parcel':'46b2bf83e16e8d6d299de0cfdcdcdb5f6ff8f4a3eee8c4165ba868f0671991a6',
 'q-solitude-tailor-advanced-parcel':'038aee1d0874634bcb1f5410763aa71259d615d33fdd4fcac6889d2dfc2e376b',
 'q-solitude-tailor-expert-parcel':'601b656ab3906df24a575a3b11ba3e4c8dfb09fe735b3e75ae8074948989b2f9',
 'q-solitude-tailor-master-parcel':'a6874618ac393fcd1a3de174792564c72f47c6476e56b9a8b2eb5b0c14f05e27',
 'q-solitude-enchanter-novice-parcel':'b85aa9d71e3ba84bc5b330d03f072ba776dc684433d5c9eb6028619d3bcfedc1',
 'q-solitude-enchanter-advanced-parcel':'62e017232f60eaa1d8700b6a252fdd8666a6107484468230df7fd5d48936edec',
 'q-solitude-enchanter-expert-parcel':'c1c516c4149e23ad465a01b897204fcf6891ff936d37a0c531df677bc368db93',
 'q-solitude-enchanter-master-parcel':'4236b0aca6430b17ade65b1f5b179af42239b4bff0479ebd00d9e18271f2f3a4',
 'q-solitude-cook-advanced-parcel':'1772d5bb9a497f7a3b4f4e62f17685cabb682b6145148686eee210e43a7e85b9',
 'q-solitude-cook-expert-parcel':'ae91b7abf34c51b21fca3089f4e7cde187cb9b4d410e28a99d6d6df36024c347',
 'q-solitude-cook-master-parcel':'ff3025444aa93d780a488a686069767b5498561284d7c0629779648c335e7ad0',
 'q-solitude-alchemist-novice-parcel':'5265cf07dd4493c7f21fadedbd79350e672da0ff1adf0aa24edc1c351b8edb84',
 'q-solitude-alchemist-advanced-parcel':'d20cdc3ff2441af5c52ca3fe7851a990f0345775198676024aed996090455cb5',
 'q-solitude-alchemist-expert-parcel':'82035e27fa5993ef137a44bf22a566121e67593bbfc9ceb6e944707ae7a719fb',
 'q-solitude-alchemist-master-parcel':'d02aaac889785a16a365c3eca50b9e955bd94a9e5721451471ac8c70227d88fd',
 'q-riften-smith-novice-parcel':'147aaf8482e18415ffc9f5bbace4bae68cbde751325b5b04f230c30e68ac24d4',
 'q-riften-smith-advanced-parcel':'f9e445a8711b9825fd5117b8f74299d58daa5b3f66eeb190a96e51bb2b892a8c',
 'q-riften-smith-expert-parcel':'956c8368cb647136fed47901da4fed2c6286b4821463eeea7060e162b6beb9d1',
 'q-riften-smith-master-parcel':'e3bb684140354c61c7fc6c98dae1afa6a83fce572a9d3eea424b128940241fae',
 'q-riften-woodworker-advanced-parcel':'76b9aee0436ca6224778be010a1b7f2678550bbfdf7211c0be646c20c7098b71',
 'q-riften-woodworker-expert-parcel':'9c9f0785246cbeb2375a4b4b13ed8be5e35db225c7a8c744d90ea8cc904e3ae2',
 'q-riften-woodworker-master-parcel':'bb78ef69e73338888a8b5a28d1275a2d97b94af1172a2c823c92d39a89bf8342',
 'q-riften-tailor-novice-parcel':'f688f2a5c8441d986603744c398a860b7525f5d6404183e6dea517504dc6013c',
 'q-riften-tailor-expert-parcel':'385d0c7577db65393ab4e08e94429e338ba8e34499fc60d715eaa92751ccf6e4',
 'q-riften-tailor-master-parcel':'cbe99b87e92481de6f5ebcf35f8f842dae8711f919c3397f1c7fc201f41505d7',
 'q-riften-enchanter-novice-parcel':'2e3386850953c862108bf1f33b5d45cb5a5ca39d0579a379520d7867a166fe6d',
 'q-riften-enchanter-advanced-parcel':'5170503cc1f9a7ad816967c3409aece3c4101c37f7a7dffb705e8fe54544ae92',
 'q-riften-enchanter-expert-parcel':'9638f8521d601c8bb16ddde88ce0b82e5f5c187b8d246c59c1aaa51e41c1bae3',
 'q-riften-enchanter-master-parcel':'908deb3f07b96655711c7a4a2bb61988cedaec07fc1c17f8ad968786a0fc0fca',
 'q-riften-cook-novice-parcel':'60489099acb4ad46a6c24ba853b3e587bb62e032958999dc838d5a3dccff84e9',
 'q-riften-cook-advanced-parcel':'e7ca3fe3b22483768aa7a965db571d4af1f2b693aee1e96dc9e0ef6eafac6273',
 'q-riften-cook-expert-parcel':'175b846701a3bc02080ba416438060d794a838ed6839e7d4221d1b32ad15014a',
 'q-riften-cook-master-parcel':'79a05e34b25a2cbf20ca03d6e5227d746a031aafbfed701c46012cce6ce6cf8c',
 'q-riften-alchemist-novice-parcel':'babcd40296416c5a92a0887b832b5c2d5e4572ba790bb76134eb4efcd3337134',
 'q-riften-alchemist-advanced-parcel':'3e8cea381c48b8ceab960e61e9c10e26b5b13a4f558a5d0fb9b22c8d65e66100',
 'q-riften-alchemist-expert-parcel':'890f7cfc2c431c5cfbefc78c7bdef92dc41d0bacbe3ef675f7d4017359433755',
 'q-riften-alchemist-master-parcel':'78a27b84dc9d0aaaa649264dd908a952b0212b2029aa49bd9ffcfb8d0de802b0',
 'q-markarth-smith-novice-parcel':'fc2122cf0cf6c6e988886fb8a4011aa2d286eeff2a9db9ecd12ea35d67113259',
 'q-markarth-smith-advanced-parcel':'7cd6771000f07fd8fab7060d145c07f784d278d0d8935027c73bff65d45a7449',
 'q-markarth-smith-expert-parcel':'9f8a055c39abe1c6da78e026d06439129cb9209423504f58d10aab4011fd5a2d',
 'q-markarth-smith-master-parcel':'f9b1854ae2954c03148c0953b29b7f03077aee9842b9a0405a4340d8ff388bec',
 'q-markarth-woodworker-novice-parcel':'8a14d28f769296a7779f86bfe78517a8388e58d86feded698a791cbcefe9538e',
 'q-markarth-woodworker-advanced-parcel':'83dc5ab0d102b917460dc3ad68b39b8ea25dffaf511f6f0b520356b6b3dd931b',
 'q-markarth-woodworker-expert-parcel':'2bdfa338694777b2af3bf7dad169013e990a12f7b92c1c3bc3fb417b0eff8c69',
 'q-markarth-woodworker-master-parcel':'8378ba65a73153a84b4a6dbde433ed97caf1cbd4d3e4167ce52bc5fe8da8c538',
 'q-markarth-tailor-novice-parcel':'41d6dcf835ba00f47aad39321873750c027453c2f72770f22ac49665b6d7c42b',
 'q-markarth-tailor-advanced-parcel':'3575fb5956c6bfca509b104b5ea5c869b396deea02183b6993e379251fb5b463',
 'q-markarth-tailor-expert-parcel':'a82db75d4c592db004bcdc23e84c5df26ebe1d11ae86d6e84c87b43925760e23',
 'q-markarth-tailor-master-parcel':'d1c3e3fc5101c91621156be66ebb239bc6b230a35308110dcf589c3fdfec86f7',
 'q-markarth-enchanter-novice-parcel':'f4e8deb7f06db5fcbb86b7bea4ce92e6653822e8db470658fd7bd7fb5e7ac78a',
 'q-markarth-enchanter-advanced-parcel':'d512ed14fd1ff31a91572773f99f72de06a4ff8a403c6fbfd881df6e3921ca27',
 'q-markarth-enchanter-expert-parcel':'ae00a0f4ac01f6369331c039a5ff2613a260a67a08e368265f368bbd6dcb9084',
 'q-markarth-enchanter-master-parcel':'ab4c44e94cfb2fb9282dbceda00ceed78b916eb835cc9b13db53c48bc6becc4a',
 'q-markarth-cook-novice-parcel':'5fd53334c226ce6704106b241bc57cdee0d55ed51fc8183aff35703ac0631b10',
 'q-markarth-cook-advanced-parcel':'d1ffb9be87476f061d36e9014350dc72dacb9eee866b4a2e483f9e68dea3732e',
 'q-markarth-cook-expert-parcel':'afdedf75a9443c1a240eeda12e43c19e1a97ee2ccceb99f2036dd9041020b751',
 'q-markarth-cook-master-parcel':'1d9726f66c9475f243dd98c2ad8b5413531d9872e8a2c0f3d236b05e30889f24',
 'q-markarth-alchemist-novice-parcel':'d9f9e50d28fba45eaa5d3f7ffff68474e92931bbbbbdf5ea764ed75fee3e3744',
 'q-markarth-alchemist-advanced-parcel':'d3f55b2c5c9c66b6155d646e31cd8284c847945823f3a6b31253299c2e936b6a',
 'q-markarth-alchemist-expert-parcel':'a12e438d237306c6281f5e532e80c4bf3aebf604ae1cd50f3792fe3588a5b100',
 'q-markarth-alchemist-master-parcel':'f46347e9e2a02ba39a843d35a3bd8bcda9a063d0f98cd85830c439486c2cf419',
 'q-windhelm-smith-novice-parcel':'c0e4218201818d55a7957bfdcf02672343e7d585b74af1b4f76448cf0883b86e',
 'q-windhelm-smith-advanced-parcel':'fa8cafb3541d990d0868527a403051fb9deac6ae4b2c5febf06bb7fc15b102b0',
 'q-windhelm-smith-expert-parcel':'c29193fea0e4eca0b1b77134c1f145a5bc168d9a9de9bb65884708c831026861',
 'q-windhelm-smith-master-parcel':'0e32a9558d1c6f039dc4a57cfeb09383bfccc6eaff0abec37451288f62c3d606',
 'q-windhelm-woodworker-novice-parcel':'04e22dbf3675ba9281a944e7aa4f8e7a42fe253ad91571954bd9e04188de82dd',
 'q-windhelm-woodworker-advanced-parcel':'44380d7414e269163ceb131070d2fa45d9394f3e8e1c575bb82d6e653f80f954',
 'q-windhelm-woodworker-expert-parcel':'4c49c060c88282c277a28b75fe20ecf6438e8360a9f8fbc948e8267d30a11411',
 'q-windhelm-woodworker-master-parcel':'5d6b5bb46c39a96c1a07d0bef4d209f9285eb7dfb26c9a2367f155dce1a2c045',
 'q-windhelm-tailor-novice-parcel':'c312b72a66b80d09c7bb78b9225434eb56d25035810af5054ccd21214bed456b',
 'q-windhelm-tailor-advanced-parcel':'e78c9b94d05aa1048459e5a41c95d3232355b4f72f4e5738cc17f18555b6b419',
 'q-windhelm-tailor-expert-parcel':'692711d814bae0d42cc8be0badc140d2aa18778429af2ff48c2a5824ea7be537',
 'q-windhelm-tailor-master-parcel':'c7a3f61df76c862b67e4e02c0c64e437e7ae8e659bb1eeb9db99641d9d6aa6dc',
 'q-windhelm-enchanter-novice-parcel':'903a626b593e5ef06e17d30529e534e3a6e02a7ba7dec393e987a2b9f36ad7db',
 'q-windhelm-enchanter-advanced-parcel':'ec803e6460f66f8960b16ecd82952a674ab7efc12ef44e7472f54535e24fc611',
 'q-windhelm-enchanter-expert-parcel':'991d265f4c541513b73150d6fc7378041f3801839e7a1b2e4f0235745ab2e78e',
 'q-windhelm-enchanter-master-parcel':'4355d3eb01e0c995716d7bba1d04ebe43d03d3df54df1f20f07a202c44505e3e',
 'q-windhelm-cook-novice-parcel':'9e065bbcc57b9a3f87ed07ed2dfabdc7a7bbb137c5fe08e7c01cb5e51bf1e99b',
 'q-windhelm-cook-advanced-parcel':'9d82f18a0387f7d5c00f201224daa8a47c7f2a83573ab3593c4a441122ef8f5a',
 'q-windhelm-cook-expert-parcel':'4d4ac7df1b7666af20d1ac1f0eb2ac29ad95db1f69c258646a1212d48bd3aa47',
 'q-windhelm-cook-master-parcel':'bf138c7f1125f7f849c416e0ecf8e2edce337eadfae93b88f0af988dbed749a8',
 'q-windhelm-alchemist-novice-parcel':'ee40865e133bd7f2b0d605ef4a9c4712a1ea2810044ede29feb45922ca738361',
 'q-windhelm-alchemist-advanced-parcel':'d24414df81db0d7019f9316b910bb1b6b77619741545c2443295b8a1cf7e102a',
 'q-windhelm-alchemist-expert-parcel':'09281de4aadb3aa2779b01e07851d7ffe5a9262cf400133fc0c814de483133ba',
 'q-windhelm-alchemist-master-parcel':'d18f709cb9a2cba54a85c9d262f2f7e1b34e20d67a18f3b287a03d88d6ef76f7',
 'q-morthal-smith-novice-parcel':'71b4f6416009581f405e7de6f059a2911765f1f807b6287bc637f404ddf6905f',
 'q-morthal-smith-advanced-parcel':'f86f37ec293876d4fbfb1889859cf28e1908b71835df70cc9231afc68cd5b61f',
 'q-morthal-smith-expert-parcel':'419ddedc579950eee90774f768d1b51574f440c2453a2b703f03da5d114355e9',
 'q-morthal-smith-master-parcel':'00d8e6292fbb97467975120876fed4b80579849c1d8ac6c4b2748340c48ae6fd',
 'q-morthal-woodworker-novice-parcel':'1826e4d2d9f8f54abfc7d117dee2a025d9ed97bea817310f72df3509a6e79c41',
 'q-morthal-woodworker-advanced-parcel':'51ce93d15b6ba610a43424b4a32dc4ea099354575112aa27f0893d87327bdc69',
 'q-morthal-woodworker-expert-parcel':'0dc1b3f60331ccec3ef609a166dbaf47ff8196d31ebc49b3d780759272cd0f40',
 'q-morthal-woodworker-master-parcel':'189e472f274ba7a5fc2b9c537c23d1fb1a699c6963d4afdd9c0f28b4465ffa2d',
 'q-morthal-tailor-novice-parcel':'020ac422c90a12d91d074c53ab7f1a0e325ff4a85eb8c77bf9031d8a274c40a5',
 'q-morthal-tailor-advanced-parcel':'c6e0af976053ef88adbec1920db6e3b8cb15ac84e156746dad9932a0ebf42789',
 'q-morthal-tailor-expert-parcel':'8aaa861dbd792e367d851d906f151b2f99f821a26aefade3b77e636097949738',
 'q-morthal-tailor-master-parcel':'cf9c4f718bda5da779e21266d19e2dba3a0c34e66fc3dc43a65054875c0f2852',
 'q-morthal-enchanter-novice-parcel':'24886d3509a1c320fce55b8b45b4e7d30fb68052ae56b5512fa281182b8258c2',
 'q-morthal-enchanter-advanced-parcel':'760e419f89c3578715ff7546a2467a71afef335697504d2b356a9da3bbaed197',
 'q-morthal-enchanter-expert-parcel':'134e901f7a77c9082752569f4bd9624055143774ab9b073ecf828534a0200639',
 'q-morthal-enchanter-master-parcel':'eac915ae01dd6e7774ff92c483c16ad724dac640bbb79ff11ddfda18ee1f5a6e',
 'q-morthal-cook-novice-parcel':'889c1098ce23f5128bf40356d94650060e27ea909d599c4a9b4849aedd1a7764',
 'q-morthal-cook-advanced-parcel':'8a1bfa63a9be5ff7c65ec8ec12e5412e9a3349206b98b007e738a8b129142998',
 'q-morthal-cook-expert-parcel':'e27c070f1cb1eceb650ce1d22cda0225fda286d98c868b9b503d0adfe521744c',
 'q-morthal-cook-master-parcel':'41acabd559d2e2386a52cb90bcfb08767101d6d38ca520e4abfab1bbf81efdcb',
 'q-morthal-alchemist-advanced-parcel':'e4cec0fa1fb02c710391ee52fb5b6a707595c37c2381aebf2a3d591228470840',
 'q-morthal-alchemist-expert-parcel':'f0c57e7eb19b3a3bd872b158585f2f9c3e374351498eb589cc130b451a92bc7a',
 'q-morthal-alchemist-master-parcel':'a2a951da83f6811ca7b50a5a513a79b5dcf131941c14fe7eabb2602ba5b1101c',
 'q-dawnstar-smith-novice-parcel':'7345ba98148e5c941a2fa89f9f4e541c7582824be3757d1f13537662ee75a5f6',
 'q-dawnstar-smith-advanced-parcel':'5a65525543e7182b7e77d90ff3f5977341f11040b908d2bef0c53ac00a553b92',
 'q-dawnstar-smith-expert-parcel':'b0cbd3eb9b479d7aa7ba6048e1cc49f8453c7d5dbccd7bfb21c98a8392088d12',
 'q-dawnstar-smith-master-parcel':'ab644834d136c962ec9783e4cc1d7dcfed25f2033ca102918da25cff860ecaca',
 'q-dawnstar-woodworker-novice-parcel':'85071996fec908c1300c2c471351755da029f369dc35d45c069cc27a3c1d25d8',
 'q-dawnstar-woodworker-advanced-parcel':'85a606247d15cc745a0330e25acc969ca5b7e7fc486171b5e0ba10f58d6dbbbd',
 'q-dawnstar-woodworker-expert-parcel':'dcdc647dd5b1b7cd1f6a2a7911d135320a2e444788665c79f56e7db2493e9900',
 'q-dawnstar-woodworker-master-parcel':'7373b5119b57de4718c9cb4b62cf913ed8b693272127dfb913ce5318650cac8b',
 'q-dawnstar-tailor-novice-parcel':'9b384b54b4f24c87854b4b8c9ae5e24578233a1ef9fc15b432e3ab5d5022a029',
 'q-dawnstar-tailor-advanced-parcel':'e15bfeb0b24485b5884ca8792eb9a5432cc0692b38cb114b02df321c58bd881d',
 'q-dawnstar-tailor-expert-parcel':'bc40f28f23a39c8465ced1c877030df4daa5b0555dc7abb3752bddb10ce6ed89',
 'q-dawnstar-tailor-master-parcel':'4b4ea40b5a6d5ace6112b8e8e46af44d65c20714059f75fd085969d301049e09',
 'q-dawnstar-enchanter-novice-parcel':'af0d27b2e59d18aeb02ce06d4a44fc9eaad702efe4eb5da2689ea5d142e3b1aa',
 'q-dawnstar-enchanter-advanced-parcel':'5d525b5a4c8c2fab1f9144434bddc52325e84104a74c35518083786923410898',
 'q-dawnstar-enchanter-expert-parcel':'c6075730151fb6eadb28e476fcc40be2fa6be568ef659e4dacc01ec79c763a99',
 'q-dawnstar-enchanter-master-parcel':'0f16b90e17e2d31004e4a93a406f29a4bcd7f4331e2c8284386eca19f3f5a03d',
 'q-dawnstar-cook-novice-parcel':'1d0643248109c1e9e66fae653ae8949915f8ca2d1a1ebc3419df88c4b038fef9',
 'q-dawnstar-cook-advanced-parcel':'c0630a94b40b18b6f3bff64c1ffa026a596e06d8592c7db0034f2dae4320b414',
 'q-dawnstar-cook-expert-parcel':'6f77682975f615646a11e3e53e44fb5c0d70ee9044d2a3f0be7f5f2f6f78b7c9',
 'q-dawnstar-cook-master-parcel':'44b5a50455ed1a108049348f11ac507eb1c49c20f4eab6e979413ef3a6edeab7',
 'q-dawnstar-alchemist-novice-parcel':'9c2a4f3bb2d59b3727e7e58c688ef92b643d06ca8f8aec80486977943e1d5db3',
 'q-dawnstar-alchemist-advanced-parcel':'8fea1c65c671810b28782a45186238a69fcc8cb13f97d7afdb98bec5a9da20ff',
 'q-dawnstar-alchemist-expert-parcel':'c16ca4f418c642936bd2edf74fe928a841b9635c870852818beee73d0641df1e',
 'q-dawnstar-alchemist-master-parcel':'2b98c60e1663b678b15054390200f0bae5bb9e3e68bd8ac112bc1d1731905bcf',
 'q-winterhold-smith-novice-parcel':'68c46dc312e61a9359c230ffec9d24bd9543eae91f6f436f893f8148c0b6aa68',
 'q-winterhold-smith-advanced-parcel':'4599fb76f4644416b87817cf0bf6518699b0b46f55149a76769f2b6757d66864',
 'q-winterhold-smith-expert-parcel':'75c5bceb51d5f24af727c4ee968774097754b7cc0f64f10cb415d58330cd7e60',
 'q-winterhold-smith-master-parcel':'59f73bf6d038034fa2c9ac65b1b85a6582c9502c77e512349ef309125969f02d',
 'q-winterhold-woodworker-novice-parcel':'c77c432bc1a72f7da71368a839140359f67880dcc6d2dd928ceee18091aa6339',
 'q-winterhold-woodworker-advanced-parcel':'7362c2e1c85870d505ba5fad8413d5673fb99cb993b33f4bc09d6a82239f4840',
 'q-winterhold-woodworker-expert-parcel':'2b15efd43ad1a57ffa9519a592e41ee56062e220441bf7cdfd340bd1c359335b',
 'q-winterhold-woodworker-master-parcel':'22941c4af6bd41eb6aa96c9f29085ea2605fdd89157f091d562305d1e9e5c184',
 'q-winterhold-tailor-novice-parcel':'4ddea61b68bc9451d942295376ebd20082dc472aa12f5e046cc9960548bf58c8',
 'q-winterhold-tailor-advanced-parcel':'1e25774626e32469e0dae4cf4e949f279d1d6e9f1839ac48a4753a7d7f5fb5e7',
 'q-winterhold-tailor-expert-parcel':'8322953574b8161b13669df1e8f973f9009418f806681e9ecf4ea8b3b8aa0518',
 'q-winterhold-tailor-master-parcel':'c9c8d241fa93e31f3309e390234b02b1669aa5d8a909b21d1957da8fe9f0561b',
 'q-winterhold-enchanter-advanced-parcel':'27f62e866cbfba6be168028131e12b1e7617a36c0836f432544f7a33669ca67f',
 'q-winterhold-enchanter-expert-parcel':'e4a9ed1da463bccc801cac3fa6e15c72b494cb73246aade83a1d280388a3fad2',
 'q-winterhold-enchanter-master-parcel':'0cfba95b4a3024c53110c8c83c3c17a75e7f7d792a6d3a3b39078bc61852e147',
 'q-winterhold-cook-novice-parcel':'277548087151d77d846a585ced8bda3eb84805709af9f2698bd95eaed391a97d',
 'q-winterhold-cook-advanced-parcel':'3aa9880e1f254978a6a2272c66d559a2a69af9247e40fec979d7a6c75b1fb32c',
 'q-winterhold-cook-expert-parcel':'87747364053cb2011be77572dd9c73e613207616a0dec5e61194662aea51ac50',
 'q-winterhold-cook-master-parcel':'779e68af65ae32402a3b4ca0ee8f7e1da7b950d6c1fcc7a516699bd9f718d160',
 'q-winterhold-alchemist-novice-parcel':'8681041354c2bde2e6488629a0b6f771e62da15c91a14cf5a8bf6479832a5456',
 'q-winterhold-alchemist-advanced-parcel':'f51cb1451347adb50bfb81750a95456911a7b3d9973ccacfe1a096f893c868f6',
 'q-winterhold-alchemist-expert-parcel':'0488787bf8ba5adf803a5bbeeac07b71c9413f53e9bebea1334a6b995f1dc80c',
 'q-winterhold-alchemist-master-parcel':'e3fcaff2016fd92fa134179552961c37d237cea450605e44d23dd0db9aeec8c1',
 'q-falkreath-smith-novice-parcel':'ca3c2279d29109699533cdb8fefd39f5f40bfbed975dc3db521a672f0a29ef1b',
 'q-falkreath-smith-advanced-parcel':'c5599272d5fdb9dae5f99345c1c3b2d585f2a5de491e3575263b8ef6bcf5e2fe',
 'q-falkreath-smith-expert-parcel':'bef06ccb520179bd8d2acbaa59cb1ec4e7a4a67f11b33ea5f1079809a32e44e0',
 'q-falkreath-smith-master-parcel':'ab6b81c32740d170ad918b21ed37e61ba9dc4cb8cfda3050c57b5cc3edaeb43a',
 'q-falkreath-woodworker-novice-parcel':'5cd6da18590fac2fad633549b90985c52c2573065446c73c4f19bf90f52cb2ba',
 'q-falkreath-woodworker-advanced-parcel':'e0ce2e8cbf0e43d3a20fd1760c553a808a49bf1e75503427716359789d486d06',
 'q-falkreath-woodworker-expert-parcel':'3efc744007fd932a54dc6a4e09eac53cff8bb2d7ac7409d996be396805a663c8',
 'q-falkreath-woodworker-master-parcel':'c06d0c4cd4240fc4ff615eadec7080561b73e54761e5c71815fcf4c4782fce54',
 'q-falkreath-tailor-advanced-parcel':'4edd3818a0dc0aa5489de0df8aa8389fde26a98439319ceae129c760a2801116',
 'q-falkreath-tailor-expert-parcel':'a0615ea295953a744db2fa781af3b49e0c13226130cbdc815d5a55d52f036f47',
 'q-falkreath-tailor-master-parcel':'0e7a83f0b4cf3592bd68c6bc6cbc27b440b0a1f67ffd1a644b5ea7566bf40393',
 'q-falkreath-enchanter-novice-parcel':'6b4ab04f1b88aae537a34663138fdce78b0f78b77cb993103ba35d4b3a0a8570',
 'q-falkreath-enchanter-advanced-parcel':'9085844625e5af0a5a28f75d725e1d3248eb1c60154e371916c1916843501638',
 'q-falkreath-enchanter-expert-parcel':'5c67b8147d7781b830f790d9337779601e041b51d1912a5c76363a8a5c9fa3d2',
 'q-falkreath-enchanter-master-parcel':'2ddcc4b856c3ff5a37bd34b271789436547be0ba9454edcfab030dab5c37cc90',
 'q-falkreath-cook-novice-parcel':'d2d1aea6a672e08a00f83297378c9e640c58031743ef37857e6fc9da16da6a1b',
 'q-falkreath-cook-advanced-parcel':'84f7e09da0dbcc9e8f028c42bc994e7e1ff595cc3f1393f891cd80cb05a50ac0',
 'q-falkreath-cook-expert-parcel':'1233ab8d8e973049bb6579420ea00b3ec8c45817a060c2d122229ac7a4603e73',
 'q-falkreath-cook-master-parcel':'d0b2bf90773d1ded857b4b62df38463643dd7625131cf4cd109ec2f985160da8',
 'q-falkreath-alchemist-novice-parcel':'3362a1a626e9d923a1df34052aebee69b4631a9ba0f1c8315e1f7f8ffc7c6ea9',
 'q-falkreath-alchemist-advanced-parcel':'03a169491e5bb331843cc9838e8cf49c8f75b9bf81e3a9e9f33ba2d7f77e95e1',
 'q-falkreath-alchemist-expert-parcel':'8e97eca85396e324c2e9ce677cfd43060bc2ed00dc54114116aef13390c0ca08',
 'q-falkreath-alchemist-master-parcel':'dd6462bcececf28c771975e0067523f074bb38f9a5a4cd88532558fb7c5bb3e2',
 'q-ravenrock-smith-novice-parcel':'3cbca79c5f5e6650ad2d9b36ca4dd297bc459015aa5e9c534e955e104021a0ea',
 'q-ravenrock-smith-advanced-parcel':'5af2fa92555f278a4effd6072ed45fadefd1aeb8637525371ff07bb84cd0c66f',
 'q-ravenrock-smith-expert-parcel':'cc61db7e68c6da387bb44cc9bd3500f704315c55eda489f965c90e52a82e704c',
 'q-ravenrock-smith-master-parcel':'adae6050ba1670bb4aaa69ab79a771a505a774a76af77080d05ab98e5b16e0fb',
 'q-ravenrock-woodworker-novice-parcel':'cf1869fb57473e2139b9cc240c0f96083013c0c9d64fa08b0e3af24416141bf8',
 'q-ravenrock-woodworker-advanced-parcel':'90b0b77a702946246027fd48ee0cced62d2f0a8fa171258d1357bdf528760ab1',
 'q-ravenrock-woodworker-expert-parcel':'65d7ba9ae2bb492cfc4a989f3276a4e6f4990ff13b6130ec70b8bf9b12840a15',
 'q-ravenrock-woodworker-master-parcel':'fd63ff331800aae2c4257a1bc0b88b443fcd617b9c9783b6139ea8789c0a19a1',
 'q-ravenrock-tailor-novice-parcel':'5e80ddcd6736ee38ee9eaaabd392645ca7564d0bae66df87658ea87ae1c896d4',
 'q-ravenrock-tailor-advanced-parcel':'40fddf34d93a2c21fd8f9afe00caafba8b6a7b0a4b95a1dad551d9c659495e7b',
 'q-ravenrock-tailor-expert-parcel':'6137111ca25e9c03e324b5d13e33047fee1756c9b68e46f9f29fadde1840008e',
 'q-ravenrock-tailor-master-parcel':'bb5af439f5dc13640c4ecfa4d1c4b29d8e65fb782b01179a0e4891dd541195d1',
 'q-ravenrock-enchanter-novice-parcel':'dd9e05072befea7c2fa9401f522fef644712cfed83f8682aed7e971642463b31',
 'q-ravenrock-enchanter-advanced-parcel':'da1376c750a3b34723cb333f6879a553fb13e709d1921ee12d312508c79e8815',
 'q-ravenrock-enchanter-expert-parcel':'82bbb3f667b0fddfedb0bb3ce4d88338ee2cdc43a4f7bc0760b83cfc4208042f',
 'q-ravenrock-enchanter-master-parcel':'0879f08ed07175f14f519cdfce0b65240c1d5fd8b8c5c1a6ca119f82a54ba3a2',
 'q-ravenrock-cook-novice-parcel':'48bc5bb6b6ca2351b485565bdb1ebbb99a2a85399d98fbe591d5bf4d15d44032',
 'q-ravenrock-cook-advanced-parcel':'567d2e351485ac5f9e3e1e9fe85e845c8e012b2ffaec0684f65bc191480bb5d4',
 'q-ravenrock-cook-expert-parcel':'a43435d6530340ba7d9fff848514f23d1423047fc20faff6ddd2152c16add63b',
 'q-ravenrock-cook-master-parcel':'3562e7b189f3dee63ac2bf957a356b680b725ba67b93d9642c96306b6fb931cf',
 'q-ravenrock-alchemist-novice-parcel':'cbfe3d78eea5c536deea9fc63c1afbfd2ca1fcd34b3f87ab437386e08daa46b0',
 'q-ravenrock-alchemist-advanced-parcel':'28f1ff6e39d2f59f45a21c1025b6d8d847829b57c14f684e78ef0bcc8f319cb2',
 'q-ravenrock-alchemist-expert-parcel':'bcea0c2a92a1ac8b1c53a859b5ef9d511fca9c799c8d934a129a84df30f0ed58',
 'q-ravenrock-alchemist-master-parcel':'66951c0e24ab8e00f349e96fc336766d2a33797bacc40831961188017d611490'
});
function prepareCommissions(author,catalog,native) {
 if(!Array.isArray(author)||author.length!==Object.keys(publication).length)throw Error('Invalid published commission catalogue.');
 author=copy(author);catalog=copy(catalog);
 if(new Set(author.map(row=>row&&row.id)).size!==author.length||author.some(row=>{
   if(!row||publication[row.id]!==row.sourceHash)return true;
   const {sourceHash,itemType,itemTypes,...definition}=row;return hash(definition)!==sourceHash;
  }))
  throw Error('Published commission definitions must remain available.');
 const ids=new Set();
 return author.map(source=>{
  const row=copy(source),merchant=row.merchant,place=merchant&&catalog.byRef[merchant.reference];
  const bundle=row.deliveryVersion===2;
  if(row.kind!=='commission'||!['novice','advanced','expert','master'].includes(row.tier)||
    row.cooldownHours!==[6,12,24,48][['novice','advanced','expert','master'].indexOf(row.tier)]||ids.has(row.id)||
    !place||place.role!==merchant.role||place.hold!==merchant.hold||place.bookHold!==merchant.bookHold||
    !Array.isArray(row.goods)||row.goods.length<(bundle?2:1)||row.goods.length>(bundle?5:1)||!row.reward||row.reward.source!=='merchant-purse'||
    row.reward.pricing!=='submitted-hold-price')throw Error('Commission source or appointed merchant cannot be verified.');
  ids.add(row.id);
  const good=row.goods[0];
  return {id:row.id,name:row.name,text:row.text,tier:row.tier,gate:row.gate,
   who:[row.gate.classKey||row.gate.profession,row.gate.half||row.gate.school,row.gate.rank].filter(Boolean).join(', '),
   merchantId:native.resolveMerchant(merchant.reference,merchant.base),merchantRef:merchant.reference,
   role:merchant.role,hold:merchant.hold,bookHold:merchant.bookHold,
   ...(bundle?{deliveryVersion:2,hours:row.cooldownHours,goods:row.goods.map(part=>({
     itemId:native.resolveItem(part.item,row.itemTypes[part.item]),itemDesc:part.item,count:part.count}))}:
     {itemId:native.resolveItem(good.item,row.itemType),itemDesc:good.item,count:good.count}),sourceHash:row.sourceHash};
 });
}
function createCommissions(deps) {
 const rows=new Map(),now=deps.now||Date.now,purses=deps.purses,transfer=deps.transfer;
 for(const source of deps.rows||[]) {
  const row=copy(source);
  const goods=row.deliveryVersion===2?row.goods:[row];
  if(!/^q-[a-z0-9-]{1,46}$/.test(row.id)||rows.has(row.id)||!Number.isInteger(row.merchantId)||row.merchantId<=0||
    !Array.isArray(goods)||goods.length<1||goods.length>5||new Set(goods.map(good=>good.itemId)).size!==goods.length||
    goods.some(good=>!Number.isInteger(good.itemId)||good.itemId<=0||good.itemId===15||
      !Number.isSafeInteger(good.count)||good.count<1||good.count>100000)||
    row.deliveryVersion===2&&![6,12,24,48].includes(row.hours)||
    typeof row.sourceHash!=='string'||!/^[0-9a-f]{64}$/.test(row.sourceHash)||typeof row.role!=='string'||!row.role)
   throw Error('Published commission authority cannot be verified.');
  rows.set(row.id,row);
 }
 function namespace() {
  if(purses.callerGuard!==true||typeof purses.ledgerStates!=='function'||typeof purses.stats!=='function')
   throw Error('Commission ledger admission is unavailable.');
  const stats=purses.stats(),all=purses.ledgerStates(),size=stats.catalogue+(stats.retired||0);
  if(!Array.isArray(all)||!Number.isInteger(size)||size<1||size>249||all.length!==size||
    new Set(all.map(row=>row.reference)).size!==size)throw Error('The complete commission ledger cannot be verified.');
  return all.filter(row=>row.state!==null).map(row=>{STATE.spendable(row.state);return row.state;});
 }
 function quoteGood(row,good) {
  const catalog=deps.prices.catalog(row.bookHold)||[],matches=[];
  for(const item of catalog) {
   const resolved=deps.resolve(item.name);
   if(resolved&&!resolved.error&&resolved.baseId===good.itemId) {
    const price=deps.prices.quote(row.bookHold,item.name);
    if(price&&Number.isSafeInteger(price.buy)&&price.buy>=0&&price.buy<=2147483647&&
      Number.isSafeInteger(price.buy*good.count)&&price.buy*good.count<=2147483647)
     matches.push({unit:price.buy,name:resolved.name||item.name});
   }
  }
  // Ambiguous names or two aliases are never a guess at an accepted promise.
  return matches.length===1?matches[0]:null;
 }
 function quoted(row) {
  const parts=row.deliveryVersion===2?row.goods:[row],goods=[];
  for(const part of parts) {
   const quote=quoteGood(row,part);if(!quote)return null;
   goods.push({item:{baseId:part.itemId,name:quote.name},count:part.count,unit:quote.unit});
  }
  const gold=goods.reduce((sum,good)=>sum+good.count*good.unit,0);
  if(!Number.isSafeInteger(gold)||gold>2147483647)return null;
  return {goods,gold,argument:row.deliveryVersion===2?hash([row.sourceHash,goods]):String(goods[0].unit)};
 }
 function promised(row,held) {
  const goods=held.goods||[{item:held.item,count:held.count,unit:held.unit}];
  const parts=row.deliveryVersion===2?row.goods:[row];
  return held.hash===row.sourceHash&&goods.length===parts.length&&goods.every((part,i)=>
   part.item.baseId===parts[i].itemId&&part.count===parts[i].count)&&
   (row.deliveryVersion===2?held.hours===row.hours:held.goods===undefined);
 }
 function eligible(actor,row) {return typeof deps.eligible==='function'&&deps.eligible(actor,row.gate)===true;}
 function context(actor,merchant,row) {
  if(!row||row.merchantId!==merchant)return null;
  const state=purses.read(merchant),human=transfer.identity(actor);
  if(!state||state.reference!==row.merchantRef||!STATE.owner(human))return null;
  STATE.spendable(state);
  return {state,human,key:STATE.key(human,row.id),jobs:STATE.read(state.commissions)};
 }
 function view(actor,merchant) {
  const result=[];
  for(const row of rows.values()) {
   const ctx=context(actor,merchant,row);if(!ctx)continue;
   const {state,human,key,jobs}=ctx,held=jobs.held[key],last=jobs.cool[key],at=now();
   const pending=state.pending&&state.pending.kind==='commission'&&state.pending.human&&
     STATE.owner(state.pending.human)===STATE.owner(human)&&state.pending.previous.commissions&&
     state.pending.previous.commissions.held[key];
   const original=held||pending,quote=original?{goods:original.goods||[{item:original.item,count:original.count,unit:original.unit}],gold:original.gold}:quoted(row);
   const gate=original?true:eligible(actor,row),waiting=!!state.pending;
   const cooldown=last&&at-STATE.cooldownAt(last)<STATE.cooldownWait(last);
   const inventory=original?INVENTORY.inventory(transfer.inventory(actor)):null;
   const enough=!!original&&quote.goods.every(good=>inventory.entries.filter(item=>item.baseId===good.item.baseId)
     .reduce((sum,item)=>sum+item.count,0)>=good.count);
   const open=!!original,openLimit=STATE.openCount(namespace(),human)>=3;
   const activeCool=Object.keys(jobs.cool).filter(key=>at-STATE.cooldownAt(jobs.cool[key])<STATE.cooldownWait(jobs.cool[key])).length;
   const room=jobs.serial<Number.MAX_SAFE_INTEGER&&Object.keys(jobs.held).length<STATE.MAX_HELD&&
     Object.keys(jobs.held).length+activeCool<STATE.MAX_COOL;
   const funds=quote&&STATE.spendable(state)>=quote.gold;
   const ready=deps.settlement.available()&&deps.settlement.canInventoryMutation(actor);
   const reason=waiting?'This trader is finishing a saved transfer.':!ready?'Trading is waiting for a saved inventory.':
     !gate?'You do not meet this work\'s requirements.':cooldown?'This work is still resting.':!quote?'No submitted buy price is available for this work.':
     !open&&openLimit?'You already hold three commissions.':!open&&!room?'This trader cannot accept more work yet.':
     !open&&!funds?'The trader cannot reserve this payment.':'';
   result.push({id:row.id,name:row.tier[0].toUpperCase()+row.tier.slice(1)+': '+row.name,kind:'commission',
    who:row.who,check:row.text+' '+reason,locations:row.hold+'; return to this '+row.role+'.',exactMerchant:true,
    state:open?'open':cooldown?'cooldown':!gate?'locked':reason?'unavailable':'available',
    hours:original&&original.hours||row.hours||6,count:row.count,item:quote?quote.goods[0].item.name:row.itemName||'the requested goods',gold:quote?quote.gold:null,
    goods:row.deliveryVersion===2?(row.goods.map((part,i)=>({count:part.count,name:quote?quote.goods[i].item.name:part.itemDesc}))):undefined,
    quoteToken:row.deliveryVersion===2&&quote&&!original?quote.argument:null,
    quotedUnit:row.deliveryVersion!==2&&quote?quote.goods[0].unit:null,token:original?original.token:null,waiting:waiting,
    waitMinutes:cooldown?Math.ceil((STATE.cooldownWait(last)-at+STATE.cooldownAt(last))/60000):0,
    canTake:!open&&!reason,canReturn:open&&!waiting&&ready&&enough,canAbandon:open&&!waiting&&ready});
  }
  return result;
 }
 function act(actor,merchant,verb,id,argument,guards) {
  const row=rows.get(id),ctx=context(actor,merchant,row);
  if(!ctx||!guards||typeof guards.current!=='function'||typeof guards.alive!=='function')return {ok:false,why:'session'};
  const {state,human,key,jobs}=ctx;
  if(state.pending||!deps.settlement.available()||!deps.settlement.canInventoryMutation(actor))return {ok:false,why:'waiting'};
  if(typeof argument!=='string')return {ok:false,why:'session'};
  const number=/^@(0|[1-9][0-9]*)$/.test(argument)?Number(argument.slice(1)):NaN;
  if(!(verb==='take'&&row.deliveryVersion===2? /^@[0-9a-f]{64}$/.test(argument):Number.isSafeInteger(number)))return {ok:false,why:'session'};
  function current(fresh,quote) {
   if(!guards.current()||STATE.owner(transfer.identity(actor))!==STATE.owner(human))return false;
   if(fresh) {
    const again=quoted(row);
    if(!again||again.argument!==quote.argument||!eligible(actor,row))return false;
   }
   const count=STATE.openCount(namespace(),human);
   return (!fresh||count<3)&&guards.current()&&guards.alive();
  }
  if(verb==='take') {
   if(!eligible(actor,row))return {ok:false,why:'eligibility'};
   const quote=quoted(row);if(!quote||'@'+quote.argument!==argument)return {ok:false,why:'price'};
   if(STATE.openCount(namespace(),human)>=3)return {ok:false,why:'open-limit'};
   const terms=row.deliveryVersion===2?{hash:row.sourceHash,goods:quote.goods,hours:row.hours}:
     {hash:row.sourceHash,...quote.goods[0]},at=now();
   const accepted=STATE.reserve(jobs,human,id,terms,at,state.purse);
   if(!accepted.ok)return accepted;
   const next=Object.assign({},state,{commissions:accepted.next});
   const saved=deps.settlement.changeCommissions(merchant,state,next,human,()=>current(true,quote),{kind:'reserve',job:id,terms,at});
   return {ok:!!saved,why:saved?'':'session'};
  }
  const held=jobs.held[key];
  if(!held||held.token!==number)return {ok:false,why:'session'};
  if(verb==='abandon') {
   const at=now(),released=STATE.cancel(jobs,human,id,number,at);if(!released.ok)return released;
   const saved=deps.settlement.changeCommissions(merchant,state,Object.assign({},state,{commissions:released.next}),human,()=>current(false),
     {kind:'cancel',job:id,token:number,at});
   return {ok:!!saved,why:saved?'':'session'};
  }
  if(verb!=='return')return {ok:false,why:'request'};
  if(!promised(row,held))return {ok:false,why:'recovery'};
  const completed=STATE.finish(jobs,human,id,number,now());if(!completed.ok)return completed;
  const expected=INVENTORY.inventory(transfer.inventory(actor));
  let debit=expected,stock=copy(state.stock);
  try {
   for(const good of held.goods||[{item:held.item,count:held.count,unit:held.unit}]) {
    const outgoing=INVENTORY.takeEntries(debit,good.item.baseId,good.count);
    debit=outgoing.inventory;stock=deps.addStock(stock,outgoing.entries,good.item.name);
   }
  }catch(error){return {ok:false,why:'short'};}
  const next={purse:state.purse-held.gold,stock,supply:copy(state.supply||{}),commissions:completed.next};
  const moved=deps.settlement.begin({merchantId:merchant,humanId:actor,profileId:human.profileId,kind:'commission',
   previous:state,next,expected,debit,credit:held.gold?[{baseId:15,count:held.gold}]:[],caller:()=>current(false)});
  // A turn-in finishes once the save storage acknowledges it, a later tick (#5419): the trader says it then.
  return {ok:!!moved.done,why:moved.done?'':'waiting',
   settling:!moved.done&&moved.accepted&&typeof moved.id==='string'?{id:moved.id,gold:held.gold}:undefined};
 }
 return {has:id=>rows.has(id),view,act};
}
module.exports={createCommissions,prepareCommissions,publication};
