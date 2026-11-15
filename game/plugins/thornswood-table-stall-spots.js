// STALL_SPOTS, a table the front plugin reads (#5191). Built by scripts/dev/Build-MarketStallTables.js;
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
((globalThis.Thornswood = globalThis.Thornswood || {}).clientTables = globalThis.Thornswood.clientTables || {}).STALL_SPOTS = [
["falkreath-e0b1",60,"Skyrim.esm",-54113,-34305,-3633,335],
["falkreath-e0b2",60,"Skyrim.esm",-54413,-34602,-3620,335],
["markarth-473a0",93553,"Skyrim.esm",-174050,5729,-3363,183],
["markarth-473a1",93553,"Skyrim.esm",-174136,6065,-3328,183],
["markarth-7de",60,"Skyrim.esm",-168656,6632,-4331,183],
["morthal-bc995",60,"Skyrim.esm",-85314,57199,-11567,254],
["morthal-bc996",60,"Skyrim.esm",-85377,57518,-11568,254],
["riften-1b1f7a",93108,"Skyrim.esm",176485,-98728,11211,260],
["riften-1b1f7c",93108,"Skyrim.esm",176213,-99094,11207,202],
["riften-1dd1",93108,"Skyrim.esm",172370,-96376,11128,202],
["riften-1dd2",93108,"Skyrim.esm",172370,-96231,11128,202],
["riften-cc524",93108,"Skyrim.esm",173755,-96726,11104,252],
["riften-cc52d",93108,"Skyrim.esm",173079,-97352,11104,309],
["riften-cc52e",93108,"Skyrim.esm",173779,-97306,11104,257],
["solitude-1aa3b",60,"Skyrim.esm",-59552,100648,-13958,224],
["solitude-2a11",229087,"Skyrim.esm",-61093,105827,-8410,224],
["solitude-2a1b",229087,"Skyrim.esm",-61315,105933,-8418,209],
["solitude-2a49",229087,"Skyrim.esm",-60786,105792,-8410,224],
["solitude-357d",229087,"Skyrim.esm",-59225,107632,-8021,224],
["solitude-46f5",229087,"Skyrim.esm",-60730,104169,-8307,224],
["solitude-4725",229087,"Skyrim.esm",-61764,104094,-8307,224],
["solitude-50c6a",229087,"Skyrim.esm",-61161,104924,-8335,224],
["solitude-5133",60,"Skyrim.esm",-58740,101161,-13959,224],
["solitude-64b8c",229087,"Skyrim.esm",-61200,104536,-8334,224],
["solitude-64b8d",229087,"Skyrim.esm",-61605,104462,-8333,224],
["whiterun-1908f",107119,"Skyrim.esm",21453,-7327,-3587,254],
["whiterun-5b2e4",107119,"Skyrim.esm",25242,-7425,-3393,254],
["whiterun-5bee6",107119,"Skyrim.esm",25156,-7089,-3400,314],
["whiterun-6b0b6",107119,"Skyrim.esm",24382,-7187,-3399,335],
["whiterun-b7f00",60,"Skyrim.esm",12937,-10803,-4726,238],
["whiterun-fe7f",107119,"Skyrim.esm",24312,-6755,-3422,270],
["windhelm-383a6",92445,"Skyrim.esm",130794,36455,-12272,236],
["windhelm-38403",92445,"Skyrim.esm",130808,35750,-12276,236],
["windhelm-38404",92445,"Skyrim.esm",130560,36224,-12272,236],
["windhelm-80c33",60,"Skyrim.esm",135265,30774,-12565,202],
["windhelm-8b01e",92445,"Skyrim.esm",134225,39412,-12049,236],
["windhelm-8b0a",92445,"Skyrim.esm",129842,36459,-12272,236],
["windhelm-8b0fb",60,"Skyrim.esm",135301,30408,-12581,177],
["windhelm-8b6c",92445,"Skyrim.esm",130415,35648,-12272,236],
["windhelm-a48fc",92445,"Skyrim.esm",137951,38182,-12643,208],
["windhelm-b4bb",92445,"Skyrim.esm",137721,38748,-12660,219],
["windhelm-f3c74",92445,"Skyrim.esm",131041,35666,-12272,219],
["windhelm-f3c75",92445,"Skyrim.esm",130560,36016,-12272,219],
["winterhold-76d1",60,"Skyrim.esm",114289,104184,-9405,202],
["winterhold-76d3",60,"Skyrim.esm",114562,104038,-9392,183],
["winterhold-76e1",60,"Skyrim.esm",114011,103748,-9225,202],
["winterhold-76e2",60,"Skyrim.esm",113403,100147,-8954,183],
["winterhold-76e4",60,"Skyrim.esm",113628,100266,-9020,202],
["winterhold-76e5",60,"Skyrim.esm",112678,100814,-8953,202],
["winterhold-76e6",60,"Skyrim.esm",112650,100647,-8944,202]
];
skyrimPlatform.printConsole('[thornswood-table] STALL_SPOTS: ' + globalThis.Thornswood.clientTables.STALL_SPOTS.length + ' rows');
});
