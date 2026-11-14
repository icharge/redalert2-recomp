# The game's string tables (CSF)

What a label says, and which label a screen uses, is a question that comes up
when patching a dialog or writing a CSF override (`web/src/storage/csf.ts`,
[web/storage.md](web/storage.md)). This page says where the tables are and how to read them.

## Where they are

| Edition | Table | Where |
|---|---|---|
| Yuri's Revenge | `ra2md.csf` | inside `langmd.mix` (not encrypted) |
| Red Alert 2 | `ra2.csf` | inside `language.mix` (encrypted: header flag `0x2`) |
| either | `ra2.csf`, `ra2md.csf` | loose, in a translation folder (`Resources/Translations/<lang>/`) |
| either | `stringtable00.csf`, `stringtable01.csf` | loose, small: launcher/CnCNet strings |

A table is a header and `LBL` entries holding inverted UTF-16LE text; the
reader is `parse()` in `tools/csf_dump.py` and `web/src/storage/csf.ts`.

## Reading one

```
py -3 tools/csf_dump.py find "Westwood Online" E:/Games/Westwood/RA2/langmd.mix:ra2md.csf
py -3 tools/csf_dump.py dump E:/Games/Westwood/RA2/langmd.mix:ra2md.csf -o work/csf/ra2md.txt
```

`dump` writes one `LABEL<TAB>text` line per label. `tools/csf_dump.py` reads an
unencrypted MIX itself. For `language.mix` use the web code's `readMixEntry`
(`web/src/storage/mix.ts`), or a loose `ra2.csf` from a translation folder.

## Why the text is not in this repo

The tables are Westwood/EA's text, and the repo does not redistribute retail
content (`.gitignore`, "Retail game files"; `docs/web/decisions.md` D8). So the
dump goes under `work/csf/`, which is ignored, and anyone with the game
regenerates it with the command above. The tool and this page are what is kept.

## Label index: "Westwood Online"

The 23 labels of the Yuri's Revenge table whose text names Westwood Online
(checked against `langmd.mix` on 2026-11-14; the Simplified Chinese
translation has 21 of them, without `TXT_USER_NOT_ONLINE` and
`GUI:IconGlossary`).

| Where the engine shows it | Labels |
|---|---|
| Menu and login titles | `GUI:WOLWelcome` (the text is only the name), `GUI:LoginsScreen`, `GUI:GetWOLAccount`, `GUI:GetNewsletter`, `GUI:IconGlossary` |
| Connection status | `TXT_CONNECTING_SERVER`, `TXT_CANT_CONNECT`, `TXT_BANNEDTILL` (has a `%hs`), `TXT_WOL_CONNLOST`, `TXT_WOL_LOGGING_OUT`, `TXT_USER_NOT_ONLINE` (has a `%s`) |
| WOLAPI errors, paging | `TXT_APIMISSING`, `TXT_APIWRONGVERSION`, `TXT_PAGEUSER_DESC` |
| Button tooltips | `STT:WOLLobbyOptions`, `STT:WOLLobbyBack`, `STT:WOLLoginNickname`, `STT:WOLLoginLogin`, `STT:WOLNewAccount`, `STT:WOLLoginBack`, `STT:WOLMatchCancel`, `STT:WOLWelcomeMyInformation`, `STT:IGRLogin`, `WOL:WDTFactionBack` |

The browser build changes a label's text with the launcher's `strings.json`
([web/storage.md](web/storage.md), "String tables and `strings.json`"). A
native mod ships its own `ra2md.csf` or `ra2.csf` (`mods/README.md`).
