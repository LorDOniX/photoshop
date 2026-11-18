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
| Přesun / Štětec / Guma / Ruka / Lupa | V / B / E / H / Z |
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
| Posun pohledu | mezerník + tažení, prostřední tlačítko, Shift + kolečko |
| Zoom | kolečko, `Ctrl++` / `Ctrl+-`, `Ctrl+0` přizpůsobit, `Ctrl+1` pixel na pixel |
| Pravítka | `Ctrl+R` |
| Krok zpět / vpřed | `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+Y` |
| Nová vrstva | `Alt+Shift+N` |
| Uspořádat vrstvy | `Ctrl+]` / `Ctrl+[`, se `Shift` zcela nahoru / dolů |
| Nový / Otevřít / Otevřít a vložit | `Ctrl+Alt+N` / `Ctrl+O` / `Ctrl+Shift+O` |
| Uložit projekt / Export PNG | `Ctrl+S` / `Ctrl+Alt+S` |

Obrázky lze do editoru také přetáhnout nebo vložit ze schránky (`Ctrl+V`) – přidají se jako nová vrstva.
Vrstvy se přejmenují dvojklikem, pořadí se mění přetažením, pravé tlačítko otevře kontextové menu vrstvy,
Ctrl+klik na náhled vybere pixely vrstvy. Štětec a guma kreslí jen uvnitř výběru.

**Masky:** ikona masky v patičce panelu Vrstvy přidá masku (s výběrem jen vybranou oblast, Alt = opačně), další volby jsou
v menu Vrstva → Rastrová maska. Při úpravě masky štětec černou skrývá a bílou odkrývá, guma kreslí barvou pozadí.
Na náhledu masky: Shift+klik = vypnout/zapnout, Ctrl+klik = výběr z masky, pravé tlačítko = menu masky.
Ve vzorníku klik nastaví barvu popředí, Alt+klik barvu pozadí.

Ve vývojovém režimu je editor dostupný v konzoli prohlížeče jako `window.editor`.
