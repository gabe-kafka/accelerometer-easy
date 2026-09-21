# accelerometer-easy

Vite + React frontend for the accelerometer sample viewers, plus Thingy:91 firmware.

## Routes

| Path | Page |
| --- | --- |
| `/` | Broad and detail sample data viewers |
| `/storm-index` | Storm Index scaffold |

## Storm Index

`/storm-index` is a placeholder dashboard for PR Line 50200:

- **2-week forecast** — empty 14-day intensity strip. Copy: “Forecast feed not connected yet.”
- **Historic log** — table headers plus one muted EXAMPLE row. Not a recorded storm.
- **% collected** — Site A (ridge / topo wind, node 2), Site B (soil type 1, node 1), Site C (soil type 2, node 3). Each shows `— / —` usable vs needed, plus an overall corridor chip.

Weather and Supabase feeds are not connected. Types and placeholders live in `src/lib/stormIndexTypes.ts` and `src/lib/stormIndexPlaceholders.ts`.

Open it from the **Storm Index** tab on the data viewers.

## Develop

```bash
npm install
npm run dev
```

## Deploy

Vite SPA. `vercel.json` rewrites unknown paths to `index.html` so `/storm-index` works on Vercel.

```bash
npx vercel login
npx vercel link
npx vercel --prod
```
