// Utah Avalanche Center daily forecast proxy.
//
// Two reasons this cannot be a direct browser fetch: UAC sends no CORS headers, and their
// docs require a descriptive User-Agent or the request comes back 400 — User-Agent is a
// forbidden header for fetch(), so only a server can set it.
//
// UAC issues forecasts once each morning between 5 and 8 AM and almost never revises them,
// so this caches for 15 minutes at the edge, matching their own polling guidance.

const REGIONS = new Set(["logan", "ogden", "uintas", "salt-lake", "provo", "skyline", "moab", "abajos", "southwest"]);

const CORS = { "access-control-allow-origin": "*", "content-type": "application/json; charset=utf-8" };

export default async (req) => {
  const region = (new URL(req.url).searchParams.get("region") || "salt-lake").toLowerCase();

  if (!REGIONS.has(region)) {
    return new Response(JSON.stringify({ error: "unknown region" }), { status: 400, headers: CORS });
  }

  try {
    const upstream = await fetch(`https://utahavalanchecenter.org/forecast/${region}/json`, {
      headers: {
        // UAC asks for a product identifier and a way to reach the operator.
        "user-agent": "SnoCastUtah/1.0 (+https://snocastutah.com; ski conditions dashboard)",
        accept: "application/json"
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `upstream ${upstream.status}` }), {
        status: 200,
        headers: { ...CORS, "cache-control": "no-store" }
      });
    }

    const body = await upstream.text();
    return new Response(body, {
      status: 200,
      headers: { ...CORS, "cache-control": "public, max-age=900, s-maxage=900" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `proxy ${err.message}` }), {
      status: 200,
      headers: { ...CORS, "cache-control": "no-store" }
    });
  }
};

export const config = { path: "/api/avalanche" };
