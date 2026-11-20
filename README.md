# PhotoshopTS

Jednoduchý webový editor obrázků (TypeScript + Vite). Návrh a plán: [../navrh.md](../navrh.md).

## Spuštění

```powershell
npm install
npm run dev      # vývojový server (http://localhost:5173)
npm test         # testy jádra (Vitest)
npm run build    # typová kontrola + produkční build do dist/
```

> V PowerShellu s vypnutými skripty použijte `npm.cmd` místo `npm`.

## Rozhraní

Rozložení vychází z [Photopea](https://www.photopea.com/): horní menu, lišta voleb aktivního nástroje, vlevo nástroje
ve skupinách (pravé tlačítko nebo podržení rozbalí skupinu), pravítka, záložky dokumentů a vpravo dok
se sloupcem ikon a panely Historie | Vzorník a Vrstvy | Kanály | Cesty.

Funkce, které ještě nejsou hotové, jsou v UI **připravené**: položky menu jsou zašedlé, připravené nástroje
mají v liště voleb štítek „Připravujeme“ a jejich volby zatím nic nedělají.

## Ovládání

| Akce | Zkratka |
|---|---|
| Přesun / Štětec, Tužka / Guma, Kouzelná guma / Ruka / Lupa | V / B / E / H / Z (skupinu rozbalí pravé tlačítko na ikoně) |
| Kapátko (Alt = barva pozadí) / Přechod, Plechovka | I / G (skupinu rozbalí pravé tlačítko na ikoně) |
| Kapátko ve štětci, plechovce a přechodu | Alt + klik (tažením průběžně) |
| Přechod: úhel po 45° / zrušit tažení | Shift / Esc |
| Text: nový / upravit / potvrdit / zrušit | T + klik do plátna / klik na text, Enter na aktivní textové vrstvě / `Ctrl+Enter` nebo klik mimo / Esc |
| Obdélníkový/eliptický výběr / Laso / Kouzelná hůlka, Rychlý výběr | M / L / W (skupinu rozbalí pravé tlačítko na ikoně) |
| Oříznutí (Enter = oříznout, Esc = zrušit) | C |
| Režim výběru | Shift = přidat, Alt = odečíst, Shift+Alt = průnik |
| Posun vybraných pixelů / duplikát / po pixelech | Přesun + tažení ve výběru / Alt + tažení / šipky (Shift = 10 px) |
| Posun obrysu výběru | tažení uvnitř výběru nástrojem výběru, šipky |
| Upřesnit okraj | `Ctrl+Alt+R` |
| Volná transformace (Shift = poměr / po 15°, Alt = od středu) | `Ctrl+Alt+T`, Enter / Esc |
| Velikost obrazu / Velikost plátna / Ořezat | `Ctrl+Alt+I` / `Ctrl+Alt+C` / `Ctrl+.` |
| Laso: uzavřít / smazat bod / zrušit | Enter, dvojklik nebo klik na počátek / Backspace / Esc |
| Vybrat vše / Odznačit / Znovu vybrat / Inverze | `Ctrl+A` / `Ctrl+D` / `Ctrl+Shift+D` / `Ctrl+Shift+I` |
| Prolnout výběr | `Shift+F6` (další úpravy v menu Výběr → Upravit) |
| Vymazat / Vyplnit popředím / pozadím | `Delete` / `Alt+Backspace` / `Ctrl+Backspace` |
| Kopírovat / Kopírovat sloučené / Vyjmout / Vložit | `Ctrl+C` / `Ctrl+Shift+C` / `Ctrl+X` / `Ctrl+V` |
| Vrstva kopírováním / vyjmutím | `Ctrl+J` / `Ctrl+Shift+J` |
| Upravovat masku / pixely vrstvy | `Ctrl+\` nebo klik na náhled masky / vrstvy |
| Velikost štětce | `[` `]` |
| Prohodit / výchozí barvy | `X` / `D` |
| Posun pohledu | dva prsty na touchpadu (všemi směry), kolečko myši (Shift = vodorovně), mezerník + tažení, prostřední tlačítko |
| Zoom (k místu kurzoru) | sevření prstů, `Ctrl` / `Cmd` / `Alt` + kolečko nebo dva prsty, `Ctrl++` / `Ctrl+-`, `Ctrl+0` přizpůsobit, `Ctrl+1` pixel na pixel |
| Pravítka | `Ctrl+R` |
| Krok zpět / vpřed | `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+Y` |
| Předvolby (paměť historie) | `Ctrl+K` |
| Nová vrstva | `Alt+Shift+N` |
| Sloučit dolů (na skupině = sloučit skupinu) / Sloučit viditelné | `Ctrl+E` / `Ctrl+Shift+E` (Zploštit obraz v menu Vrstva) |
| Seskupit / zrušit seskupení | `Ctrl+G` / `Ctrl+Shift+G` |
| Ořezová maska (vytvořit / uvolnit) | `Ctrl+Alt+G` |
| Skrýt / zobrazit vybrané vrstvy | `Ctrl+,` |
| Výběr více vrstev | Shift+klik (rozsah), Ctrl/Cmd+klik (přidat / odebrat) v panelu Vrstvy, `Ctrl+Alt+A` všechny |
| Uspořádat vrstvy | `Ctrl+]` / `Ctrl+[`, se `Shift` zcela nahoru / dolů |
| Nový / Otevřít (i více souborů) / Otevřít a vložit | `Ctrl+Alt+N` / `Ctrl+O` / `Ctrl+Shift+O` |
| Uložit projekt / Export PNG | `Ctrl+S` / `Ctrl+Alt+S` (JPG a WEBP v Soubor → Exportovat jako) |

**Více dokumentů:** každý nový nebo otevřený soubor má vlastní záložku s vlastní historií, zoomem a výběrem.
Klik na záložku přepne, × nebo prostřední tlačítko zavře (s neuloženými změnami – tečka u názvu – se zeptá),
Soubor → Zavřít zavře aktivní. Soubory přetažené na lištu záložek se otevřou jako nové dokumenty.
Kopírovat / vložit funguje i mezi záložkami.

Obrázky přetažené na plátno nebo vložené ze schránky (`Ctrl+V`) se přidají do aktuálního dokumentu jako nová vrstva.
Vrstvy se přejmenují dvojklikem, pořadí se mění přetažením, pravé tlačítko otevře kontextové menu vrstvy,
Ctrl+klik na náhled vybere pixely vrstvy. Štětec, guma, plechovka a přechod kreslí jen uvnitř výběru.

**Masky:** ikona masky v patičce panelu Vrstvy přidá masku (s výběrem jen vybranou oblast, Alt = opačně), další volby jsou
v menu Vrstva → Rastrová maska. Při úpravě masky štětec černou skrývá a bílou odkrývá, guma kreslí barvou pozadí.
Na náhledu masky: Shift+klik = vypnout/zapnout, Ctrl+klik = výběr z masky, pravé tlačítko = menu masky.
Ve vzorníku klik nastaví barvu popředí, Alt+klik barvu pozadí.
Plechovka a přechod v režimu úprav masky kreslí do masky jasem barvy (stejně jako štětec).

**Text:** klik nástrojem Text (T) založí textovou vrstvu a píše se přímo na plátně (víc řádků přes Enter).
Písmo, řez, velikost, barva, řádkování a zarovnání jsou v liště voleb – během psaní se mění naživo, bez psaní mění
aktivní textovou vrstvu. Textová vrstva zůstává upravitelná i po přesunu, změně velikosti obrazu a uložení projektu;
štětec, výplň, transformace apod. ji nejdřív zrastrují (samostatný krok historie, jde vrátit). Vrstva → Rastrovat ji převede ručně.

**Skupiny:** Ctrl+G vloží aktivní vrstvu do nové skupiny, ikona složky v patičce panelu založí prázdnou skupinu.
Vrstvy se do skupiny přetahují na řádek skupiny (horní okraj řádku = nad skupinu), šipka u skupiny ji sbalí.
Skrytí, krytí a režim prolnutí skupiny platí pro celý obsah; nástroj Přesun posouvá celou skupinu;
Ctrl+[ / Ctrl+] na okraji skupiny vrstvu ze skupiny vyřadí. Smazání skupiny smaže i obsah.

**Více vrstev najednou:** vybrané vrstvy jde naráz seskupit (`Ctrl+G`, skupina vznikne na místě nejvyšší z nich),
sloučit (`Ctrl+E` = Sloučit vrstvy), smazat a posouvat nástrojem Přesun nebo šipkami. Vlastnosti (krytí, režim) se mění
u všech vybraných vrstev.

**Zarovnání:** tlačítka v liště nástroje Přesun (a menu Vrstva → Zarovnat / Rozmístit) zarovnávají obsah vybraných vrstev
– k výběru, je-li nějaký, jinak k sobě navzájem, jedna vrstva k plátnu. *Stejné mezery* potřebují aspoň tři vrstvy.

**Ořezová maska** (`Ctrl+Alt+G`): vrstva je vidět jen tam, kde má pixely vrstva pod ní (základ – v panelu podtržený,
ořezaná vrstva má šipku). Krytí, režim a viditelnost základu platí pro celou ořezovou masku.

**Tužka** kreslí bez vyhlazení (ostré pixely; *Automatické mazání* = tah začatý na barvě popředí kreslí barvou pozadí).
**Kouzelná guma** jedním klikem vymaže oblast podobné barvy. **Úpravy → Obrys…** obtáhne okraj výběru (bez výběru okraj
obsahu vrstvy) barvou popředí – uvnitř, na střed nebo vně, s kulatými rohy.

**Zámky** (tlačítka „Zámek:“ v panelu Vrstvy, platí i pro celou skupinu): *průhledné pixely* – kreslí se jen tam, kde už něco je
(Delete pak maže barvou pozadí); *obrazové pixely* – nejde kreslit, mazat ani transformovat (maska jde dál upravovat);
*pozice* – vrstvu nejde posunout; *vše* – všechny tři zámky. Zámky se ukládají do projektu.

**Velké obrázky a paměť:** při úpravách se překresluje jen změněná oblast a vrstvy pod / nad upravovanou vrstvou se drží
předskládané, takže kreslení zůstává plynulé i u velkých dokumentů s mnoha vrstvami. Historie drží kopie pixelů – nad limitem
(výchozí 1 GB na dokument, Úpravy → Předvolby, `Ctrl+K`) se zahazují nejstarší kroky; panel Historie ukazuje obsazenou paměť,
v jeho nabídce ≡ je *Vymazat historii*.

**Automatické ukládání:** dokumenty s neuloženými změnami se průběžně (pár sekund po poslední úpravě a při odchodu ze stránky)
zálohují do úložiště prohlížeče. Po pádu nebo zavření bez uložení editor při dalším spuštění nabídne jejich obnovu.
Záloha zmizí po uložení projektu (`Ctrl+S`) nebo zavření záložky.

**Slučování:** *Sloučit dolů* vykreslí aktivní vrstvu (s krytím, režimem prolnutí a maskou) do vrstvy pod ní; výsledek si ponechá
název, krytí a režim spodní vrstvy (jako ve Photoshopu). *Sloučit viditelné* spojí viditelné vrstvy do jedné, skryté zůstanou.
*Zploštit obraz* složí vše na bílé pozadí velikosti plátna a skryté vrstvy zahodí (po potvrzení).

Levý panel nástrojů se v nízkém okně rozloží do dvou až tří sloupců.

Ve vývojovém režimu je editor dostupný v konzoli prohlížeče jako `window.editor`.
