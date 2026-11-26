export interface AgreementRecord {
  agreement_id: string;
  vendor_name: string;
  statuspage_url: string;
  provider: string;
  customer: string;
  max_allowed_impact: string;
  max_unresolved_incidents: number;
  minor_credit_bps: number;
  major_credit_bps: number;
  critical_credit_bps: number;
  sla_terms: string;
  status: string;
  terms_digest: string;
}

export interface ClaimRecord {
  claim_id: string;
  agreement_id: string;
  claimant: string;
  incident_window: string;
  claim_summary: string;
  status: string;
  verdict: string;
  credit_bps: number;
  challenged: boolean;
  challenge_note: string;
  evidence_digest: string;
  cited_incident_ids: string[];
  reasoning: string;
}

export interface ReceiptRecord {
  receipt_id: string;
  claim_id: string;
  agreement_id: string;
  vendor_name: string;
  source_url: string;
  adjudicated_by: string;
  verdict: string;
  credit_bps: number;
  deterministic_credit_bps: number;
  status_indicator: string;
  highest_impact: string;
  unresolved_count: number;
  cited_incident_ids: string[];
  reasoning: string;
  evidence_digest: string;
  terms_digest: string;
  challenged: boolean;
  settled: boolean;
  receipt_digest: string;
}

export const STATUSPAGE_PRESETS = [
  {
    vendor: "GitHub",
    url: "https://www.githubstatus.com/api/v2/summary.json",
    defaultTerms:
      "Unscheduled major or critical GitHub API/Actions outages trigger 25% (major) or 50% (critical) monthly retainer credit. Scheduled maintenance windows are excluded.",
  },
  {
    vendor: "Cloudflare",
    url: "https://www.cloudflarestatus.com/api/v2/summary.json",
    defaultTerms:
      "Unscheduled major global edge or DNS outages grant 25% credit; critical outages grant 50% credit. Regional scheduled maintenance is excluded.",
  },
  {
    vendor: "Vercel",
    url: "https://www.vercel-status.com/api/v2/summary.json",
    defaultTerms:
      "Unscheduled major production routing or build pipeline outages trigger 25% credit; critical outages trigger 50% credit.",
  },
  {
    vendor: "OpenAI",
    url: "https://status.openai.com/api/v2/summary.json",
    defaultTerms:
      "Unscheduled major API inference outages exceeding minor threshold qualify for 25% service credit; critical outages qualify for 50%.",
  },
];

export const SAMPLE_VERIFIED_RECEIPTS: ReceiptRecord[] = [
  {
    receipt_id: "RCPT-CLM-0001",
    claim_id: "CLM-0001",
    agreement_id: "SLA-0001",
    vendor_name: "GitHub Enterprise API (Simulation Reference)",
    source_url: "https://www.githubstatus.com/api/v2/summary.json",
    adjudicated_by: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    verdict: "BREACH_CONFIRMED",
    credit_bps: 2500,
    deterministic_credit_bps: 2500,
    status_indicator: "major",
    highest_impact: "major",
    unresolved_count: 1,
    cited_incident_ids: ["inc-2026-002"],
    reasoning:
      "Unresolved major incident inc-2026-002 ('API Requests Degraded Performance') exceeds max_allowed_impact=minor and is not scheduled maintenance. 25% credit tier applies.",
    evidence_digest:
      "94f82e0a5d3b7e7f2b0d8c14a69e4f3e0c8d7a6b5f4e3d2c1b0a9f8e7d6c5b4a",
    terms_digest:
      "12ab34cd56ef789012ab34cd56ef789012ab34cd56ef789012ab34cd56ef7890",
    challenged: false,
    settled: true,
    receipt_digest:
      "4e81d93c7f20a81b6e4c2d9f1a3b5c7d9e0f2a4b6c8d0e1f3a5b7c9d1e3f5a7b",
  },
  {
    receipt_id: "RCPT-CLM-0002",
    claim_id: "CLM-0002",
    agreement_id: "SLA-0002",
    vendor_name: "Cloudflare Edge (Simulation Reference)",
    source_url: "https://www.cloudflarestatus.com/api/v2/summary.json",
    adjudicated_by: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    verdict: "NO_BREACH",
    credit_bps: 0,
    deterministic_credit_bps: 0,
    status_indicator: "none",
    highest_impact: "none",
    unresolved_count: 0,
    cited_incident_ids: [],
    reasoning:
      "All systems operational with zero unresolved incidents on the official Statuspage v2 feed. No SLA credit triggered.",
    evidence_digest:
      "b7e1c4d9f2a80365194c8e7d6a5b4f3e2d1c0b9a8f7e6d5c4b3a291807f6e5d4",
    terms_digest:
      "aa11bb22cc33dd44ee55ff6600112233445566778899aabbccddeeff00112233",
    challenged: false,
    settled: false,
    receipt_digest:
      "8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5",
  },
  {
    receipt_id: "RCPT-CLM-0003",
    claim_id: "CLM-0003",
    agreement_id: "SLA-0003",
    vendor_name: "Vercel Status (Simulation Reference — Fail-Closed)",
    source_url: "https://www.vercel-status.com/api/v2/summary.json",
    adjudicated_by: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    verdict: "REVIEW_NEEDED",
    credit_bps: 0,
    deterministic_credit_bps: 0,
    status_indicator: "unknown",
    highest_impact: "none",
    unresolved_count: 0,
    cited_incident_ids: [],
    reasoning:
      "Fail-closed: live statuspage evidence unavailable (http_status_503). Contract refuses automatic payout without verified consensus evidence.",
    evidence_digest:
      "e5d4c3b2a1908f7e6d5c4b3a291807f6e5d4c3b2a1908f7e6d5c4b3a291807f6",
    terms_digest:
      "ff00ee11dd22cc33bb44aa559966887766554433221100ffeeddccbbaa998877",
    challenged: false,
    settled: false,
    receipt_digest:
      "1f2e3d4c5b6a79808172635445362718091a2b3c4d5e6f708192a3b4c5d6e7f8",
  },
];
