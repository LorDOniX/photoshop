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
| Přesun / Štětec, Tužka / Guma, Guma pozadí, Kouzelná guma / Ruka / Lupa | V / B / E / H / Z (skupinu rozbalí pravé tlačítko na ikoně) |
| Kapátko (Alt = barva pozadí) / Přechod, Plechovka | I / G (skupinu rozbalí pravé tlačítko na ikoně) |
| Kapátko ve štětci, plechovce a přechodu | Alt + klik (tažením průběžně) |
| Razítko, Vzorkové razítko / zdroj razítka | S / Alt + klik |
| Bodový retušovací štětec, Retušovací štětec, Záplata / zdroj retuše | J / Alt + klik |
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
| Úrovně / Křivky / Odstín/sytost / Vyvážení barev / Černobílý | `Ctrl+L` / `Ctrl+M` / `Ctrl+U` / `Ctrl+B` / `Ctrl+Alt+Shift+B` |
| Invertovat / Odbarvit | `Ctrl+I` / `Ctrl+Shift+U` |
| Automatický tón / kontrast / barvy | `Ctrl+Shift+L` / `Ctrl+Alt+Shift+L` / `Ctrl+Shift+B` |
| Poslední filtr / Zeslabit poslední filtr nebo úpravu | `Ctrl+Alt+F` / `Ctrl+Shift+F` |
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
| Uložit projekt / Uložit jako PSD / Export PNG | `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+Alt+S` (JPG a WEBP v Soubor → Exportovat jako) |

**Úpravy obrazu** (Obraz → Úpravy): jas/kontrast, úrovně (s histogramem, po kanálech, *Automaticky* / *Kontrast*), křivky
(graf: klik přidá bod, tažení posouvá, odtažení mimo graf smaže; pole Vstup / Výstup; po kanálech), expozice, živost,
odstín/sytost (i kolorovat), vyvážení barev (stíny / střední tóny / světla, zachovat světlost), černobílý (váhy šesti barev,
tónování), fotofiltr, invertovat, posterizace, práh, mapa přechodu (přes editor přechodů) a odbarvit; v menu Obraz také
automatický tón, kontrast a barvy. Úprava se ukazuje přímo ve vrstvě (vypínač *Náhled*), *OK* je jeden krok historie,
Zrušit / Esc vrátí originál; dvojklik na posuvník vrátí výchozí hodnotu. Upravuje se aktivní vrstva – jen ve výběru
(měkký okraj výběru upraví napůl), v režimu úprav masky maska. Textovou vrstvu úprava zrastruje (jen po OK).

**Filtry** (menu Filtr): rozostření (průměr, Gaussovské, rámečkové, pohybem, radiální otočením / přiblížením), zkreslení
(sevření, polární souřadnice, zvlnění, kulovitost, zkroucení), šum (přidat šum, odstranit skvrny, medián), pixelizace (mozaika),
vykreslit (mraky z barvy popředí a pozadí), zostření (zostřit, zostřit více, maska rozostření), stylizace (reliéf, najít
hrany, solarizace) a další (horní propust, posun, barva na alfu). Zkreslení a radiální rozostření mají střed uprostřed
výběru (bez výběru uprostřed vrstvy).
Stejně jako úpravy se ukazují přímo ve vrstvě, *OK* je jeden krok historie, filtrují jen výběr (rozostření bere v potaz
i okolí výběru) a v režimu úprav masky nebo na vrstvě úprav masku. Dialog si pamatuje poslední nastavení, *Poslední filtr*
(`Ctrl+Alt+F`) ho zopakuje bez dialogu. *Úpravy → Zeslabit…* (`Ctrl+Shift+F`) prolne poslední filtr nebo úpravu obrazu
s původním stavem (krytí a režim) – jen dokud je posledním krokem historie. Rozostření průhledné okolí neztmaví. U velkých
obrázků (nad 0,6 Mpx ve výběru) ukazuje náhled během změn nejdřív zmenšenou verzi a po čtvrt sekundy bez změn plné rozlišení;
*OK* vždy počítá v plném rozlišení. Totéž platí pro úpravy obrazu. Filtry i úpravy se počítají na pozadí (Web Worker), takže
rozhraní během výpočtu nezamrzá; když potvrzení trvá déle, ukáže se „Počítám…“ a do konce výpočtu se nedá nic dělat.

**Vrstvy úprav** (Vrstva → Nová vrstva úprav, nebo tlačítko s půlkruhem dole v panelu Vrstvy): stejné úpravy jako v Obraz →
Úpravy, ale nedestruktivně – vrstva upraví všechno pod sebou a jde kdykoli změnit (dvojklik na její ikonu v panelu nebo
Vrstva → Upravit obsah vrstvy…), skrýt, ztlumit krytím nebo smazat. Vrstva má masku (z výběru, bez něj odkrývá vše); štětec,
guma, přechod i úpravy na vrstvě úprav pracují s maskou. Ořezaná vrstva úprav (`Ctrl+Alt+G`) upraví jen vrstvu pod sebou,
ve skupině s krytím pod 100 % nebo jiným režimem jen obsah skupiny. *Sloučit dolů* úpravu zapeče do vrstvy pod ní.

**Výplňové vrstvy** (Vrstva → Nová výplňová vrstva → Barva / Přechod / Vzorek): vrstva přes celé plátno s maskou, výplň jde
kdykoli změnit dvojklikem na náhled. Kreslení do výplňové vrstvy ji zrastruje (jako text).

**PSD (Photoshop):** soubory `.psd` jde otevřít (Soubor → Otevřít nebo přetažením) a uložit (Soubor → Uložit jako PSD,
`Ctrl+Shift+S`). Převádí se vrstvy, skupiny, názvy, viditelnost, krytí i krytí výplně, režimy prolnutí, poloha, masky vrstev,
ořezové masky, zámky, vrstvy úprav (všech 13 druhů, které editor umí) a výplňové vrstvy (barva, přechod, vzorek), styly vrstvy (úkos a reliéf, satén, stíny, záře, tah barvou, překrytí barvou, vícebarevným přechodem
a vzorkem, i s režimy prolnutí); použité vzorky se uloží do souboru; soubor obsahuje i sloučený náhled.
**Textové vrstvy** z Photoshopu jde upravovat jako text (písmo, velikost, řez, barva, zarovnání): dokud se text nezmění,
ukazuje přesně pixely z Photoshopu, při první úpravě ho editor vykreslí sám na stejném účaří. Otočený, deformovaný nebo svislý
text zůstane obrázkem. Text z editoru se do PSD ukládá jako textová vrstva (Photoshop ho zobrazí a při úpravě vykreslí po svém).
Co editor neumí – šumové přechody, středy mezi zastávkami přechodu, reliéf tahu, textura a obrys úkosu, obrys saténu, otočení vzorku,
ostatní vrstvy úprav (míchání kanálů, výběrová barva, vyhledání barev), úpravy jednotlivých barev v odstínu/sytosti, tvary
a vektorové masky, některé režimy prolnutí – se při otevření vypíše; inteligentní objekty se otevřou jako obrázek. Pro úplné uchování práce je
dál nejlepší vlastní formát `.ptsp`.

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

**Razítko (S):** Alt+klik nastaví zdroj (může být i v jiném otevřeném dokumentu), tah pak kreslí obraz ze zdroje
posunutý stejně jako kurzor – křížek ukazuje, odkud se právě bere. *Zarovnané* drží posun i pro další tahy, bez něj
začne každý tah znovu ze zdrojového bodu. *Vzorek:* aktuální vrstva, aktuální a nižší, nebo všechny vrstvy (vždy stav na
začátku tahu). Velikost a krytí sdílí se štětcem, je tu i režim prolnutí; kreslí jen ve výběru, v režimu úprav masky
klonuje masku. **Vzorkové razítko** (ve stejné skupině) kreslí vybraným vzorkem z knihovny – zarovnané navazuje na
dlaždice v celém dokumentu, jinak začíná v místě tahu.

**Retušovací štětce (J):** *Retušovací štětec* se ovládá jako razítko (Alt+klik = zdroj, zarovnané, vzorek vrstev), ale po
puštění tahu převezme ze zdroje jen texturu – barva a jas se plynule napojí na okolí, takže záplata nesedí jako cizí
kus. *Bodový retušovací štětec* nepotřebuje zdroj: stačí přetřít vadu (místo se během tahu ztmaví) a po puštění se
v okolí najde podobné místo a vada se zaretušuje. *Vzorek všech vrstev* dovolí retušovat na samostatnou prázdnou
vrstvu. Retušuje se jen ve výběru a jen pixely (ne maska).

**Záplata (J):** nakreslete kolem vady výběr (mimo výběr nástroj kreslí jako laso, Shift / Alt přidá / odebere) a
přetáhněte ho na zdravé místo – v režimu *Zdroj* se vada nahradí texturou z místa, kam výběr pustíte, a barvy se napojí
na okolí. V režimu *Cíl* se naopak vybrané místo přenese tam, kam ho přetáhnete. Během tažení je vidět náhled.

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

**Ořezová maska** (`Ctrl+Alt+G` nebo Alt+klik na vrstvu v panelu): vrstva je vidět jen tam, kde má pixely vrstva pod ní (základ – v panelu podtržený,
ořezaná vrstva má šipku). Krytí, režim a viditelnost základu platí pro celou ořezovou masku.

**Tužka** kreslí bez vyhlazení (ostré pixely; *Automatické mazání* = tah začatý na barvě popředí kreslí barvou pozadí).
**Kouzelná guma** jedním klikem vymaže oblast podobné barvy. **Guma pozadí** maže v kruhu štětce jen barvu podobnou té pod
středem štětce (křížek) – stačí vést střed po pozadí podél okraje objektu. Vzorkování průběžně / jednou (barva na začátku
tahu) / barva pozadí, omezení souvislé / nesouvislé, tolerance (na okraji tolerance maže jen zčásti) a *Chránit barvu
popředí*. **Úpravy → Obrys…** obtáhne okraj výběru (bez výběru okraj
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

**Styly vrstvy** (Vrstva → Styl vrstvy…, tlačítko *fx* v panelu Vrstvy nebo klik na odznak *fx* u vrstvy): úkos a reliéf
(vnitřní / vnější úkos, reliéf, polštářový reliéf; hladký nebo dláto; hloubka, směr, velikost, změkčení, úhel a výška světla,
světla a stíny s vlastní barvou, krytím a režimem), tah (vně / na střed / uvnitř), vnitřní stín, vnitřní záře (od okraje nebo
ze středu), satén (lesk z posunutých kopií tvaru), překrytí barvou, překrytí vzorkem (vzorek se posouvá s vrstvou, měřítko),
překrytí přechodem (libovolný přechod z editoru; lineární, kruhový, úhlový, zrcadlený,
kosočtverečný; úhel, měřítko), vnější záře a vržený stín. V dialogu se efekty zapínají vlevo a nastavují vpravo; stíny, záře a překrytí mají vlastní režim
prolnutí (stín výchozí *Násobit*, záře *Závoj*). Změny se ukazují hned, *OK* je jeden krok historie, Esc vrátí původní stav.
Jednotlivé efekty jde otevřít i z menu Vrstva → Styl vrstvy. Styl se počítá z obsahu vrstvy, takže se přizpůsobí kreslení
i textu. *Vymazat styl vrstvy* styly odebere, sloučení vrstvy styly „zapeče“ do pixelů.

**Výplň** (panel Vrstvy, vedle zámků): krytí výplně – na rozdíl od krytí vrstvy ztlumí jen obsah a vnitřní styly (překrytí,
vnitřní stín a záře, úkos), vržený stín, vnější záře a tah zůstanou. S výplní 0 % tak zbude jen styl (např. obrys nebo stín
textu). Vržený stín je pod obsahem vrstvy vykrojený jako ve Photoshopu.

**Editor přechodů** (klik na náhled přechodu v liště nástroje Přechod, nebo pole *Přechod* v překrytí přechodem): knihovna
přechodů nahoře, pod ní pruh se zastávkami – barevné pod pruhem, krytí nad ním. Klik do prázdného místa přidá zastávku, tažením
se posouvá, odtažením od pruhu se smaže; vybraná zastávka má pole pro barvu / krytí a polohu. Potvrzený přechod se v nástroji
Přechod objeví jako předvolba *Vlastní*. *Přidat do knihovny* (s názvem) přechod uloží v prohlížeči natrvalo; vlastní přechody
v knihovně jde smazat křížkem (po najetí myší).

**Vzorky:** *Úpravy → Definovat vzorek…* uloží sloučený obraz ve výběru (bez výběru celé plátno, nejvýš 1000 × 1000 px) do
knihovny vzorků v prohlížeči. *Úpravy → Vyplnit vzorkem…* vyplní výběr (bez výběru celou vrstvu) dlaždicemi vybraného vzorku
zarovnanými na počátek dokumentu. Výběr vzorků ukazuje vestavěné vzorky (šachovnice, pruhy, puntíky, mřížka, cihly, šum,
plátno), vlastní vzorky (smazat křížkem) a vzorky z otevřených souborů. Projekt `.ptsp` i PSD nesou použité vzorky s sebou,
takže se otevřou správně i jinde.

**Slučování:** *Sloučit dolů* vykreslí aktivní vrstvu (s krytím, režimem prolnutí a maskou) do vrstvy pod ní; výsledek si ponechá
název, krytí a režim spodní vrstvy (jako ve Photoshopu). *Sloučit viditelné* spojí viditelné vrstvy do jedné, skryté zůstanou.
*Zploštit obraz* složí vše na bílé pozadí velikosti plátna a skryté vrstvy zahodí (po potvrzení).

Levý panel nástrojů se v nízkém okně rozloží do dvou až tří sloupců.

Ve vývojovém režimu je editor dostupný v konzoli prohlížeče jako `window.editor`.

## Nasazení

- `npm run upload` – build a nahrání `dist/` na FTP do `/www/subdom/app/photoshop/` = https://app.makuderovi.cz/photoshop/
- balíček [`wedos-upload`](https://github.com/LorDOniX/wedos-upload), cíl v `package.json` pod klíčem `wedosUpload`, přístup na FTP v proměnných prostředí `WEDOS_FTP_HOST`, `WEDOS_FTP_USER`, `WEDOS_FTP_PASSWORD`
- nahrávají se jen změněné soubory (stav serveru v `build-data/upload.json`, patří do gitu); `npx wedos-upload --dry-run` vypíše změny, `--full` nahraje vše
