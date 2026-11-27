// Written by scripts\mods\Build-ModMenus.py from the collection's SkyUI, SkyHUD,
// moreHUD and RaceMenu archives. Run it again rather than editing this; an edit
// here fails the launcher's byte for byte check (#3113).
namespace Thornswood
{
    public sealed partial class MenuRecipe
    {
        public static readonly MenuRecipe SkyUIConfig = new MenuRecipe
        {
            Mod = "SkyUI",
            Archive = "SkyUI_SE.bsa",
            Source = "interface\\skyui\\config.txt",
            SourceSize = 38299,
            SourceSha256 = "6a3ef8d26467e682f12d6975e310941d49baf859be3e1905dba96b2d06f0cbda",
            Path = "Data\\Interface\\skyui\\config.txt",
            Size = 37907,
            Sha256 = "13a963540cb6b2d3d3f3de633ec517fb5c7ebe988cce8616b4173445ed3450c3",
            Edits = new[]
            {
                new MenuEdit(32604, 32, ""),
                new MenuEdit(32816, 32, ""),
                new MenuEdit(33139, 32, ""),
                new MenuEdit(33459, 32, ""),
                new MenuEdit(33803, 32, ""),
                new MenuEdit(35430, 32, ""),
                new MenuEdit(35646, 32, ""),
                new MenuEdit(35932, 32, ""),
                new MenuEdit(36430, 32, ""),
                new MenuEdit(36728, 32, ""),
                new MenuEdit(37073, 32, ""),
                new MenuEdit(37319, 40, ""),
            },
        };

        public static readonly MenuRecipe SkyUIItemCard = new MenuRecipe
        {
            Mod = "SkyUI",
            Archive = "SkyUI_SE.bsa",
            Source = "interface\\skyui\\itemcard.swf",
            SourceSize = 55748,
            SourceSha256 = "fbec6dd67ff3811579503ddcc37f7a10d198b6897e911430de70ca26481bb77f",
            Path = "Data\\Interface\\skyui\\itemcard.swf",
            Size = 55440,
            Sha256 = "e08c8cc1e97c237e0cf241c5fbd421345bf1a30c7fc55122dc2b0b66b9e87aa9",
            Edits = new[]
            {
                new MenuEdit(4, 4, "bec50200"),
                new MenuEdit(61796, 6, "ff09c02a0000"),
                new MenuEdit(62197, 65, ""),
                new MenuEdit(62390, 62, ""),
                new MenuEdit(63398, 67, ""),
                new MenuEdit(63597, 64, ""),
                new MenuEdit(64093, 68, ""),
                new MenuEdit(64293, 64, ""),
                new MenuEdit(64444, 64, ""),
                new MenuEdit(64739, 68, ""),
                new MenuEdit(65097, 64, ""),
                new MenuEdit(65393, 68, ""),
                new MenuEdit(65816, 64, ""),
                new MenuEdit(66122, 68, ""),
                new MenuEdit(66852, 67, ""),
                new MenuEdit(66983, 64, ""),
                new MenuEdit(67316, 71, ""),
                new MenuEdit(67451, 64, ""),
                new MenuEdit(67883, 65, ""),
                new MenuEdit(68012, 64, ""),
                new MenuEdit(68201, 65, ""),
                new MenuEdit(68330, 64, ""),
                new MenuEdit(68567, 65, ""),
                new MenuEdit(68696, 64, ""),
                new MenuEdit(71978, 67, ""),
                new MenuEdit(72109, 64, ""),
                new MenuEdit(72971, 67, ""),
                new MenuEdit(73170, 64, ""),
                new MenuEdit(73593, 68, ""),
                new MenuEdit(73793, 64, ""),
                new MenuEdit(74330, 67, ""),
                new MenuEdit(74461, 64, ""),
            },
        };

        public static readonly MenuRecipe SkyHUDMenu = new MenuRecipe
        {
            Mod = "SkyHUD",
            Archive = "SkyHUD.bsa",
            Source = "interface\\hudmenu.swf",
            SourceSize = 438627,
            SourceSha256 = "cb703280e6718016f989ee7a99107527eee056a95948c94ade63e65e44840da1",
            Path = "Data\\Interface\\hudmenu.swf",
            Size = 438631,
            Sha256 = "3a9fb686511a56ec4949387d3843821b64d91b7ee4a0017cc3cfeeff7cb574f5",
            Edits = new[]
            {
                new MenuEdit(605686, 1, "05"),
                new MenuEdit(605687, 1, "01"),
                new MenuEdit(605691, 1, "4a"),
            },
        };

        public static readonly MenuRecipe MoreHUDInfo = new MenuRecipe
        {
            Mod = "moreHUD",
            Archive = "AHZmoreHUD.bsa",
            Source = "interface\\ahzhudinfo.swf",
            SourceSize = 36076,
            SourceSha256 = "cbd14647151f932d78305797f289cf31dd9bbea77b7ddb1f52e28b700f0f7649",
            Path = "Data\\Interface\\AHZHudInfo.swf",
            Size = 36077,
            Sha256 = "486ac4d42a1c0b409b27412ed0471bdc57bd211eaa024bf0f816608b6bfd3c9b",
            Edits = new[]
            {
                new MenuEdit(70605, 1, "05"),
                new MenuEdit(70606, 1, "00"),
            },
        };

        public static readonly MenuRecipe MoreHUDInfoExported = new MenuRecipe
        {
            Mod = "moreHUD",
            Archive = "AHZmoreHUD.bsa",
            Source = "interface\\exported\\ahzhudinfo.swf",
            SourceSize = 36076,
            SourceSha256 = "cbd14647151f932d78305797f289cf31dd9bbea77b7ddb1f52e28b700f0f7649",
            Path = "Data\\Interface\\exported\\AHZHudInfo.swf",
            Size = 36077,
            Sha256 = "486ac4d42a1c0b409b27412ed0471bdc57bd211eaa024bf0f816608b6bfd3c9b",
            Edits = new[]
            {
                new MenuEdit(70605, 1, "05"),
                new MenuEdit(70606, 1, "00"),
            },
        };

        public static readonly MenuRecipe SkyUIJournal = new MenuRecipe
        {
            Mod = "SkyUI",
            Archive = "SkyUI_SE.bsa",
            Source = "interface\\quest_journal.swf",
            SourceSize = 314053,
            SourceSha256 = "0f5a76185c3db9701645dd46f8295d77e19bedee4593e4c641a20c103fb04b01",
            Path = "Data\\Interface\\quest_journal.swf",
            Size = 314063,
            Sha256 = "c51de5e9b36fe9cfb77a7aec4199a624c9eafb6dbc98b41558e3da0a6e4906ef",
            Edits = new[]
            {
                new MenuEdit(406597, 1, "99"),
                new MenuEdit(406600, 1, "94"),
                new MenuEdit(406601, 1, "00"),
                new MenuEdit(406903, 1, "99"),
                new MenuEdit(406906, 1, "2e"),
                new MenuEdit(406907, 1, "00"),
                new MenuEdit(408655, 1, "05"),
                new MenuEdit(408656, 1, "00"),
                new MenuEdit(409035, 1, "99"),
                new MenuEdit(409038, 1, "6c"),
                new MenuEdit(409039, 1, "00"),
                new MenuEdit(436145, 1, "05"),
                new MenuEdit(436147, 1, "07"),
                new MenuEdit(436148, 1, "00"),
                new MenuEdit(436149, 1, "00"),
                new MenuEdit(436150, 1, "00"),
                new MenuEdit(436152, 1, "43"),
                new MenuEdit(436153, 1, "96"),
                new MenuEdit(436154, 1, "05"),
                new MenuEdit(436155, 1, "00"),
                new MenuEdit(436156, 1, "07"),
                new MenuEdit(436157, 1, "00"),
                new MenuEdit(436158, 1, "00"),
                new MenuEdit(436159, 1, "00"),
                new MenuEdit(436160, 1, "00"),
                new MenuEdit(436161, 1, "17"),
                new MenuEdit(436163, 1, "05"),
                new MenuEdit(436165, 1, "07"),
                new MenuEdit(436166, 1, "00"),
                new MenuEdit(436167, 1, "00"),
                new MenuEdit(436168, 1, "00"),
                new MenuEdit(436170, 1, "43"),
                new MenuEdit(436171, 1, "96"),
                new MenuEdit(436172, 1, "05"),
                new MenuEdit(436173, 1, "00"),
                new MenuEdit(436174, 1, "07"),
                new MenuEdit(436175, 1, "00"),
                new MenuEdit(436176, 1, "00"),
                new MenuEdit(436177, 1, "00"),
                new MenuEdit(436178, 1, "00"),
                new MenuEdit(436179, 1, "17"),
                new MenuEdit(436181, 1, "05"),
                new MenuEdit(436183, 1, "07"),
                new MenuEdit(436184, 1, "00"),
                new MenuEdit(436185, 1, "00"),
                new MenuEdit(436186, 1, "00"),
                new MenuEdit(436188, 1, "43"),
                new MenuEdit(436189, 1, "96"),
                new MenuEdit(436190, 1, "05"),
                new MenuEdit(436191, 1, "00"),
                new MenuEdit(436192, 1, "07"),
                new MenuEdit(436193, 1, "00"),
                new MenuEdit(436194, 1, "00"),
                new MenuEdit(436195, 1, "00"),
                new MenuEdit(436196, 1, "00"),
                new MenuEdit(436197, 1, "17"),
                new MenuEdit(436360, 1, "05"),
                new MenuEdit(436362, 1, "07"),
                new MenuEdit(436363, 1, "00"),
                new MenuEdit(436364, 1, "00"),
                new MenuEdit(436365, 1, "00"),
                new MenuEdit(436367, 1, "43"),
                new MenuEdit(436368, 1, "96"),
                new MenuEdit(436369, 1, "05"),
                new MenuEdit(436370, 1, "00"),
                new MenuEdit(436371, 1, "07"),
                new MenuEdit(436372, 1, "00"),
                new MenuEdit(436373, 1, "00"),
                new MenuEdit(436374, 1, "00"),
                new MenuEdit(436375, 1, "00"),
                new MenuEdit(436376, 1, "17"),
            },
        };

        public static readonly MenuRecipe SkyUIInventory = new MenuRecipe
        {
            Mod = "SkyUI",
            Archive = "SkyUI_SE.bsa",
            Source = "interface\\inventorymenu.swf",
            SourceSize = 70488,
            SourceSha256 = "9225ed93e1589e69f6d5305299e8e6847aaaea1323a3c39ba88360803c3d49a6",
            Path = "Data\\Interface\\inventorymenu.swf",
            Size = 70669,
            Sha256 = "c102153a5a846424f3d6d40dc5b0d0207c6f3a7f2d8cecce903e9c6b322c7734",
            Edits = new[]
            {
                new MenuEdit(4, 4, "ef3c0400"),
                new MenuEdit(165453, 4, "3b1f0000"),
                new MenuEdit(168584, 2, "5b03"),
                new MenuEdit(168708, 2, "d902"),
                new MenuEdit(168789, 0, "4c9d0200cc01960200040296090000636f6e74726f6c004e96110000517569636b20496e76656e746f727900494c9d0200f10096060000736b7365001c44960800006f626a65637400664c129d0200d20096060000736b7365001c960e00004765744d61707065644b6579004e44960a000066756e6374696f6e0066104c129d02009f009605000700000000960500070000000096110000517569636b20496e76656e746f727900960500070300000096060000736b7365001c960e00004765744d61707065644b657900524c44960800006e756d6265720066129d02003c004c960500070000000067129d02002c004c960500070001000048129d02001c009602000402960d0000736b73654b6579636f6465004e66990200060017960200050010114c129d0200a60096020004029607000076616c7565004e960900006b6579446f776e0049104c129d02008100960200040196100000696e76656e746f72794c69737473004e960a00006974656d4c697374004e960e000064697361626c65496e707574004e12104c129d02003f00960200040196100000696e76656e746f72794c69737473004e960e000063617465676f72794c697374004e960e000064697361626c65496e707574004e121011"),
            },
        };

        public static readonly MenuRecipe RaceMenuMenu = new MenuRecipe
        {
            Mod = "RaceMenu",
            Archive = "RaceMenu.bsa",
            Source = "interface\\racesex_menu.swf",
            SourceSize = 105756,
            SourceSha256 = "ab3901335a28bbe53b360ce73be4dee5e74190c1efbb447ce22004f0638280e9",
            Path = "Data\\Interface\\racesex_menu.swf",
            Size = 105812,
            Sha256 = "2ace92f7b883b665e4346ba5ab5940afa6e3a9f48d26e285b96269b330138792",
            Edits = new[]
            {
                new MenuEdit(4, 4, "b5e00500"),
                new MenuEdit(209837, 1, "99"),
                new MenuEdit(209838, 1, "02"),
                new MenuEdit(209840, 1, "39"),
                new MenuEdit(209841, 1, "00"),
                new MenuEdit(209993, 1, "99"),
                new MenuEdit(209994, 1, "02"),
                new MenuEdit(209996, 1, "cb"),
                new MenuEdit(209997, 1, "00"),
                new MenuEdit(330083, 4, "908a0000"),
                new MenuEdit(336706, 2, "b170"),
                new MenuEdit(339498, 1, "99"),
                new MenuEdit(339499, 1, "02"),
                new MenuEdit(339501, 1, "a2"),
                new MenuEdit(339502, 1, "00"),
                new MenuEdit(347100, 2, "4706"),
                new MenuEdit(347135, 1, "00"),
                new MenuEdit(347144, 1, "00"),
                new MenuEdit(347520, 1, "99"),
                new MenuEdit(347521, 1, "02"),
                new MenuEdit(347523, 1, "fd"),
                new MenuEdit(347524, 1, "03"),
                new MenuEdit(348580, 0, "960400040108134e961000005f73656c6563746564496e646578004e96050007ffffffff49129d02003e00960d00060000000000000000040108134e960200089a5217961b000600000000000000000600000000000000000702000000040108134e960200085f5217"),
                new MenuEdit(365506, 4, "c7200000"),
                new MenuEdit(366876, 2, "6d1b"),
                new MenuEdit(367442, 2, "1202"),
                new MenuEdit(367476, 2, "f001"),
                new MenuEdit(367530, 2, "aa01"),
                new MenuEdit(367532, 0, "960700040307020000004e960e00004368616e67654865696768740049129d02008701960c000403070100000007040000004f9609000403081807080000004f"),
                new MenuEdit(367908, 2, "fffd"),
                new MenuEdit(367963, 1, "99"),
                new MenuEdit(367964, 1, "02"),
                new MenuEdit(367966, 1, "6e"),
                new MenuEdit(367967, 1, "01"),
            },
        };

        /// <summary>Every mod menu FromGame makes, in this order.</summary>
        public static readonly MenuRecipe[] Mods = { SkyUIConfig, SkyUIItemCard, SkyHUDMenu, MoreHUDInfo, MoreHUDInfoExported, SkyUIJournal, SkyUIInventory, RaceMenuMenu };
    }
}
