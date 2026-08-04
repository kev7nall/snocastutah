// NRCS SNOTEL report-generator proxy.
//
// As of August 2026 wcc.sc.egov.usda.gov answers browser requests with a bare Apache 403
// ("You don't have permission to access this resource") regardless of date range — a
// User-Agent/bot block, not a rate limit. A server-side request with a real UA passes, and
// this also solves the missing CORS headers.
//
// Not an open proxy: the path is matched against the exact report-generator shape the page
// uses, so this cannot be pointed at arbitrary hosts or endpoints.

const PATH_OK = /^customSingleStationReport\/(daily|hourly)\/[0-9A-Za-z:_-]{3,32}\/\d{4}-\d{2}-\d{2},\d{4}-\d{2}-\d{2}\/[A-Za-z:_,0-9]{3,160}$/;

const CORS = { "access-control-allow-origin": "*" };

export default async (req) => {
  const path = new URL(req.url).searchParams.get("path") || "";

  if (!PATH_OK.test(path)) {
    return new Response("bad path", { status: 400, headers: CORS });
  }

  try {
    const upstream = await fetch(`https://wcc.sc.egov.usda.gov/reportGenerator/view_csv/${path}`, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; SnoCastUtah/1.0; +https://snocastutah.com)",
        accept: "text/csv,text/plain,*/*"
      },
      signal: AbortSignal.timeout(25000)
    });

    if (!upstream.ok) {
      return new Response(`upstream ${upstream.status}`, { status: 502, headers: CORS });
    }

    return new Response(await upstream.text(), {
      status: 200,
      headers: {
        ...CORS,
        "content-type": "text/plain; charset=utf-8",
        // Daily values change once a day; hourly roughly hourly. Ten minutes at the edge is
        // fresh enough for both and keeps the load off NRCS.
        "cache-control": "public, max-age=600, s-maxage=600"
      }
    });
  } catch (err) {
    return new Response(`proxy error: ${err.message}`, { status: 504, headers: CORS });
  }
};

export const config = { path: "/api/snotel" };
