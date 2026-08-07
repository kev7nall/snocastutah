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
  const res = await fetch(`https://www.youtube.com/@${handle}/streams?hl=en&persist_hl=1`, {
    headers: {
      // YouTube serves a stripped page without a browser-shaped request.
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9"
    },
    signal: AbortSignal.timeout(9000)
  });
  if (!res.ok) return [];

  const html = await res.text();
  const at = html.indexOf("ytInitialData");
  if (at === -1) return [];
  const start = html.indexOf("{", at);
  const end = html.indexOf(";</script>", start);
  if (start === -1 || end === -1) return [];

  let data;
  try {
    data = JSON.parse(html.slice(start, end));
  } catch {
    return [];
  }

  const out = [];
  collectLive(data, out, new Set());
  return out;
}

export default async (req) => {
  const resort = new URL(req.url).searchParams.get("resort") || "";
  const handles = CHANNELS[resort];

  if (!handles) return json({ streams: [], reason: "unknown-resort" }, "no-store");

  for (const handle of handles) {
    try {
      const streams = await liveStreamsFor(handle);
      if (streams.length) {
        return json(
          { streams, channel: handle, fetched: new Date().toISOString() },
          // Streams are long-running; ten minutes keeps the page current without
          // hammering YouTube from every edge node.
          "public, max-age=600, s-maxage=600"
        );
      }
    } catch {
      // Try the next candidate handle.
    }
  }

  // Nothing live (off-season, or the handle moved). The page keeps its static cam cards.
  return json({ streams: [], reason: "none-live" }, "public, max-age=300, s-maxage=300");
};

export const config = { path: "/api/youtube-cams" };
