# nootropic.fm — Adaptive Cognitive Audio (Open Research Beta)

Self-learning psychoacoustic audio platform grounded in peer-reviewed literature and personalized in real time using Contextual Multi-Armed Bandits (Thompson Sampling).

## Production Architecture (\$0 / month)

- **Domain:** `https://nootropic.fm` & `https://www.nootropic.fm` (Cloudflare Free DNS, nameservers `elliot.ns.cloudflare.com` & `nina.ns.cloudflare.com`).
- **App & Edge API:** Cloudflare Workers + Static Assets (`nootropic-fm`, `https://nootropic-fm.edmondakadantes.workers.dev`).
- **Research Database:** Cloudflare D1 SQLite (`nootropic-fm-db`, EEUR region) with anonymous profiles, session telemetry, Bayesian cohort/personal bandit stats, and one-click CSV/JSON dataset export.
- **Audio Engine:** Procedural multi-layer Web Audio API synthesis directly on the listener's device (\$0 server audio cost, exact AM entrainment, Driving Safety Mode EQ, Iso-Principle progression).

## Commands

```bash
# Local development (React frontend + Cloudflare Worker + local D1)
npm run dev

# Production build
npm run build

# Deploy live to https://nootropic.fm
npm run deploy
```
