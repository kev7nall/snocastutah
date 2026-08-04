# SnoCast Utah

Live snow, weather, avalanche and road conditions for all 14 lift-served ski areas
in Utah. <https://snocastutah.com>

## What this repo is

`index.html` is a single self-contained file — markup, styles, fonts and scripts
are all inlined. There is no build step and no dependencies to install. Netlify
publishes the repo root as-is.

## Data sources

| Feed | Source | CORS |
| --- | --- | --- |
| Mountain forecast, gridpoint detail | NWS `api.weather.gov` | direct |
| Snowpack, snow-water equivalent | NRCS SNOTEL | direct |
| Avalanche danger | Utah Avalanche Center | direct |
| Buoy wave height | NOAA NDBC | via `/api/buoy` |

NDBC blocks cross-origin reads, so `netlify/functions/buoy.js` proxies it. If the
function is unavailable the page falls back to public proxies, so buoy data still
loads on a plain static host — just slower.

## Local preview

```sh
npx serve .          # static only, /api/buoy will 404 and fall back
netlify dev          # includes the buoy function
```

## Deploying

Pushes to `main` deploy automatically once the repo is linked to the Netlify site.

## Editing

The source of truth for the design lives in the Claude project as
`SnoCast Utah.dc.html`. Edit there and re-export; hand-editing `index.html` will
be overwritten on the next export.
