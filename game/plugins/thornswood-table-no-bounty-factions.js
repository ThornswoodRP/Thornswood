// NO_BOUNTY_FACTIONS, a table the front plugin reads (#5191). Built by scripts/dev/Build-CrimeTable.py;
// the content build writes it, so do not hand edit.
// ------------------------------------------------------------ whose game ----
// thornswood-front.js owns the whose-game check (issue #485): the client
// settings must point at this server and the launcher's session note must be
// fresh, or every Thornswood plugin stays idle. Front publishes the check as
// globalThis.Thornswood.whoseGame, and only when it says ours. This plugin
// runs nothing until the first tick: Skyrim Platform runs every file in
// Data/Platform/Plugins in one pass and sends that tick after the pass
// (TickImpl in the fork's skyrim-platform SkyrimPlatform.cpp), so by then
// front has published the check or did not load, whichever order the files
// came in. Nothing published means idle; so does the check saying not ours.
(function (start) {
  skyrimPlatform.once('tick', function () {
    const T = globalThis.Thornswood;
    if (!T || typeof T.whoseGame !== 'function' || !T.whoseGame()) { return; }
    start();
  });
})(function () {
'use strict';
((globalThis.Thornswood = globalThis.Thornswood || {}).clientTables = globalThis.Thornswood.clientTables || {}).NO_BOUNTY_FACTIONS = [
[21009,"HearthFires.esm","BYOHHousecarlFalkreathCrimeFaction"],
[21010,"HearthFires.esm","BYOHHousecarlHjaalmarchCrimeFaction"],
[21011,"HearthFires.esm","BYOHHousecarlPaleCrimeFaction"],
[295778,"Skyrim.esm","CompanionsFaction"],
[1094140,"Skyrim.esm","CrimeFactionCidhnaMine"],
[157667,"Skyrim.esm","CrimeFactionEastmarch"],
[164208,"Skyrim.esm","CrimeFactionFalkreath"],
[1111851,"Skyrim.esm","CrimeFactionGreybeard"],
[171440,"Skyrim.esm","CrimeFactionHaafingar"],
[164205,"Skyrim.esm","CrimeFactionHjaalmarch"],
[165960,"Skyrim.esm","CrimeFactionImperial"],
[1101545,"Skyrim.esm","CrimeFactionKhajiitCaravans"],
[176182,"Skyrim.esm","CrimeFactionNull"],
[165651,"Skyrim.esm","CrimeFactionOrcs"],
[164206,"Skyrim.esm","CrimeFactionPale"],
[164204,"Skyrim.esm","CrimeFactionReach"],
[164203,"Skyrim.esm","CrimeFactionRift"],
[165961,"Skyrim.esm","CrimeFactionSons"],
[1091476,"Skyrim.esm","CrimeFactionThievesGuild"],
[157674,"Skyrim.esm","CrimeFactionWhiterun"],
[164207,"Skyrim.esm","CrimeFactionWinterhold"],
[971111,"Skyrim.esm","DA06YamarzCrimeFaction"],
[562223,"Skyrim.esm","DA11CannibalFaction"],
[114099,"Skyrim.esm","DarkBrotherhoodFaction"],
[1113640,"Skyrim.esm","DB09TowerFaction"],
[949287,"Skyrim.esm","DBCrimeFactionMaro"],
[974303,"Skyrim.esm","DBRecuringContact10CrimeFaction"],
[974302,"Skyrim.esm","DBRecuringContact1CrimeFaction"],
[974301,"Skyrim.esm","DBRecuringContact2CrimeFaction"],
[974300,"Skyrim.esm","DBRecuringContact3CrimeFaction"],
[974299,"Skyrim.esm","DBRecuringContact4CrimeFaction"],
[974298,"Skyrim.esm","DBRecuringContact5CrimeFaction"],
[974297,"Skyrim.esm","DBRecuringContact6CrimeFaction"],
[974296,"Skyrim.esm","DBRecuringContact7CrimeFaction"],
[974295,"Skyrim.esm","DBRecuringContact8CrimeFaction"],
[974294,"Skyrim.esm","DBRecuringContact9CrimeFaction"],
[949149,"Skyrim.esm","DBRecuringTarget10CrimeFaction"],
[949150,"Skyrim.esm","DBRecuringTarget1CrimeFaction"],
[949151,"Skyrim.esm","DBRecuringTarget2CrimeFaction"],
[949152,"Skyrim.esm","DBRecuringTarget3CrimeFaction"],
[949153,"Skyrim.esm","DBRecuringTarget4CrimeFaction"],
[949154,"Skyrim.esm","DBRecuringTarget5CrimeFaction"],
[949155,"Skyrim.esm","DBRecuringTarget6CrimeFaction"],
[949156,"Skyrim.esm","DBRecuringTarget7CrimeFaction"],
[949157,"Skyrim.esm","DBRecuringTarget8CrimeFaction"],
[949158,"Skyrim.esm","DBRecuringTarget9CrimeFaction"],
[84827,"Dawnguard.esm","DLC1MothPriestCrimeFaction"],
[79802,"Dawnguard.esm","DLC1SeranaCrimeFaction"],
[98161,"Dawnguard.esm","DLC1VampireCrimeFaction"],
[83395,"Dawnguard.esm","DLC1WE01AttackPlayerFaction"],
[98937,"Dragonborn.esm","DLC2CrimeRavenRockFaction"],
[121953,"Dragonborn.esm","DLC2dunFrostmoonWerewolvesFaction"],
[230754,"Dragonborn.esm","DLC2HirelingTeldrynCrimeFaction"],
[202630,"Dragonborn.esm","DLC2SkaalDialogueFaction"],
[160401,"Dragonborn.esm","DLC2SkaalShamanFaction"],
[102298,"Dragonborn.esm","DLC2SkaalVillageCitizenFaction"],
[137018,"Dragonborn.esm","DLC2SV02ThalmorCrimeFaction"],
[97981,"Dragonborn.esm","DLC2TameDragonFaction"],
[250150,"Dragonborn.esm","DLC2ThirskNordCrimeFaction"],
[1081906,"Skyrim.esm","dunPOIWitchAniseCrimeFaction"],
[1063660,"Skyrim.esm","HirelingBelrandCrimeFaction"],
[1061734,"Skyrim.esm","HirelingErikCrimeFaction"],
[1061735,"Skyrim.esm","HirelingJenassaCrimeFaction"],
[1061736,"Skyrim.esm","HirelingMarcurioCrimeFaction"],
[1061737,"Skyrim.esm","HirelingStenvarCrimeFaction"],
[1061738,"Skyrim.esm","HirelingVorstagCrimeFaction"],
[1061739,"Skyrim.esm","HousecarlMarkarthCrimeFaction"],
[1061740,"Skyrim.esm","HousecarlRiftenCrimeFaction"],
[1061741,"Skyrim.esm","HousecarlSolitudeCrimeFaction"],
[1061742,"Skyrim.esm","HousecarlWhiterunCrimeFaction"],
[1061743,"Skyrim.esm","HousecarlWindhelmCrimeFaction"],
[402150,"Skyrim.esm","KarthwastenSilverFishGuards"],
[560868,"Skyrim.esm","MS07BanditFaction"],
[81067,"Populated Cities Towns Villages Legendary.esp","ssssDawnstarMercenaryMixHIRELING"],
[81068,"Populated Cities Towns Villages Legendary.esp","ssssFalkreathMercenaryMixHIRELING"],
[81069,"Populated Cities Towns Villages Legendary.esp","ssssMarkarthMercenaryMixHIRELING"],
[81070,"Populated Cities Towns Villages Legendary.esp","ssssMorthalMercenaryMixHIRELING"],
[81071,"Populated Cities Towns Villages Legendary.esp","ssssRiftenMercenaryMixHIRELING"],
[81072,"Populated Cities Towns Villages Legendary.esp","ssssSolitudeMercenaryMixHIRELING"],
[81073,"Populated Cities Towns Villages Legendary.esp","ssssWhiterunMercenaryMixHIRELING"],
[81074,"Populated Cities Towns Villages Legendary.esp","ssssWindhelmMercenaryMixHIRELING"],
[81075,"Populated Cities Towns Villages Legendary.esp","ssssWinterholdMageMercenaryMixHIRELING"],
[336566,"Skyrim.esm","WIGenericCrimeFaction"]
];
skyrimPlatform.printConsole('[thornswood-table] NO_BOUNTY_FACTIONS: ' + globalThis.Thornswood.clientTables.NO_BOUNTY_FACTIONS.length + ' rows');
});
