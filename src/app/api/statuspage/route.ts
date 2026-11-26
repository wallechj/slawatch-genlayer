import { NextRequest, NextResponse } from "next/server";
import { parseStatuspagePayload } from "@/lib/canonical";

const ALLOWED_URL_REGEX = /^https:\/\/[A-Za-z0-9.-]+\/api\/v2\/[A-Za-z0-9._-]+\.json$/;

export async function GET(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get("url")?.trim() ?? "";
  if (!ALLOWED_URL_REGEX.test(targetUrl)) {
    return NextResponse.json(
      {
        error:
          "Please provide a valid HTTPS Atlassian Statuspage v2 JSON URL (e.g. https://www.githubstatus.com/api/v2/summary.json).",
      },
      { status: 400 }
    );
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "SLAWatch-GenLayer-Inspector/1.0",
      },
      cache: "no-store",
    });

    if (!upstream.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Upstream Statuspage returned HTTP ${upstream.status}`,
          source_url: targetUrl,
        },
        { status: 502 }
      );
    }

    const raw = (await upstream.json()) as Record<string, unknown>;
    const canonical = await parseStatuspagePayload(raw, targetUrl);
    return NextResponse.json(canonical);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to fetch Statuspage endpoint",
        source_url: targetUrl,
      },
      { status: 502 }
    );
  }
}
