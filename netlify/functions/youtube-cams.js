// Live YouTube webcam resolver.
//
// Brighton, Solitude and Deer Valley stream their cams to YouTube 24/7 instead of serving
// a refreshing JPEG; several smaller areas do too. Video IDs rotate every time a stream is
// restarted, so nothing here is hardcoded — this resolves whatever the channel is streaming
// RIGHT NOW at request time and the page renders what comes back. A stream that ends simply
// drops off the list, and a resort with no live streams returns an empty list.
//
// No API key required: YouTube ships the channel page's data as an inline ytInitialData
// blob, which carries the video id, title and a LIVE badge per stream.
//
// Called as /api/youtube-cams?resort=solitude

const CORS = { "access-control-allow-origin": "*" };

// Closed allowlist — this is not a general-purpose proxy. Each resort carries candidate
// handles because YouTube handles get renamed; the first that answers with live streams wins.
const CHANNELS = {
  alta: ["AltaSkiArea", "altaskiarea"],
  snowbird: ["snowbird", "SnowbirdResort"],
  brighton: ["brightonresort9647", "brightonresort"],
  solitude: ["SolitudeMountain"],
  pcmr: ["parkcitymountain", "ParkCityMountainResort"],
  deervalley: ["deervalley", "deervalleyresort", "DeerValleyResortUtah"],
  snowbasin: ["SnowbasinResort", "snowbasin"],
  powdermountain: ["PowderMountain", "powdermountainresort"],
  nordicvalley: ["NordicValley", "nordicvalleyresort"],
  sundance: ["SundanceMountainResort", "sundanceresort"],
  beavermountain: ["skithebeav", "BeaverMountain"],
  cherrypeak: ["skicpr", "CherryPeakResort"],
  brianhead: ["BrianHeadResort", "brianheadresort"],
  eaglepoint: ["EaglePointResort", "skieaglepoint"]
};

const json = (body, cache) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": cache }
  });

// Walk the ytInitialData tree and pull out every video currently marked live. The shape of
// that tree changes without notice, so this matches on the two fields that have stayed put
// (videoId, title) plus the LIVE badge rather than following a fixed path into it.
function collectLive(node, out, seen) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collectLive(n, out, seen);
    return;
  }
  if (node.videoId && node.title && !seen.has(node.videoId)) {
    const marks = JSON.stringify(node.thumbnailOverlays || node.badges || "");
    if (marks.indexOf('"LIVE"') !== -1) {
      const t = node.title;
      const title = (t.simpleText || (t.runs || []).map((r) => r.text).join("") || "").trim();
      if (title) {
        seen.add(node.videoId);
        out.push({ id: node.videoId, title });
      }
    }
  }
  for (const k in node) collectLive(node[k], out, seen);
}

async function liveStreamsFor(handle) {
  const res = await fetch(`https://www.youtube.com/@${handle}/streams?hl=en&gl=US&persist_hl=1`, {
    headers: {
      // YouTube serves a stripped page without a browser-shaped request, and answers
      // datacenter IPs (which is what a Netlify function is) with a consent interstitial
      // that carries no ytInitialData at all. Pre-accepting consent avoids that.
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      cookie: "CONSENT=YES+cb; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwMzE5LjA2X3AwGgJlbiADGgYIgOCwsAY"
    },
    signal: AbortSignal.timeout(9000)
  });
  if (!res.ok) return { streams: [], reason: `http-${res.status}` };

  const html = await res.text();
  const at = html.indexOf("ytInitialData");
  if (at === -1) {
    // Consent wall, captcha, or an entirely different page shape.
    return { streams: [], reason: html.indexOf("consent") !== -1 ? "consent-wall" : "no-ytinitialdata" };
  }

  // Every video id on the page, live or not. Reported alongside a miss so "nothing is
  // streaming" is distinguishable from "the page had no videos on it at all" (an unlisted
  // cam stream never appears on the channel's streams tab).
  const allIds = new Set();
  const idRe = /"videoId":"([\w-]{11})"/g;
  let idm;
  while ((idm = idRe.exec(html))) allIds.add(idm[1]);

  const start = html.indexOf("{", at);
  const end = html.indexOf(";</script>", start);
  const out = [];

  if (start !== -1 && end !== -1) {
    try {
      collectLive(JSON.parse(html.slice(start, end)), out, new Set());
    } catch {
      // Fall through to the regex sweep below.
    }
  }

  // Fallback: YouTube's data shape changes often enough that a failed parse should not
  // mean zero cams. Pair each videoId with the LIVE badge that follows it in the payload.
  if (!out.length) {
    const seen = new Set();
    const re = /"videoId":"([\w-]{11})"/g;
    let m;
    while ((m = re.exec(html))) {
      const id = m[1];
      if (seen.has(id)) continue;
      const window_ = html.slice(m.index, m.index + 2600);
      if (window_.indexOf('"style":"LIVE"') === -1) continue;
      const t = window_.match(/"title":\{"runs":\[\{"text":"([^"]{1,90})"/) || window_.match(/"title":\{"simpleText":"([^"]{1,90})"/);
      if (!t) continue;
      seen.add(id);
      out.push({ id, title: t[1].replace(/\\u0026/g, "&").trim() });
    }
  }

  return { streams: out, reason: out.length ? "" : `none-live(${allIds.size}-videos-listed)` };
}

export default async (req) => {
  const resort = new URL(req.url).searchParams.get("resort") || "";
  const handles = CHANNELS[resort];

  if (!handles) return json({ streams: [], reason: "unknown-resort" }, "no-store");

  const tried = [];
  for (const handle of handles) {
    try {
      const { streams, reason } = await liveStreamsFor(handle);
      if (streams.length) {
        return json(
          { streams, channel: handle, fetched: new Date().toISOString() },
          // Streams are long-running; ten minutes keeps the page current without
          // hammering YouTube from every edge node.
          "public, max-age=600, s-maxage=600"
        );
      }
      tried.push(`${handle}:${reason}`);
    } catch (err) {
      tried.push(`${handle}:error-${err.name}`);
    }
  }

  // Nothing live (off-season, or the handle moved). The page keeps its static cam cards.
  // `tried` names each handle and why it came back empty, so a miss is diagnosable.
  return json({ streams: [], reason: tried.join(" | ") || "none-live" }, "public, max-age=300, s-maxage=300");
};

export const config = { path: "/api/youtube-cams" };
