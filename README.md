# nootropic.fm — Open Research Psychoacoustic Platform

Platformă audio cognitivă auto-educativă, bazată pe literatură psihoacustică verificată și învățare continuă din feedback real (Contextual Multi-Armed Bandit / Thompson Sampling).

## Infrastructură în producție (\$0 / lună)

- **Domeniu:** `https://nootropic.fm` & `https://www.nootropic.fm` (DNS gratuit pe **Cloudflare Free**, nameservere `elliot.ns.cloudflare.com` & `nina.ns.cloudflare.com` configurate în Shopify Admin).
- **Aplicație & API:** Cloudflare Workers + Static Assets (`nootropic-fm`, `https://nootropic-fm.edmondakadantes.workers.dev`).
- **Bază de date:** Cloudflare D1 SQLite (`nootropic-fm-db`, ID `4767875c-6348-4d02-8398-8f2c77f03a85`, regiune EEUR / București).
- **Motor Audio:** Web Audio API procedural multi-strat direct în browser (cost \$0 per sesiune).
- **Email forwarding păstrat intact:** `music@nootropic.fm` → `nootropic.fm@gmail.com` (MX, SPF, DMARC, DKIM păstrate în Cloudflare DNS).

## Comenzi utile

```bash
# Dezvoltare locală (frontend + Worker + D1 local)
npm run dev

# Build producție
npm run build

# Deploy update pe https://nootropic.fm
npm run deploy
```
