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

## Plán dalších verzí

### 0.6 – Text a skupiny vrstev
- Textová vrstva (nový typ vrstvy s vlastnostmi písma, rastrování při vykreslení, úprava dvojklikem), rastrovat vrstvu.
- Skupiny vrstev (složky) – stromová struktura v `ImageDocument`, sbalení v panelu, `Ctrl+G`; uložení do `.ptsp` (verze formátu 3).

### Další
- Tužka, kouzelná guma, guma pozadí; Úpravy → Obrys…; ořezová maska.
- Výkon: dirty-rect kompozice, cache „vrstvy pod / nad aktivní“, případně WebGL renderer; omezení paměti historie (volitelný limit / ukládání starých kroků do IndexedDB).
- Automatické ukládání do IndexedDB, otevírání PSD (knihovna `ag-psd`).
