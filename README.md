# nootropic.fm — Open Research Psychoacoustic Platform

Platformă audio cognitivă auto-educativă, bazată pe literatură psihoacustică verificată și învățare continuă din feedback real (Contextual Multi-Armed Bandit / Thompson Sampling).

## Arhitectură (\$0 / lună pe Cloudflare Workers Free Tier)

- **Frontend + PWA:** React + TypeScript + Tailwind CSS + Web Audio API (sinteză procedurală multi-strat direct pe device — cost \$0 per sesiune).
- **Backend API:** Cloudflare Worker (`worker/index.ts`) cu rutare `/api/*` via `@cloudflare/vite-plugin`.
- **Bază de date:** Cloudflare D1 (SQLite la edge) cu profiluri anonimizate, sesiuni, statistici Bandit pe cohorte/profiluri și export anonimizat JSON/CSV.
- **Parser contextual:** Deterministic local (română + engleză) + suport opțional pentru Gemini Flash cu plafon zilnic strict (`GEMINI_DAILY_CAP`).

## Rulare locală

```bash
npm install
npm run dev
```

Aplicația pornește atât interfața web, cât și Cloudflare Worker API + baza de date SQLite locală (auto-inițializată la prima cerere).

## Deploy pe Cloudflare Workers (`nootropic.fm` sau `app.nootropic.fm`)

1. Autentifică Wrangler:
   ```bash
   npx wrangler login
   ```
2. Creează baza de date D1 în Cloudflare:
   ```bash
   npx wrangler d1 create nootropic-fm-db
   ```
   Copiază `database_id` primit în `wrangler.jsonc`.
3. Aplică schema SQL în producție:
   ```bash
   npm run db:migrate:remote
   ```
4. Deploy:
   ```bash
   npm run deploy
   ```
5. În Cloudflare Dashboard → Workers → `nootropic-fm` → Settings → Domains & Routes → adaugă Custom Domain `nootropic.fm` (sau `app.nootropic.fm` dacă păstrezi site-ul principal pe Shopify).
