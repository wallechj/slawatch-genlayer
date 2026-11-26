export interface NormalizedIncident {
  id: string;
  name: string;
  impact: "none" | "maintenance" | "minor" | "major" | "critical";
  status: string;
  started_at: string;
  resolved_at: string;
}

export interface CanonicalStatuspageEvidence {
  ok: boolean;
  error?: string;
  source_url: string;
  page_name: string;
  status_indicator: "none" | "maintenance" | "minor" | "major" | "critical" | "unknown";
  status_description: string;
  highest_impact: "none" | "maintenance" | "minor" | "major" | "critical";
  unresolved_count: number;
  incidents: NormalizedIncident[];
  evidence_digest: string;
}

const IMPACT_RANK: Record<string, number> = {
  none: 0,
  maintenance: 1,
  minor: 2,
  major: 3,
  critical: 4,
};

function normalizeImpact(value: unknown): "none" | "maintenance" | "minor" | "major" | "critical" {
  const lowered = String(value ?? "none").trim().toLowerCase();
  if (lowered in IMPACT_RANK) {
    return lowered as "none" | "maintenance" | "minor" | "major" | "critical";
  }
  return "none";
}

/**
 * Deterministic key-sorted JSON serializer matching Python's
 * json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalJson(item)).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(",") +
    "}"
  );
}

export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function parseStatuspagePayload(
  payload: Record<string, unknown>,
  sourceUrl: string
): Promise<CanonicalStatuspageEvidence> {
  const page = (payload.page && typeof payload.page === "object"
    ? payload.page
    : {}) as Record<string, unknown>;
  const status = (payload.status && typeof payload.status === "object"
    ? payload.status
    : {}) as Record<string, unknown>;
  const rawIncidents = Array.isArray(payload.incidents) ? payload.incidents : [];

  let highestImpact: "none" | "maintenance" | "minor" | "major" | "critical" =
    normalizeImpact(status.indicator);
  let unresolvedCount = 0;
  const incidents: NormalizedIncident[] = [];

  for (const item of rawIncidents.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const impact = normalizeImpact(rec.impact);
    const incStatus = String(rec.status ?? "unknown").trim().toLowerCase();
    if (IMPACT_RANK[impact] > IMPACT_RANK[highestImpact]) {
      highestImpact = impact;
    }
    if (!["resolved", "postmortem", "completed"].includes(incStatus)) {
      unresolvedCount += 1;
    }
    incidents.push({
      id: String(rec.id ?? "").trim(),
      name: String(rec.name ?? "").trim().slice(0, 160),
      impact,
      status: incStatus,
      started_at: String(rec.started_at ?? rec.created_at ?? "").trim(),
      resolved_at: String(rec.resolved_at ?? "").trim(),
    });
  }

  incidents.sort((a, b) => {
    const t = a.started_at.localeCompare(b.started_at);
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });

  const snapshot = {
    ok: true,
    source_url: sourceUrl,
    page_name: String(page.name ?? "").trim().slice(0, 120),
    status_indicator: normalizeImpact(status.indicator),
    status_description: String(status.description ?? "").trim().slice(0, 200),
    highest_impact: highestImpact,
    unresolved_count: unresolvedCount,
    incidents,
  };

  const digest = await sha256Hex(canonicalJson(snapshot));
  return {
    ...snapshot,
    evidence_digest: digest,
  };
}
