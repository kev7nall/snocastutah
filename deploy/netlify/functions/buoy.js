// NDBC realtime buoy proxy.
// NOAA's data server sends no CORS headers, so the browser cannot read it directly.
// This function fetches the fixed-width text file server-side and returns it as
// text/plain with an open CORS header. The page calls /api/buoy?station=51101.

const ALLOWED = /^[0-9a-zA-Z]{4,8}$/;

export default async (req) => {
  const url = new URL(req.url);
  const station = url.searchParams.get("station") || "51101";
  const kind = url.searchParams.get("kind") === "full" ? "full" : "5day";

  if (!ALLOWED.test(station)) {
    return new Response("bad station id", { status: 400 });
  }

  const target =
    kind === "full"
      ? `https://www.ndbc.noaa.gov/data/realtime2/${station}.txt`
      : `https://www.ndbc.noaa.gov/data/5day2/${station}_5day.txt`;

  const headers = {
    "access-control-allow-origin": "*",
    "content-type": "text/plain; charset=utf-8",
    // Buoys report hourly. Cache at the edge for 10 minutes.
    "cache-control": "public, max-age=600, s-maxage=600"
  };

  try {
    const upstream = await fetch(target, {
      headers: { "user-agent": "snocastutah.com (buoy proxy)" },
      signal: AbortSignal.timeout(8000)
    });

    if (!upstream.ok) {
      return new Response(`upstream ${upstream.status}`, {
        status: 502,
        headers: { "access-control-allow-origin": "*" }
      });
    }

    return new Response(await upstream.text(), { status: 200, headers });
  } catch (err) {
    return new Response(`proxy error: ${err.message}`, {
      status: 504,
      headers: { "access-control-allow-origin": "*" }
    });
  }
};

export const config = { path: "/api/buoy" };
