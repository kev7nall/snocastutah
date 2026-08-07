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

## Road cameras (UDOT_API_KEY)

The "Cameras on the road up" panel in the Avalanche & road section reads the UDOT camera
roster through `netlify/functions/cameras.js`. Until a key is configured the panel shows
"Add UDOT_API_KEY in Netlify to switch these on" and nothing breaks.

To switch it on:

1. Register at https://udottraffic.utah.gov/my511/register
2. Request a developer key at https://udottraffic.utah.gov/developers/doc
3. In Netlify: Site configuration -> Environment variables -> Add a variable
   Key: `UDOT_API_KEY`   Value: the key
4. Redeploy (or Deploys -> Trigger deploy -> Clear cache and deploy site)

The key stays server-side; the browser only ever calls `/api/cameras`. The roster is
cached at the edge for an hour, which keeps the function well inside UDOT's limit of ten
calls per minute. Camera IMAGES are loaded straight from UDOT by the browser and are not
proxied.

## Avalanche danger rose

The Avalanche & road section shows the Utah Avalanche Center's daily danger rose for the
selected resort's zone, read through `netlify/functions/avalanche.js`.

Needs a token. As of 2026 the endpoint answers untokened requests with
{"result":"error","error_message":"Unauthorized: Invalid or missing API token…"} — their
public API docs page predates this and does not mention it.

1. Request a token at https://utahavalanchecenter.org/api-access
2. Netlify: Site configuration -> Environment variables -> Add a variable
   Key: `UAC_API_TOKEN`   Value: the token
3. Redeploy

UAC does not document which auth convention the token uses, so the function tries
`?token=`, `Authorization: Bearer`, then `X-API-Key`, and keeps the first that is accepted.
If you learn the right one from them, trim the list. The function also exists because UAC
sends no CORS headers and requires a descriptive User-Agent, which a browser cannot set.
Successful responses cache 15 minutes, matching UAC's guidance (forecasts issue once daily
between 5 and 8 AM).

Reading the rose: the centre ring is the HIGHEST elevation band and the outer ring the
lowest; segments run clockwise from north. Lighter shading means "pockets of" that rating
rather than the whole aspect. The badge shows the worst rating anywhere on the rose.

Out of season, or if UAC returns nothing parseable, the section falls back to its previous
season-aware copy and the rose is hidden. Nothing errors.

## YouTube resort cams

Brighton, Solitude and Deer Valley do not serve refreshing JPEGs — they stream their cams
to YouTube around the clock. `netlify/functions/youtube-cams.js` resolves whichever streams
a channel has live at request time and the Webcams section renders those instead of the
resort's static cam cards.

No key needed. YouTube ships the channel page's data as an inline `ytInitialData` blob, so
the function reads video id, title and the LIVE badge straight out of it. Video IDs rotate
every time a resort restarts a stream, which is why none are hardcoded — a baked-in id
would render a dead player within a season.

Each card shows the stream's own thumbnail (a recent frame off that stream) with a play
button; the iframe only mounts when someone presses play, so the grid stays light. Off
season, or if a channel handle moves, the function returns an empty list and the resort
falls back to its static cam cards. Nothing errors either way.

Channel handles live in a closed allowlist in the function — it is not a general-purpose
proxy. Each resort carries candidate handles because YouTube handles get renamed; the
first that answers with live streams wins. Responses cache 10 minutes at the edge.

## SNOTEL proxy (snow water equivalent + on-mountain sensors)

As of 4 Aug 2026, wcc.sc.egov.usda.gov answers browser requests with a bare Apache 403
("You don't have permission to access this resource") at any date range — a User-Agent /
bot block, not a rate limit. It worked earlier the same day, so this arrived suddenly.

Both SNOTEL reads (the "Snow fallen to date" chart and the on-mountain hourly sensor behind
the hero temperature) now go through `netlify/functions/snotel.js`, which sends a real
User-Agent server-side. No key needed. Responses cache 10 minutes at the edge.

Fallback: if the function is missing, the page retries via r.jina.ai. That relay reaches
NRCS often enough that the full eleven-season chart does load through it sometimes, but the
upstream block is intermittent rather than range-dependent, so it is unreliable. Deploying
`deploy/` is what makes the chart dependable.

The path is validated against the exact report-generator shape, so it is not an open proxy.
