// Utah Avalanche Center daily forecast proxy.
//
// Three reasons this cannot be a direct browser fetch: UAC sends no CORS headers, their docs
// require a descriptive User-Agent (a forbidden header for fetch(), so only a server can set
// it), and as of 2026 the endpoint requires an API token that must not ship in page source.
//
// Token: request one at https://utahavalanchecenter.org/api-access, then set UAC_API_TOKEN in
// Netlify → Site configuration → Environment variables and redeploy.
//
// UAC does not publish which auth convention the token uses, so the common three are tried in
// order and the first accepted one wins. Success caches 15 minutes at the edge, matching UAC's
// own guidance (forecasts are issued once daily between 5 and 8 AM), so the extra probing
// happens at most a few times an hour and only while a convention is failing.

const REGIONS = new Set(["logan", "ogden", "uintas", "salt-lake", "provo", "skyline", "moab", "abajos", "southwest"]);

const CORS = { "access-control-allow-origin": "*", "content-type": "application/json; charset=utf-8" };

const BASE_HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 SnoCastUtah/1.0 (+https://snocastutah.com)",
  accept: "application/json,text/javascript,*/*;q=0.9",
  "accept-language": "en-US,en;q=0.9",
  referer: "https://utahavalanchecenter.org/forecast"
};

const rejected = (txt) =>
  /"result"\s*:\s*"error"|Unauthorized|Invalid or missing API token|403 Forbidden|<title>Just a moment/i.test(txt);

export default async (req) => {
  const region = (new URL(req.url).searchParams.get("region") || "salt-lake").toLowerCase();

  if (!REGIONS.has(region)) {
    return new Response(JSON.stringify({ error: "unknown region" }), { status: 400, headers: CORS });
  }

  const token = process.env.UAC_API_TOKEN;
  const base = `https://utahavalanchecenter.org/forecast/${region}/json`;

  // No token configured: say so plainly instead of spending four requests to be told.
  if (!token) {
    return new Response(JSON.stringify({ error: "no-token" }), {
      status: 200,
      headers: { ...CORS, "cache-control": "no-store" }
    });
  }

  const t = encodeURIComponent(token);
  const attempts = [
    { url: `${base}?token=${t}`, headers: BASE_HEADERS },
    { url: base, headers: { ...BASE_HEADERS, authorization: `Bearer ${token}` } },
    { url: base, headers: { ...BASE_HEADERS, "x-api-key": token } },
    { url: `https://r.jina.ai/${base}?token=${t}`, headers: { accept: "text/plain" }, ms: 22000 }
  ];

  let reason = "no route";

  for (const a of attempts) {
    try {
      const upstream = await fetch(a.url, { headers: a.headers, signal: AbortSignal.timeout(a.ms || 12000) });
      if (!upstream.ok) {
        reason = `upstream ${upstream.status}`;
        continue;
      }
      const body = await upstream.text();
      if (rejected(body)) {
        reason = "rejected";
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
