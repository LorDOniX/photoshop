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

Později podle potřeby: WebGL/WebGPU renderer (velmi velké obrázky), Web Worker + `OffscreenCanvas` pro náročné výpočty (magická hůlka, magnetické laso).

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

## Plán dalších verzí

### Další
- Otevírání a ukládání PSD (knihovna `ag-psd` – nainstalovat `npm i ag-psd`).
- Svislý text, styly odstavce; masky skupin a ořezová maska nad skupinou.
- Guma pozadí, razítko; Alt+klik mezi vrstvami v panelu = ořezová maska.
- Výkon dál: rozdělení i pro vrstvy uvnitř skupin, změna krytí bez přepočtu zmenšeniny celého obrazu, případně WebGL.
