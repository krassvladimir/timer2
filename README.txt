JustYou Timer v6.2.3

Oprava počasí na starším Android tabletu:
- primární načtení přes fetch
- automatický záložní požadavek přes XMLHttpRequest
- žádná uložená stará teplota
- při chybě se veřejný panel počasí skryje
- diagnostika v nastavení zůstává a ukazuje skutečný stav spojení
- automatický nový pokus po 30 sekundách
- běžná aktualizace každých 10 minut
- bez vodoznaku

- opraven start odpočtu: vždy se okamžitě počítá z aktuálního času tabletu a 75minutového intervalu
- odstraněn síťový časový offset, který mohl na starším Androidu posunout odpočet
- při načtení se už nezobrazuje žádná výchozí hodnota odpočtu
