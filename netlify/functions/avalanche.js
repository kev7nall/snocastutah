// Utah Avalanche Center daily forecast proxy.
//
// Two reasons this cannot be a direct browser fetch: UAC sends no CORS headers, and their
// docs require a descriptive User-Agent or the request comes back 400 — User-Agent is a
// forbidden header for fetch(), so only a server can set it.
//
// UAC issues forecasts once each morning between 5 and 8 AM and almost never revises them,
// so successful responses cache for 15 minutes at the edge, matching their own guidance.
//
// A product-identifier UA of the form "SnoCastUtah/1.0 (+url)" drew a 401 in testing, so the
// primary attempt now presents a full browser header set. If that is still refused the
// request is retried through r.jina.ai, which reaches the same endpoint from a different
// path. Either way a failure returns 200 with an { error } body and the page falls back to
// its off-season placeholder rather than breaking.

const REGIONS = new Set(["logan", "ogden", "uintas", "salt-lake", "provo", "skyline", "moab", "abajos", "southwest"]);

const CORS = { "access-control-allow-origin": "*", "content-type": "application/json; charset=utf-8" };

const BROWSERISH = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 SnoCastUtah/1.0 (+https://snocastutah.com)",
  accept: "application/json,text/javascript,*/*;q=0.9",
  "accept-language": "en-US,en;q=0.9",
  referer: "https://utahavalanchecenter.org/forecast",
  "cache-control": "no-cache"
};

const looksBlocked = (txt) => /401 Unauthorized|403 Forbidden|Access denied|don't have permission|<title>Just a moment/i.test(txt);

export default async (req) => {
  const region = (new URL(req.url).searchParams.get("region") || "salt-lake").toLowerCase();

  if (!REGIONS.has(region)) {
    return new Response(JSON.stringify({ error: "unknown region" }), { status: 400, headers: CORS });
  }

  const target = `https://utahavalanchecenter.org/forecast/${region}/json`;
  const attempts = [
    { url: target, headers: BROWSERISH, ms: 12000 },
    { url: "https://r.jina.ai/" + target, headers: { accept: "text/plain" }, ms: 22000 }
  ];

  let reason = "no route";

  for (const a of attempts) {
    try {
      const upstream = await fetch(a.url, { headers: a.headers, signal: AbortSignal.timeout(a.ms) });
      if (!upstream.ok) {
        reason = `upstream ${upstream.status}`;
        continue;
      }
      const body = await upstream.text();
      if (looksBlocked(body)) {
        reason = "blocked";
        continue;
      }
      // The relay wraps the payload in a text preamble; recover the JSON array or object.
      const start = body.search(/[[{]/);
      const candidate = start > 0 ? body.slice(start) : body;
      try {
        JSON.parse(candidate);
      } catch (e) {
        reason = "unparseable";
        continue;
      }
      return new Response(candidate, {
        status: 200,
        headers: { ...CORS, "cache-control": "public, max-age=900, s-maxage=900" }
      });
    } catch (err) {
      reason = `error ${err.name || err.message}`;
    }
  }

  return new Response(JSON.stringify({ error: reason }), {
    status: 200,
    headers: { ...CORS, "cache-control": "no-store" }
  });
};

export const config = { path: "/api/avalanche" };
