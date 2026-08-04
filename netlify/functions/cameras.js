// UDOT traffic camera index.
// UDOT's REST API requires a developer key and throttles to ten calls per minute, so the
// key stays in a Netlify environment variable and the response is cached hard at the edge.
// The page calls /api/cameras and gets back a trimmed list — the full payload carries far
// more per camera than the page needs.
//
// Set UDOT_API_KEY in Netlify → Site configuration → Environment variables.
// Request a key at https://udottraffic.utah.gov/developers/doc (free, needs an account).

const CORS = { "access-control-allow-origin": "*" };

export default async () => {
  const key = process.env.UDOT_API_KEY;

  // No key configured yet: answer 200 with an empty list and a reason. The page shows a
  // "not connected" panel rather than a broken image grid, and nothing throws.
  if (!key) {
    return new Response(JSON.stringify({ cameras: [], reason: "no-key" }), {
      status: 200,
      headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }

  try {
    const upstream = await fetch(
      `https://www.udottraffic.utah.gov/api/v2/get/cameras?key=${encodeURIComponent(key)}&format=json`,
      { headers: { "user-agent": "snocastutah.com (camera index)" }, signal: AbortSignal.timeout(12000) }
    );

    if (!upstream.ok) {
      return new Response(JSON.stringify({ cameras: [], reason: `upstream-${upstream.status}` }), {
        status: 200,
        headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
      });
    }

    const raw = await upstream.json();
    const cameras = [];

    for (const cam of Array.isArray(raw) ? raw : []) {
      const lat = Number(cam.Latitude);
      const lon = Number(cam.Longitude);
      if (!lat || !lon) continue;

      // A camera can carry several views; each view is its own image URL.
      for (const view of cam.Views || []) {
        if (view.Status && view.Status !== "Enabled") continue;
        if (!view.Id) continue;
        cameras.push({
          id: String(view.Id),
          lat: Math.round(lat * 1e5) / 1e5,
          lon: Math.round(lon * 1e5) / 1e5,
          loc: String(cam.Location || cam.Roadway || "").trim(),
          road: String(cam.Roadway || "").trim(),
          dir: String(cam.Direction || "").trim(),
          desc: String(view.Description || "").trim()
        });
      }
    }

    return new Response(JSON.stringify({ cameras, fetched: new Date().toISOString() }), {
      status: 200,
      headers: {
        ...CORS,
        "content-type": "application/json; charset=utf-8",
        // The camera roster changes rarely; the IMAGES are fetched straight from UDOT by
        // the browser and are not cached here. One upstream call per hour per edge node
        // keeps this comfortably inside the ten-per-minute limit.
        "cache-control": "public, max-age=3600, s-maxage=3600"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ cameras: [], reason: `error-${err.message}` }), {
      status: 200,
      headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }
};

export const config = { path: "/api/cameras" };
