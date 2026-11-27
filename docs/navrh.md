# Návrh: vlastní „Photoshop“ v TypeScriptu

Zadání viz [prace.md](./prace.md). Implementace je ve složce [app/](./app) (návod ke spuštění v [app/README.md](./app/README.md)).

Inspirace:
- **Photopea** – rozložení UI (menu, lišta voleb nástroje, nástroje vlevo, panely vrstev a historie vpravo), klávesové zkratky.
- **photocraft** (Rust) – oddělené jádro dokumentu od UI, příkazová historie, verzovaný formát projektu.

## Technologie

| Oblast | Volba | Proč |
|---|---|---|
| Jazyk / build | TypeScript (strict) + Vite | rychlý vývoj, HMR, malý produkční balík (~50 kB) |
| Vykreslování | Canvas 2D (každá vrstva má vlastní canvas) | v prohlížeči je akcelerovaný GPU, jednoduchý; blend módy jsou nativně přes `globalCompositeOperation` |
| UI | bez frameworku (malý helper `h()`) | žádná režie, plná kontrola nad překreslováním; dá se později vyměnit za Preact/Solid |
| Projektový soubor | `fflate` (ZIP) | `.ptsp` = `project.json` + PNG pro každou vrstvu |
| Testy | Vitest | testy jádra (historie, příkazy) běží bez prohlížeče |

Později podle potřeby: WebGL/WebGPU renderer (velmi velké obrázky), `OffscreenCanvas`. Filtry a úpravy obrazu se od verze 0.19 počítají ve Web Workeru (core/compute.ts), magická hůlka a magnetické laso zatím v hlavním vlákně.

## Architektura

```
src/
  core/               jádro – nezávislé na UI
    ImageDocument.ts  dokument: rozměry, vrstvy (index 0 = spodní), aktivní vrstva, události změn
    Layer.ts          rastrová vrstva: canvas + vlastnosti (název, viditelnost, krytí, prolnutí, posun x/y)
    History.ts        historie příkazů (undo/redo, skok na libovolný krok)
    commands/         vratné příkazy (přidat/smazat/přesunout vrstvu, vlastnosti, pixely)
    Editor.ts         stav aplikace: dokument, historie, viewport, nástroje, akce, nastavení
    Viewport.ts       zoom / posun, převod souřadnic obrazovka ↔ dokument
    actions.ts        registr akcí (menu + klávesové zkratky)
  render/             skládání vrstev a vykreslení do viewportu
  tools/              nástroje (rozhraní Tool + implementace, PlaceholderTools = připravené nástroje)
  ui/                 panely, menu, lišty, pravítka, dok, dialogy, plátno
  app/                definice akcí (actions.ts) a struktury menu podle Photopea (menus.ts)
  io/                 projekt (.ptsp), export PNG/JPEG, práce se soubory
```

### Klíčové principy

1. **Každá změna dokumentu je příkaz (`Command`)** s metodami `do()` a `undo()`. `History` drží celý lineární seznam a ukazatel pozice → undo, redo a klik na libovolný krok v panelu Historie. Nová akce po undo zahodí „budoucnost“ (jako Photoshop).
   - Pixelové změny (`PaintCommand`) ukládají jen **dotčený obdélník** před/po, ne celou vrstvu → nízká paměť.
   - Interaktivní změny (tah štětcem, tažení vrstvy, posuvník krytí) se aplikují naživo a do historie se zapíše jen výsledek (`history.push`).
2. **Dokument vysílá události** (`structure`, `active`, `props`, `pixels`); UI a renderer na ně reagují. Překreslení je sloučené do jednoho snímku (`requestAnimationFrame`).
3. **Renderer** cachuje složený obraz; při posunu/zoomu jen překreslí hotový obrázek, vrstvy znovu skládá jen při změně dokumentu.
4. **Modularita**:
   - nový nástroj = třída implementující `Tool` (`pointerDown/Move/Up`, `drawOverlay`, `createOptions`) + `editor.tools.register(...)`;
   - nová funkce v menu = `editor.actions.register({ id, label, shortcuts, run, isEnabled })` + id v `app/menus.ts`;
   - připravenou položku menu (`todo(...)` v `app/menus.ts`) nebo nástroj (`PlaceholderTool`) stačí nahradit skutečnou akcí / nástrojem se stejným umístěním;
   - nová vratná operace = nová třída `Command`.

## Rozhraní podle Photopea

Rozložení a položky menu jsou převzaté z Photopea (prošlé menu, podnabídky, skupiny nástrojů a lišty voleb):
menu Soubor / Úpravy / Obraz / Vrstva / Výběr / Filtr / Zobrazení / Okno / Další, lišta voleb nástroje,
levá lišta se skupinami nástrojů, záložky dokumentů, pravítka, stavový řádek (zoom, rozměr) a pravý dok
(sloupec ikon Info / Vlastnosti / Štětec / Znak / Odstavec / CSS / Galerie, panely Historie | Vzorník a Vrstvy | Kanály | Cesty).
Nehotové funkce jsou v UI připravené (zašedlé položky, štítek „Připravujeme“). Filtry nejsou v plánu – menu Filtr je jen kvůli rozložení.

## Verze 0.1 (hotovo)

- Vrstvy: přidat, duplikovat, smazat, přejmenovat (dvojklik), skrýt/zobrazit, krytí, režim prolnutí, pořadí (tažením myší nebo menu Vrstva → Uspořádat), náhledy, kontextové menu.
- Historie: krok zpět/vpřed (`Ctrl+Z`, `Ctrl+Shift+Z` / `Ctrl+Y`), panel Historie s přeskakováním na libovolný krok.
- Nástroje: Přesun (V), Štětec (B), Guma (E), Ruka (H, mezerník, prostřední tlačítko), Lupa (Z, Alt = oddálit); velikost štětce `[` `]`; barva popředí/pozadí, vzorník.
- Zoom kolečkem k místu kurzoru, přizpůsobit oknu (`Ctrl+0`), pixel na pixel (`Ctrl+1`), pravítka (`Ctrl+R`), celá obrazovka.
- Nový dokument, otevření obrázku, vložení obrázku jako vrstvy (menu, přetažení souboru, `Ctrl+V` ze schránky).
- Uložení/otevření projektu `.ptsp` (`Ctrl+S`, `Ctrl+O`), export PNG (`Ctrl+Alt+S`) a JPEG.

## Verze 0.2 – Výběr oblasti (hotovo)

- **Model:** `SelectionMask` (`core/selection/`) – neměnná maska 0..255 o velikosti dokumentu; operace vrací novou masku,
  takže historie (`SetSelectionCommand`) drží jen reference. Obrys („pochodující mravenci“) se počítá z hran pixelů a cachuje.
- **Režimy:** nový / přidat (Shift) / odečíst (Alt) / průnik (Shift+Alt) nebo přepínačem v liště; prolnutí, vyhlazování.
- **Nástroje:**
  - Obdélníkový a eliptický výběr (M) – Shift = čtverec/kruh, Alt = od středu, styl normální / pevný poměr / pevná velikost.
  - Laso a mnohoúhelníkové laso (L) – uzavření klikem na počátek, dvojklikem nebo Enterem, Backspace smaže bod, Esc zruší, Shift = násobky 45°.
  - Magnetické laso (L) – livewire: mapa hran (Sobel) + Dijkstra v okně kolem kurzoru, přichycení k nejsilnější hraně v okolí („Šířka“),
    práh hran („Kontrast“), automatické kotvy („Frekvence“).
  - Kouzelná hůlka (W) – scanline flood fill, tolerance, souvislé, ze všech vrstev.
- **Menu Výběr:** vše, odznačit, znovu vybrat, inverze, Upravit → ohraničení / vyhladit / rozšířit / zúžit / prolnout, vybrat pixely vrstvy (také Ctrl+klik na náhled).
- **Úpravy ve výběru:** štětec a guma kreslí jen uvnitř výběru; vymazat (Delete), vyplnit barvou popředí/pozadí (Alt/Ctrl+Backspace),
  kopírovat / kopírovat sloučené / vyjmout / vložit na původní místo, vrstva kopírováním / vyjmutím (Ctrl+J / Shift+Ctrl+J), oříznout plátno na výběr.
- Výpočty zatím běží v hlavním vlákně (pro běžné velikosti obrázků stačí); přesun do Web Workeru je připravený tím, že jádro výběru je čistý kód bez DOM.

## Verze 0.2.x – 0.4 (hotovo)

- **0.2.x:** přesun vybraných pixelů nástrojem Přesun (plovoucí výběr, Alt = duplikát, šipky), posun obrysu výběru,
  transformace výběru, Zvětšit / Podobné, Upřesnit okraj, Rychlý výběr.
- **0.3 – masky vrstev:** `Layer.mask` (hodnota v alfa kanálu), přidat / skrýt / z výběru / z průhlednosti, upravovat masku
  (`Ctrl+\`), použít / smazat / vypnout masku, výběr z masky; ukládá se do `.ptsp`.
- **0.4 – velikost a transformace:** Velikost obrazu a plátna (s kotvou), nástroj Oříznutí, Ořezat, Odkrýt vše,
  otočení / převrácení plátna i vrstvy, volná transformace (`Ctrl+Alt+T`). Vše jako příkazy se snapshotem (`DocStateCommand`).

## Verze 0.5 – Kreslicí nástroje a slučování (hotovo)

- **Kapátko (I)** – bod nebo průměr 3×3 … 31×31, zdroj aktuální vrstva / aktuální a nižší / všechny vrstvy, vzorkovací kroužek
  (nahoře nová, dole původní barva); Alt = barva pozadí. Ve štětci, plechovce a přechodu funguje Alt+klik jako kapátko
  (sdílí volby nástroje Kapátko – `ColorPicker` v `tools/EyedropperTool.ts`).
- **Plechovka (G)** – oblast podobné barvy (stejný flood fill jako kouzelná hůlka), barva popředí / pozadí, režim prolnutí,
  krytí, tolerance, vyhlazování (poloprůhledný lem `softenEdge`), souvislé, ze všech vrstev; omezená výběrem, v masce kreslí jasem.
- **Přechod (G)** – lineární, kruhový, úhlový, zrcadlený, kosočtverečný; předvolby popředí → pozadí / → průhledná / černá → bílá,
  obrátit, rozptýlení (dither), režim prolnutí, krytí, Shift = po 45°. Počítá se po pixelech (`core/paint/gradient.ts`), protože
  Canvas 2D neumí kosočtverečný přechod ani rozptýlení.
- **Štětec** – funkční režim prolnutí.
- **Slučování** – Sloučit dolů (`Ctrl+E`), Sloučit viditelné (`Ctrl+Shift+E`), Zploštit obraz (`core/merge.ts`).
  Zápis do historie přes `LayerListCommand` (výměna seznamu vrstev, drží jen reference → levné undo).
- Skládání vrstev je rozdělené na `drawLayer` / `compositeLayers` (podmnožina vrstev s posunem) – používá ho slučování
  i vzorkování „aktuální a nižší“.

## Verze 0.5.1 – Více dokumentů a ovládání touchpadem (hotovo)

- **Záložky dokumentů:** `Editor.sessions` (`DocSession` = dokument + vlastní `History`, název, uložený pohled, poslední výběr,
  stav uložení). `editor.doc` / `editor.history` jsou gettery na aktivní záložku, takže zbytek aplikace se nemění.
  Přepnutí záložky dokončí rozpracovanou operaci nástroje (`deactivate`), uloží a obnoví zoom/posun a vyšle událost `document`.
  Neuložené změny = poslední krok historie se liší od kroku při uložení; zavření se zeptá, stejně tak zavření stránky.
- **Touchpad / kolečko:** dva prsty posouvají pohled všemi směry, sevření (Chrome/Firefox: kolečko s `ctrlKey`,
  Safari: `gesturechange`) a Ctrl/Cmd/Alt + kolečko přibližují k místu kurzoru. Stránka se gesty nepřibližuje ani nepřescrolluje
  (`overscroll-behavior: none`), takže švihnutí do strany nespustí navigaci zpět.
- **Levý panel:** neposouvá se; při nízkém okně se nástroje rozloží do 2–3 sloupců (dříve se skrytě posouval a „odskakoval“).

## Verze 0.6 – Text a skupiny vrstev (hotovo)

- **Textové vrstvy** (`core/text.ts`, `tools/TextTool.ts`): `TextData` (obsah, písmo, řez, velikost, barva, zarovnání, řádkování)
  je svázaná s **konkrétním plátnem** vrstvy (WeakMap). Operace, které plátno nahradí (transformace, oříznutí, sloučení),
  tak vrstvu automaticky zrastrují a undo vrátí původní plátno i s textem – zbytek aplikace se kvůli textu nemusel měnit.
  Úpravy pixelů na místě (štětec, výplň, mazání) volají `Editor.rasterizeLayer` (vlastní krok historie). Velikost obrazu
  text nerastruje – zvětší písmo a vykreslí znovu. Editor: průhledné `<textarea>` přesně nad vykresleným textem
  (stejné CSS písmo, řádkování a okraje), text se překresluje naživo, do historie jde jen výsledek (nová vrstva = `AddLayerCommand`,
  úprava = `LayerStateCommand`). Zarovnaný okraj a první řádek zůstávají při změnách na místě (`anchoredPosition`).
- **Skupiny vrstev** (`core/groups.ts`): seznam vrstev zůstává plochý (odspodu nahoru), skupina je záhlaví (`Layer.isGroup`,
  plátno 1 × 1) nad souvislým blokem potomků s `parentId`. Strukturální operace (seskupit, zrušit, přesun nad / pod / do skupiny,
  posun mezi sourozenci, smazání, duplikát, sloučení skupiny) se počítají nad stromem čistými funkcemi a zapisují jedním
  `LayerListCommand` (pořadí + rodiče). Skládání: skupina se 100 % a Normální je průchozí, jinak se složí do pomocného plátna
  a vykreslí se svým krytím a režimem. Nová vrstva vložená mezi vrstvy skupiny do ní automaticky patří (`parentForInsertion`).
- Formát projektu verze 3: textová data a skupiny (starší verze otevřou text jako obrázek).

## Verze 0.7 – Více vrstev, zámky, automatické ukládání (hotovo)

- **Výběr více vrstev:** `ImageDocument` drží vedle aktivní vrstvy množinu dalších vybraných (mimo historii;
  `LayerListCommand` ji při undo vrací). Operace pracují s „kořeny výběru“ (`selectionRoots` – vrstvy, jejichž skupina není také
  vybraná). Seskupit / sloučit / smazat více vrstev = `collapseNodes` (odebere uzly a na místo nejvyššího vloží skupinu,
  sloučenou vrstvu nebo nic). Přesun posouvá všechny vybrané kromě zamčených.
- **Zámky vrstev:** `lockTransparency`, `lockPixels`, `lockPosition` jsou vlastnosti vrstvy (undo, ukládání); zámek skupiny platí
  pro obsah (`Editor.isLocked`). Zamčené pixely blokují `paintTarget` / `paintLayer`, transformaci a úpravu textu;
  zamčená průhlednost po každé úpravě vrátí původní alfu (`core/paint/alpha.ts`) – štětec po každém úseku, výplně a přechod v `paintLayer`.
- **Automatické ukládání** (`io/autosave.ts`): neuložené záložky se po 2,5 s nečinnosti a při skrytí stránky ukládají jako `.ptsp`
  do IndexedDB; po startu se nabídne obnova (obnovený dokument je „neuložený“, dokud se neuloží do souboru).
- **Export WEBP** (s průhledností); prohlížeč bez kodéru WEBP ohlásí, že ho neumí.

## Verze 0.8 – Ořezové masky, zarovnání, další nástroje (hotovo)

- **Ořezové masky:** vlastnost vrstvy `clipped`. Při skládání se základ (nejbližší neořezaný sourozenec pod ní, ne skupina)
  a ořezané vrstvy nad ním složí do pomocného plátna – normální režim přes `source-atop` (přesně), jiné režimy přes
  oříznutí alfou základu – a výsledek se vykreslí s krytím a režimem základu (`drawClipGroup` v `render/composite.ts`).
  Sloučit dolů do základu ořezanou vrstvu do něj ořízne.
- **Zarovnání / rozmístění** (`core/align.ts`, čisté funkce): obdélníky obsahu vrstev (neprůhledné pixely), reference = výběr,
  sjednocení vybraných vrstev nebo plátno. Krytí, režim a viditelnost se mění u všech vybraných vrstev.
- **Tužka** (BrushTool v režimu `pencil`: body na středech pixelů, alfa tahu prahovaná na 0 / 255), **Kouzelná guma**
  (sdílí hledání oblasti s plechovkou – `floodRegion`), **Úpravy → Obrys…** (`core/paint/stroke.ts`: pás kolem výběru
  z přesné euklidovské vzdálenostní transformace – kulaté rohy, vyhlazený okraj).

## Verze 0.9 – Výkon a paměť (hotovo)

- **CompositeCache** (`render/CompositeCache.ts`): kořenové uzly stromu vrstev se dělí na *pod* (předskládáno), *střed*
  (uzel s aktivní vrstvou, u ořezové masky celá ořezová skupina) a *nad* (předskládáno – jen když se celý skládá režimem
  Normální, protože operace „přes“ je asociativní; jinak se nedělí). Změna pixelů / vlastností vrstvy ve středu přeskládá jen
  střed, změna pixelů jen ve změněném výřezu (`DocChange.pixels.rect`; výřez omezuje i pomocná plátna skupin a ořezových masek).
  Jakákoli jiná změna (struktura, aktivní vrstva, jiná vrstva) = úplné přeskládání.
- **Zmenšený obraz pro okno** při zoomu < 1 se cachuje a při změně se aktualizuje jen výřez → posun pohledu nic nepřepočítává.
  Stín plátna se vykresluje jednou do obrázku.
- Měření (Chromium bez GPU, 4000 × 3000, 10 vrstev, čistý čas práce na snímek): tah štětcem 194 → 24 ms, přesun vrstvy
  172 → 59 ms, krytí posuvníkem 221 → 61 ms, posun pohledu 33 → 0,5 ms. Správnost hlídá test, který po náhodných úpravách
  porovnává cache se složením počítaným od nuly (shoda pixelů ± 2 úrovně z 255).
- **Limit paměti historie:** příkazy hlásí odhad paměti (`Command.bytes` – pixely stavu, které drží jen historie);
  `History` nad limitem zahazuje nejstarší kroky (aktuální stav i poslední krok zůstávají). Limit v Předvolbách
  (`localStorage`), panel Historie ukazuje obsazenou paměť, *Vymazat historii* uvolní vše (dokument zůstane neuložený).

## Verze 0.10 – PSD (hotovo)

- `io/psd.ts` nad knihovnou **ag-psd** (načítá se dynamicky až při otevření / uložení PSD, hlavní balík se nezvětší).
  Vrstvy v ag-psd jsou stejně jako u nás odspodu nahoru; strom skupin ↔ plochý seznam přes `buildTree`
  (záhlaví skupiny se při otevření vkládá až po jejích vrstvách).
- Převod: názvy, viditelnost, krytí, režimy prolnutí (nepodporované se nahradí nejbližším a ohlásí), poloha, masky
  (PSD maska má vlastní obdélník a výchozí barvu → převzorkuje se na obdélník vrstvy; šedá v R ↔ alfa), ořezové masky,
  zámky, sbalení skupin; skupina 100 % Normální ↔ „pass through“. Při uložení se přidá sloučený obraz a náhled.
- Neumíme (ohlásí se): efekty vrstev, úpravové vrstvy, vektorové masky; text a inteligentní objekty jako obrázek (efekty a text řeší 0.11).
- Test: dokument se vším výše → uložit PSD → nezávislá kontrola souboru knihovnou v Node → otevřít zpět
  → shodné vlastnosti všech vrstev i pixely složeného obrazu.

## Verze 0.11 – Styly vrstvy, PSD text a efekty (hotovo)

- Model `core/effects.ts`: `LayerEffects` (vržený stín, vnější záře, tah, překrytí barvou) jako vlastnost vrstvy
  (`SetLayerPropsCommand` → undo zdarma), čisté pomocné funkce (`shadowOffset`, `effectPadding` = přesah efektů za vrstvu).
- Vykreslení `render/effects.ts`: z alfy vrstvy (s maskou) se spočítá `under` (stín, záře, vnější tah), `pixels` (vrstva
  s překrytím barvou a vnitřním tahem) a `over`; výsledek se cachuje podle `Layer.pixelVersion` (zvyšuje `notifyPixels`),
  masky a nastavení. Stín/záře přes `shadowBlur` s posunutým tvarem, tah přes vzdálenostní transformaci (`core/paint/stroke.ts`).
- Skládání: `drawLayer` kreslí vrstvu i s efekty; u ořezové masky se efekty základu kreslí kolem celé skupiny
  (stín pod, ořezané vrstvy jen v pixelech základu). Špinavé obdélníky cache i rozměry při slučování počítají s přesahem efektů.
- Dialog *Styl vrstvy* (`app/layerStyle.ts`) s náhledem naživo, odznak *fx* v panelu vrstev; nové pole formuláře `color`.
- PSD: efekty tam i zpět (globální světlo, RGB / FRGB barvy, nepodporované efekty se ohlásí), textové vrstvy → `TextData`
  (PostScriptový název písma → rodina + řez, velikost × měřítko transformace, zarovnání, proklad, `origin` = počátek účaří).
  Text si nechá pixely z PS; `TextTool` ho při otevření k úpravě vykreslí znovu na `origin`, potvrzení beze změny nic nemění.
- Testy: jednotkové převody (efekty tam a zpět, písma, text), e2e styly vrstvy (náhled, undo, kreslení, slučování, `.ptsp`)
  a PSD „z Photoshopu“ (text, stín, tah → úprava textu na stejném účaří → uložení efektů zpět do PSD).

## Verze 0.12 – Další styly vrstvy, text do PSD (hotovo)

- Nové efekty: vnitřní stín, vnitřní záře (okraj / střed), překrytí přechodem (dvě barvy, lineární / kruhový, úhel, obrácení
  – přechod se rozkládá přes obsah vrstvy, `gradientLine`). Stíny, záře a překrytí mají `blendMode` (chybí = Normální,
  styly z 0.11 se kreslí stejně jako dřív; nové mají výchozí režimy Photoshopu).
- Vnitřní efekty (`applyInterior`): obsah se zkopíruje jako neprůhledný, efekty se do něj prolnou svými režimy a pak se vrátí
  původní alfa – barva je přesně „obsah prolnutý s efektem“ i na poloprůhledných okrajích. Vnitřní stín / záře = rozostřený
  stín „okolí“ tvaru (s okrajem proti světlání u kraje plátna); záře ze středu = 1 − záře od okraje.
- Vržený stín a vnější záře se kreslí zvlášť (`RenderedEffects.under` s režimy) přímo do okolí, obsah s tahem (`top`) režimem
  vrstvy; u ořezové masky totéž kolem celé skupiny.
- Dialog *Styl vrstvy* jako ve Photoshopu: seznam efektů vlevo, nastavení vpravo (`showSectionedForm` v ui/dialogs.ts);
  menu Vrstva → Styl vrstvy otevře konkrétní efekt. Ukládají se jen zapnuté efekty.
- PSD: nové efekty a režimy tam i zpět (vícebarevný / šumový přechod a „stažení“ stínu se ohlásí); text z editoru se ukládá
  jako textová vrstva (`textToPsd`, PostScriptový název písma `fontToPsd`, počátek účaří `textOrigin`) s pixely editoru.
- Alt+klik na vrstvu v panelu přepne ořezovou masku (`Editor.toggleClippingOf`), s Alt nad panelem se mění kurzor.
- Testy: převody efektů a písem tam a zpět, `gradientLine`, `textOrigin` × `positionForClick`; e2e nový dialog, vnitřní
  efekty, režimy stínu, zachování průhlednosti, PSD tam a zpět (efekty i obraz), text do PSD a zpět s úpravou na stejném
  místě, Alt+klik.

## Verze 0.13 – Vícebarevné přechody, krytí výplně, úkos a reliéf (hotovo)

- `GradientDef` (core/paint/gradient.ts): barevné zastávky a zvlášť zastávky krytí jako ve Photoshopu; `gradientStops`
  je sjednotí (přesně – obojí je po částech lineární) pro `buildLut` / CSS. Knihovna přechodů, `presetGradient`
  (předvolby nástroje + „Vlastní“).
- Editor přechodů (ui/gradientEditor.ts) přes nový `showCustomDialog`; pole formuláře `gradient` (hodnota JSON, klik otevře
  editor nad dialogem stylu). Nástroj Přechod: klik na náhled = editor.
- Překrytí přechodem: `gradient` místo `from` / `to` (styly z 0.12 se čtou přes `overlayGradient`), všech 5 typů a měřítko
  přes `renderGradient` (`overlayPoints` = body podle obsahu vrstvy). PSD: všechny zastávky, typ, měřítko.
- Krytí výplně `Layer.fillOpacity`: bez stylů = `globalAlpha`, se styly se násobí `fx.pixels` (obsah + vnitřní efekty)
  až po vnitřních efektech; vržený stín je pod tvarem vykrojený (výchozí „vrstva vykrojí stín“). Sloučení výplň zapeče.
  Panel Vrstvy (dosud nefunkční jezdec *Výplň*), `.ptsp`, PSD `fillOpacity`.
- Úkos a reliéf (core/paint/bevel.ts): znaménková vzdálenost od okraje (dvě EDT + subpixel z alfy) → výškový profil podle
  stylu (vnitřní, vnější, reliéf, polštář) a techniky (hladký = sinus, dláto = lineární) → vyhlazení → normála → osvětlení
  (úhel + výška světla); světla a stíny 0..1 se obarví a prolnou svými režimy. Vnitřní část v `applyInterior`, vnější
  (vnější úkos, reliéf, polštář) jako další položky `under`, maskované mimo tvar. PSD `bevel` (měkké dláto, reliéf tahu
  a textura se ohlásí).
- Testy: vícebarevné přechody, znaménková vzdálenost, profil, směr osvětlení, rozostření, převody PSD; e2e editor přechodů
  (knihovna, přidání / posun / smazání zastávek, Esc), nástroj Přechod, překrytí přes editor, styl z 0.12, výplň (vykrojení
  stínu, historie, bez stylů, sloučení), úkos naživo a reliéf mimo tvar, `.ptsp` a PSD tam a zpět (obraz beze změny).

## Verze 0.14 – Satén, vzorky, knihovna přechodů (hotovo)

- Satén: rozdíl (xor) dvou kopií tvaru posunutých o ±vzdálenost ve směru úhlu, rozostřený o velikost, volitelně obrácený;
  vnitřní efekt mezi překrytím barvou a vnitřní září (pořadí Photoshopu).
- Vzorky (core/patterns.ts): `PatternDef` (RGBA), registr (vestavěné generované vzorky, knihovna, vzorky ze souborů),
  `patternsVersion` v klíči cache efektů a `onPatternsChange` → překreslení (vzorek z knihovny se načítá asynchronně).
  `canvasPattern` = `CanvasPattern` s počátkem a měřítkem.
- Překrytí vzorkem: vzorek začíná v levém horním rohu vrstvy (svázaný s vrstvou), měřítko, režim; celočíselné zvětšení bez
  vyhlazení. Pole formuláře `pattern` + výběr vzorků (ui/patternPicker.ts).
- Úpravy → Definovat vzorek (sloučený obraz ve výběru, `Editor.patternSource`) a Vyplnit vzorkem (`Editor.fillPattern`,
  dlaždice od počátku dokumentu, jen ve výběru); nové pole formuláře `text`.
- Knihovna (io/library.ts, localStorage): vlastní přechody (editor přechodů: *Přidat do knihovny*, mazání) a vzorky (PNG).
- Soubory nesou vzorky s sebou: `.ptsp` (`patterns/*.png` + `manifest.patterns`, jen nevestavěné), PSD (`psd.patterns`
  včetně vestavěných – Photoshop je nezná); při otevření se zaregistrují.
- Testy: vestavěné vzorky (determinismus), registr a posluchači, použité vzorky, převody PSD; e2e satén, výběr vzorku
  a měřítko, posun se vzorkem, Definovat / Vyplnit vzorkem (i ve výběru), projekt a PSD nesou vlastní vzorek na čistou stránku,
  cizí PSD se vzorkem a saténem, knihovna přechodů a vzorků přes obnovení stránky.

## Verze 0.15 – Úpravy obrazu (hotovo)

- core/adjust.ts: popis úpravy jako data (`Adjustment`, sjednocení podle `kind`) – připraveno pro vrstvy úprav.
  Tabulkové úpravy (`adjustmentLuts`: jas/kontrast, úrovně, křivky – monotónní kubická interpolace Fritsch–Carlson,
  expozice v lineárním světle, invertovat, posterizace; kanál se počítá před složeným RGB jako v GIMPu) a pixelové
  (odstín/sytost v HSL – šedá zůstane šedá, živost, vyvážení barev s váhami tónů a zachováním jasu, černobílý podle
  vzorce Photoshopu min + (střed − min)·dvojbarva + (max − střed)·hlavní barva, fotofiltr, práh, mapa přechodu, odbarvit).
  `applyAdjustment(data, a, weights)` – váhy = měkký výběr. Histogram (jas / kanál, bez průhledných a nevybraných
  pixelů), `autoLevels` (tón po kanálech, kontrast společně, ořez 0,1 %).
- core/adjustSession.ts: náhled naživo přímo ve vrstvě (z originálu, do `notifyPixels`), maska jako šedá z alfy;
  `commit` přes `paintLayer` (zámky, rastrování textu až po OK, `PaintCommand`), beze změny = žádný krok; `cancel`.
- app/adjustments.ts: obecný dialog s posuvníky (`slider` u číselného pole, dvojklik = výchozí hodnota), vypínač
  Náhled, přepočet nejvýš jednou za snímek; Úrovně (histogram, kanály, automaticky) a Křivky (vlastní editor na plátně)
  přes nové pole formuláře `element`. Menu Obraz → Úpravy a zkratky Photoshopu.
- Výkon: odstín/sytost na 2400 × 1600 px ≈ 0,3 s na změnu (bez GPU); tabulkové úpravy výrazně rychleji.
- Testy: tabulky, křivky (body, monotonie, pořadí), neutrální výchozí hodnoty, pixelové úpravy (odstín, šedá, kolorovat,
  živost, černobílý, vyvážení), váhy výběru, histogram, automatické úrovně; e2e Úrovně (kanály, náhled, historie), Křivky
  (přidání, tažení, pole, smazání, kanál), Zrušit / Esc, posuvník, měkký výběr, maska, automatické úpravy, ostatní dialogy,
  zamčená vrstva, text (rastruje se až po OK), výkon.

## Verze 0.16 – Vrstvy úprav a výplňové vrstvy (hotovo)

- `Layer.adjustment: Adjustment | null` (vlastnost vrstvy → změna nastavení = `SetLayerPropsCommand`, ukládá se v `.ptsp`
  s ostatními vlastnostmi). Plátno přes celý dokument zůstává prázdné, maska nese sílu.
- Skládání (`applyAdjustmentLayer` v render/composite.ts): vrstva úprav vezme to, co už je v cílovém kontextu, ve výřezu
  `region`, a upraví to `applyAdjustment` s váhami krytí × maska (Normální přesně po pixelech, průhlednost zůstane;
  jiné režimy přes plátno). Průchozí skupina → upraví vše pod ní, izolovaná skupina → jen svůj obsah, ořezaná vrstva
  úprav → jen základ (v bufferu ořezové masky). Vrstva úprav nemůže být základem ořezové masky.
- Cache skládání: úsek „nad“ s vrstvou úprav nejde předskládat (`overSafe`), klíč struktury zná vrstvy úprav.
- Kreslení na vrstvu úprav jde do masky (`paintTarget`), trvalé úpravy jsou na ní vypnuté, do vrstvy úprav nejde sloučit;
  sloučení vrstvy úprav dolů ji zapeče.
- Výplňové vrstvy (core/fillLayer.ts): `FillContent` (barva / přechod se stylem, úhlem a měřítkem / vzorek) vázaný na
  plátno přes WeakMap jako text; `renderFill`, úprava = `LayerStateCommand` s novým plátnem, kreslení zrastruje.
- Dialogy (app/adjustments.ts) nad rozhraním `AdjustTarget`: trvalá úprava (AdjustmentSession) nebo vrstva úprav (náhled
  změnou vlastnosti, histogram ze složení pod vrstvou). Popisy dialogů (`DialogSpec`) berou počáteční hodnoty – úprava
  existující vrstvy otevře její nastavení. Nová vrstva během dialogu je jen náhled (`Editor.previewNewLayer`), OK = jeden
  krok (s maskou z výběru a jeho zrušením).
- PSD: vrstvy úprav všech 13 druhů tam i zpět (`adjustmentFromPsd` / `adjustmentToPsd`, kanály úrovní a křivek v pořadí
  RGB, R, G, B, kolorování odstínu/sytosti, 32bitová čísla expozice zaokrouhlena), výplňové vrstvy přes `vectorFill`
  (tvary s vektorovou maskou zůstávají obrázkem). Vzorky výplní se ukládají se souborem (`layerPatternIds`).
- Testy: PSD tam a zpět přes ag-psd pro všechny úpravy a výplně (jednotkově); e2e nová vrstva úprav (náhled, zrušit, OK),
  krytí, kreslení do masky, nastavení dvojklikem, skrytí, kreslení pod vrstvou úprav, sloučení, ořez, skupina, maska
  z výběru, Úrovně jako vrstva, výplně (barva, úprava, rastrování, přechod, vzorek), `.ptsp` a PSD tam a zpět (obraz beze
  změny), cache = složení od nuly ve všech případech.

## Verze 0.17 – Filtry (hotovo)

- core/filters.ts: popis filtru jako data (`Filter`), čisté funkce nad RGBA. Rozostření s předem vynásobenou alfou
  (průhledné okolí neztmaví okraj): Gauss = přesné oddělitelné jádro pro σ < 1,5, jinak 3× rámeček (`boxesForGauss`),
  vodorovně po řádcích, svisle běžícím součtem celých řádků (souvislé čtení paměti); rámečkové, pohybem (vzorky podél
  úsečky), průměr (váženě alfou a výběrem). Šum se semínkem (opakovatelný náhled), medián Huangovým posuvným histogramem
  (ověřen proti hrubé síle), odstranit skvrny (medián 3 × 3 mimo hrany), maska rozostření s prahem, zostřit / více,
  horní propust, posun (zalomit / opakovat / průhledné), mozaika, barva na alfu (algoritmus GIMPu).
- core/filterSession.ts: `FilterSession` – vstup = oblast výběru + okolí podle dosahu filtru (`filterReach`), výsledek se
  smíchá podle výběru (všechny kanály, se zamčenou průhledností bez alfy), maska jako šedá. `FadeSession` (Zeslabit) –
  poslední `PaintCommand` filtru / úpravy (`Editor.fadeable`, platí jen jako poslední krok historie) se prolne krytím
  a režimem; výsledek je nový krok „Zeslabit: …“.
- app/filters.ts: dialogy s posuvníky a Náhledem, pamatují si poslední nastavení; Poslední filtr; menu Filtr podle
  Photoshopu (Rozostření, Šum, Zostření, Pixelizace, Jiné).
- Výkon (2400 × 1600 px, kontejner bez GPU): Gauss r = 20 ≈ 0,4 s výpočet, maska rozostření ≈ 0,35 s, medián r = 3 ≈ 0,75 s.
- Testy: rozptyl rámečků, Gauss (plocha, okraj na průhledném, zachování alfy), pohyb, průměr, šum (semínko), medián
  (proti hrubé síle), maska rozostření (práh), horní propust, posun, mozaika, barva na alfu; e2e náhled / zrušit / OK,
  Poslední filtr, Zeslabit (0 %, 50 %, zpět), výběr s okolím, všechny filtry, maska, vrstva úprav, zámky, výkon.

## Verze 0.18 – Další filtry, rychlý náhled (hotovo)

- Deformace přes společné `warp` (pro každý cílový pixel zdrojový bod, bilineární vzorek z předem vynásobených dat
  oblasti): zkroucení (otočení klesající od středu), sevření (r · sin(π/2 · r)^(−míra/200)), kulovitost (koule
  1 − √(1 − r²) / promáčknutí), zvlnění (sinus kolmo, vlnová délka 8 / 16 / 32 px), polární souřadnice oběma směry
  (horní okraj do středu). Vše v elipse vepsané do oblasti výběru.
- Radiální rozostření otočením (oblouk ≈ míra ve stupních) a přiblížením (paprsek ≈ míra v % vzdálenosti), nejvýš 64
  vzorků na pixel. Najít hrany (Sobel po kanálech, převrácený), reliéf (rozdíl jasu po směru světla kolem šedé 128),
  solarizace, mraky (hodnotový šum 5 oktáv se semínkem, mezi barvou popředí a pozadí, neprůhledně).
- Rychlý náhled (`FilterSession.showDraft`): u oblasti nad 0,6 Mpx se během změn originál s okolím zmenší plátnem,
  přefiltruje se zmenšeným filtrem (`scaleFilter` zmenší délky v px) a zvětší zpět; výběr se přimíchá maskou na plátně.
  Plné rozlišení 250 ms po poslední změně a vždy při OK. 2400 × 1600 px: náhled ≈ 0,2 s místo ≈ 1 s (kontejner bez GPU).
- Menu Filtr podle Photoshopu: Rozostření, Zkreslení, Šum, Pixelizace, Vykreslit, Zostření, Stylizace, Jiné.
- Testy: nulové hodnoty deformací beze změny, zkroucení jen v elipse, kulovitost / sevření (zvětšení / zmenšení středu),
  polární tam a zpět, radiální rozostření, hrany, reliéf, solarizace, mraky (opakovatelné, mezi barvami), `scaleFilter`;
  e2e všechny nové dialogy (náhled = výsledek), filtry bez dialogu, mraky ve výběru + Poslední filtr, rychlý náhled
  (čas, podobnost, plné rozlišení po pauze, výběr).

## Verze 0.19 – Výpočet na pozadí (hotovo)

- core/jobs.ts: `Job` (filtr s oblastí a vahami výběru / úprava) a `runJob` – stejný kód běží ve workeru
  (core/computeWorker.ts) i na hlavním vlákně. Worker se vytváří zápisem
  `new Worker(new URL('./computeWorker.ts', import.meta.url), { type: 'module' })`, který Vite sestaví jako samostatný soubor.
- core/compute.ts: `computeJob(img, job)` – jeden worker, data se předávají bez kopírování (transfer). Platí jen nejnovější
  požadavek: čekající starší skončí `Cancelled`, rozpracovaný výpočet starší než 100 ms se přeruší ukončením workeru
  (kratší doběhne – nový worker by se jen zbytečně načítal). Bez workeru (testy v Node, zakázané workery, chyba při
  spuštění) se počítá na hlavním vlákně.
- core/pixelSession.ts: společný základ `AdjustmentSession` a `FilterSession` (cíl, výběr, okolí pro rozostření, míchání podle
  výběru, zamčená průhlednost, maska jako šedá, zmenšený náhled, potvrzení jako `PaintCommand`). `update` je asynchronní
  a ukáže výsledek jen, pokud mezitím nepřišla novější změna (pořadové číslo); `commitWith(p, label)` dopočítá plné
  rozlišení (pokud už není spočítané pro stejné nastavení) a zapíše krok. Úprava bez změny krok nezapíše, filtr ano.
- Zmenšený náhled (0,6 Mpx) i pro úpravy obrazu: odstín/sytost na 2400 × 1600 px ukáže náhled ≈ 0,1 s, plné rozlišení
  po 250 ms bez změn.
- ui/busy.ts: `withBusy(promise)` – po 120 ms překryv s kolečkem „Počítám…“, do konce pohltí myš i klávesnici (dokument se
  během dopočtu nesmí změnit, např. Ctrl+Z). `idle()` (v dev buildu na `window`) počká na konec výpočtů – pro e2e testy.
- Testy: `runJob` = `applyFilter` / `applyAdjustment`, výpočet bez workeru; e2e worker se spustí, během výpočtu plného
  rozlišení se dál kreslí snímky, po rychlých změnách platí poslední nastavení, Zrušit během výpočtu, indikátor a blokované
  klávesy, odstín/sytost (rychlý náhled, výsledek v plném rozlišení), úpravy ve výběru, chod bez workeru.

## Verze 0.20 – Razítko a vzorkové razítko (hotovo)

- tools/StampTool.ts (`mode` 'clone' | 'pattern'): tah se kreslí jako u štětce do samostatné stopy (bílá, plná, ořezaná
  výběrem); v dotčeném výřezu se z originálu na začátku tahu složí cíl + obraz zdroje maskovaný stopou s krytím a režimem
  prolnutí. Zamčená průhlednost přes `restoreAlpha`, celý tah = jeden `PaintCommand`.
- Zdroj razítka: `{ doc, x, y }` v souřadnicích dokumentu (Alt+klik), posun zdroj − cíl; zarovnané = posun platí, dokud se
  nezmění zdroj, jinak se počítá od začátku každého tahu. Obraz zdroje se vezme na začátku tahu: aktuální vrstva
  (u téhož dokumentu kopie cíle), aktuální a nižší / všechny vrstvy (`compositeLayers`), u jiného dokumentu jeho aktivní
  vrstva. Zavřený zdrojový dokument = zdroj zrušen.
- Maska: hodnota = původní + (zdroj − původní) · stopa · krytí (u vzorku jas), počítá se v JS jen ve výřezu.
- Vzorkové razítko: `canvasPattern` s počátkem v (0, 0) dokumentu, nezarovnané v bodě začátku tahu; výběr vzorku
  tlačítkem v liště voleb (`showPatternPicker`).
- Overlay: kruh štětce a zaměřovač zdroje (Alt = zaměřovač na místě kurzoru, kurzor `crosshair`).
- `Editor.notice(text)` + ui/toast.ts: krátká bublina dole (např. „Nejdřív nastavte zdroj“).
- Testy e2e: bez zdroje upozornění, Alt+klik, klon, zarovnané / nezarovnané, krytí, výběr, zpět, zdroj aktuální / nižší /
  všechny vrstvy, zdroj z jiného dokumentu, maska, vzorek zarovnaný / nezarovnaný, volba vzorku, lišta voleb.

## Verze 0.21 – Retušovací štětce (hotovo)

- core/paint/heal.ts: `healRegion(dst, src, inside)` = zdroj + d, kde d = cíl − zdroj je známé mimo oblast a uvnitř se
  dopočítá jako harmonická funkce (Laplaceova rovnice, membrána). `membrane`: multigrid (hrubší úroveň = průměr známých
  z bloku 2 × 2, bilineární odhad, 12 iterací červeno-černého Gauss–Seidela), pak doladění sdruženými gradienty
  (≤ 50 iterací, všechny kanály najednou) – hrubé úrovně posouvají okraje o půl pixelu a zbylá hladká chyba by
  Gauss–Seidelem mizela pomalu. Oblast 300 × 300 s 56 tis. neznámými ≈ 0,3 s v Node, běžný tah desítky ms.
- `findPatchOffset`: bodové retušování zkouší 16 směrů × vzdálenosti 1,1–3,2 × velikost štětce; posunutá oblast musí
  být celá v obrázku a mimo vadu, skóre = rozdíl okraje (3 px kolem vady) proti okraji posunutého místa, bližší mírně
  zvýhodněné.
- tools/StampTool.ts rozšířen o režimy 'heal' (Retušovací štětec, zdroj jako razítko, během tahu náhled klonu) a 'spot'
  (Bodový, během tahu poloprůhledné ztmavení). Po puštění `finishHeal`: výřez tahu (u bodového i s okolím), cíl = vrstva
  nebo složený obraz (vzorek ze všech vrstev → retuš na prázdnou vrstvu), výsledek maskovaný stopou přes originál
  s režimem prolnutí; celý tah jeden krok historie. Maska: upozornění, retušují se jen pixely.
- Lišta: retušování bez krytí, bodové bez zarovnání, s volbou „Vzorek všech vrstev“.
- Testy: membrána (lineární průběh mezi sloupci, bez známých), retuš (textura ze zdroje, jas z cíle), okraj, hledání
  zdroje; e2e retušovací štětec vs. razítko (jas), napojení na okraji, bodové odstranění vady, zpět, retuš na prázdnou
  vrstvu, maska, výběr.

## Verze 0.22 – Záplata a guma pozadí (hotovo)

- tools/PatchTool.ts: mimo výběr deleguje na vnitřní `LassoTool('free')` (výběr včetně režimů Shift / Alt), tah uvnitř
  výběru posouvá záplatu. Během tažení se posouvá obrys (`doc.setSelection` bez historie) a v měněném výřezu je náhled
  (zdrojové pixely maskované výběrem přes kopii originálu). Po puštění: originál zpět, `healRegion` (výřez výběru + 2 px
  okraj, uvnitř = výběr > 0), smíchání podle síly výběru a `paintLayer` = jeden krok „Záplata“. Zdroj: měněné místo =
  výběr, zdroj posunutý; Cíl: měněné místo = posunutý výběr, zdroj = původní výběr. Výběr zůstane na místě.
- tools/BackgroundEraserTool.ts: otisky po ¼ velikosti podél tahu; barva vzorku (průběžně z originálu pod středem /
  jednou / barva pozadí), rozdíl = největší rozdíl kanálů, do ½ tolerance maže úplně, do tolerance lineárně zčásti;
  chránit barvu popředí; souvislé = flood fill od středu v kruhu. Alfa i barvy se berou z originálu na začátku tahu
  a nová alfa = min(aktuální, originál · (1 − síla)), takže se překrývající otisky nesčítají. Výběr násobí sílu.
- Nástroje Záplata a Guma pozadí nahradily zástupné; ikony Puzzle a BrushCleaning.
- Testy e2e: laso záplatou, náhled a posunutý obrys během tažení, odstranění vady, zpět, režim Cíl (textura s jasem
  cíle), zámek; guma pozadí průběžně, tolerance, nesouvislé / souvislé, jednou, barva pozadí, chránit popředí, výběr,
  měkká tolerance bez sčítání, maska.

## Verze 0.23 – Rozostření, zostření, rozmazání, zesvětlení, ztmavení, houba (hotovo)

- core/paint/retouch.ts (čisté funkce): `brushWeight` (měkký okraj podle tvrdosti, smoothstep; 100 % = kruh s vyhlazeným
  okrajem), `toneCurve` / `toneImage` (střední tóny = gama, stíny / světla s vahou podle hodnoty, všechny křivky rostoucí
  i při expozici 100 %; Chránit tóny = křivka z jasu a škálování barev k černé / bílé, jinak po kanálech), `spongeImage`
  (posun od / k šedé stejného jasu, živost bez ořezu kanálů), `blurImage` (Gauss σ = 0,5 + 3 · síla), `sharpenImage`
  (maska rozostření 1 px, 0–200 %), `smudgeDab` / `smudgeCarry` (nesená barva jako v GIMPu, předem vynásobená alfa),
  `mixByWeight` (míchání s předem vynásobenou alfou, zamčená průhlednost).
- tools/RetouchTool.ts – jeden nástroj, šest režimů. Efektové režimy: stopa = maximum otisků (Uint8 přes plátno cíle),
  efekt se počítá z obrazu na začátku tahu po dlaždicích 128 × 128 (rozostření s okolím) až při prvním dotyku tahu,
  dotčený obdélník = originál + (efekt − originál) · stopa · výběr. V jednom tahu se tak efekt nesčítá, další tah ano.
  Rozostření / zostření ze všech vrstev = efekt ze složeného obrazu zapsaný do aktivní vrstvy. Rozmazání: otisky po
  1/25 velikosti (řidší nechávaly „žebra“), síla přepočtená na úbytek nesené barvy na 1/10 velikosti štětce.
  Maska se upravuje jako šedý obraz (hodnota v RGB, zpět do alfy); houba masku nemění (upozornění).
- Nahradily zástupné nástroje; ikony Droplet, Triangle, Pointer, Sun, Moon, SprayCan; volby Tvrdost, Síla / Expozice /
  Tok, Ze všech vrstev, Malování prstem, Rozsah, Chránit tóny, Režim, Živost.
- Testy: stopa, tónové křivky (gama, rozsahy, monotónnost, chránit tóny), houba, rozostření / zostření hrany, rozmazání
  (přenos, průhledné okolí, mimo vrstvu, malování prstem), míchání; e2e všech šesti nástrojů (hodnoty, nesčítání v jednom
  tahu, zpět, výběr, zamčená průhlednost, ze všech vrstev do prázdné vrstvy, maska, zkratka O a lišta voleb, tah myší).

## Plán dalších verzí

### Další
- Magická hůlka a magnetické laso ve workeru; vícevláknový výpočet velkých filtrů (pruhy obrazu ve více workerech).
- Obrys (kontura) úkosu, záře a saténu; vzorek jako zdroj plechovky a štětce; styly skupin.
- Svislý text, styly odstavce; masky skupin a ořezová maska nad skupinou.
- Náhled zdroje uvnitř štětce razítka; retušování ve workeru; airbrush (sčítání efektu během tahu) a tlak pera.
- Červené oči, Nahrazení barvy, Vzorkovač barev, Pravítko.
- Výkon dál: rozdělení i pro vrstvy uvnitř skupin, změna krytí bez přepočtu zmenšeniny celého obrazu, případně WebGL.
