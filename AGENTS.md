# mcp-jina: Anweisungen fÃ¼r Coding-Agenten

Jina AI Remote MCP Server als Cloudflare Worker (TypeScript, `wrangler`), Carls eigene Fassung (`nx3labs/mcp-jina`). **Das Repo ist Ã¶ffentlich**: Nichts Vertrauliches committen, auch nicht in Commit-Messages, Issues oder Pull Requests.

## Grundregeln
- Vor grÃ¶ÃŸeren Architekturentscheidungen (Sprache, Framework, Hosting, Datenspeicherung) erst fragen.
- Kleine, in sich geschlossene Ã„nderungen. Ein Thema pro Branch bzw. Pull Request.
- Keine Secrets, API-Keys (auch kein Jina-Key), Tokens, Tracking oder Analytics ins Repo. Lokale Zugangsdaten gehÃ¶ren in `.dev.vars` oder `.env`, beide stehen in `.gitignore`. Im Repo liegt hÃ¶chstens eine `.env.example` ohne Werte. Vor jedem Commit prÃ¼fen, dass nichts davon im Diff steht.
- AbhÃ¤ngigkeiten sparsam, `package-lock.json` immer mit committen.

## Technik
- TypeScript, Cloudflare Worker (`wrangler.jsonc`), MCP SDK, `agents`, `zod`. Formatierung und Lint mit Biome.
- PrÃ¼fen vor jedem Commit: `npm ci` (nur beim ersten Mal), `npm run type-check`, `npm run lint:fix`, `npm run format`.
- Lokal starten mit `npm run dev` (Dev-Server nur im Container, von auÃŸen nicht erreichbar und soll es bleiben).
- **Nie `npm run deploy` oder `wrangler deploy` ausfÃ¼hren** und kein Cloudflare-Login einrichten. Die Auslieferung macht Carl selbst.

## Arbeitsumgebung devbox (Claude Code und Codex auf Carls Server)
Gilt, wenn du in `/projects/mcp-jina` im Container `devbox` arbeitest. Carl steuert dich meist vom Handy aus.
- Arbeite auf einem eigenen Branch `work/<thema>`, nie direkt auf `main`. Committe in kleinen Schritten und pushe den Branch (`git push -u origin work/<thema>`).
- **Nach `main` Ã¼bernehmen nur, wenn Carl es ausdrÃ¼cklich sagt** (z. B. â€žÃ¼bernehmenâ€œ): `main` aktualisieren, Branch mergen, TypprÃ¼fung und Lint prÃ¼fen, `main` pushen.
- Offene Pull Requests (z. B. von Codex Cloud) kannst du dir mit `git fetch` als Branch holen und darauf weiterarbeiten.
- Codex und Claude Code teilen sich diesen Ordner und arbeiten **abwechselnd, nie gleichzeitig**. Damit die Ãœbergabe klappt:
  - **Beim Beenden:** alles committen und den Branch pushen, sodass `git status` sauber ist. Nichts Halbfertiges ungesichert im Ordner lassen.
  - **Beim Start:** `git fetch`, dann `git status -sb` ansehen und den aktuellen Branch prÃ¼fen. Ist der Arbeitsordner nicht sauber, erst Carl fragen und nichts verwerfen. FÃ¼r eine neue Aufgabe von aktuellem `main` aus einen frischen Branch anlegen (`git switch main && git pull --ff-only && git switch -c work/<thema>`). Eine angefangene Aufgabe nur fortsetzen, wenn der Branch dazu passt.
- Carl kann Claude bitten, eine Aufgabe an Codex zu geben: dann `codex exec "<Aufgabe>"` im Projektordner ausfÃ¼hren und das Ergebnis zusammenfassen.
- Eine Werkstatt-Vorschau gibt es fÃ¼r dieses Projekt nicht (kein statischer Build). Der Container hat kein Docker und keinen Zugang zu Serverdiensten.

## Sprache
- Code, Bezeichner und Commit-Messages auf Englisch
- Beschreibungen in Pull Requests und Antworten an Carl auf Deutsch
