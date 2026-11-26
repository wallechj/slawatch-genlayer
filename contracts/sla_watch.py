# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import hashlib
import json
import re
import typing

IMPACT_RANK = {
    "none": 0,
    "maintenance": 1,
    "minor": 2,
    "major": 3,
    "critical": 4,
}

VALID_VERDICTS = ("BREACH_CONFIRMED", "NO_BREACH", "REVIEW_NEEDED")
VALID_CLAIM_STATES = (
    "CLAIM_OPEN",
    "BREACH_CONFIRMED",
    "NO_BREACH",
    "REVIEW_NEEDED",
    "DISPUTED",
    "SETTLED",
)


def canonical_json(data: typing.Any) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def normalize_url(url: str) -> str:
    cleaned = url.strip()
    if not cleaned.startswith("https://"):
        raise ValueError("statuspage_url must start with https://")
    if len(cleaned) > 300:
        raise ValueError("statuspage_url is too long")
    if not re.match(r"^https://[A-Za-z0-9.\-]+(?:/[A-Za-z0-9._\-/~%+]*)?$", cleaned):
        raise ValueError("statuspage_url contains unsupported characters")
    return cleaned


def normalize_impact(value: str) -> str:
    lowered = (value or "none").strip().lower()
    if lowered in IMPACT_RANK:
        return lowered
    return "none"


def parse_statuspage_summary(raw_body: str, source_url: str) -> dict:
    """Parse an Atlassian Statuspage v2 summary/incidents payload into a canonical evidence object."""
    try:
        payload = json.loads(raw_body)
    except Exception as exc:
        return {
            "ok": False,
            "error": f"invalid_json:{type(exc).__name__}",
            "source_url": source_url,
            "page_name": "",
            "status_indicator": "unknown",
            "status_description": "",
            "highest_impact": "none",
            "unresolved_count": 0,
            "incidents": [],
            "evidence_digest": sha256_hex(f"error|invalid_json|{source_url}"),
        }

    if not isinstance(payload, dict):
        return {
            "ok": False,
            "error": "payload_not_object",
            "source_url": source_url,
            "page_name": "",
            "status_indicator": "unknown",
            "status_description": "",
            "highest_impact": "none",
            "unresolved_count": 0,
            "incidents": [],
            "evidence_digest": sha256_hex(f"error|payload_not_object|{source_url}"),
        }

    page = payload.get("page") if isinstance(payload.get("page"), dict) else {}
    status = payload.get("status") if isinstance(payload.get("status"), dict) else {}
    raw_incidents = payload.get("incidents")
    if not isinstance(raw_incidents, list):
        raw_incidents = []

    normalized_incidents = []
    highest_impact = normalize_impact(str(status.get("indicator", "none")))
    unresolved_count = 0

    for item in raw_incidents[:20]:
        if not isinstance(item, dict):
            continue
        inc_id = str(item.get("id", "")).strip()
        name = str(item.get("name", "")).strip()[:160]
        impact = normalize_impact(str(item.get("impact", "none")))
        inc_status = str(item.get("status", "unknown")).strip().lower()
        started_at = str(item.get("started_at") or item.get("created_at") or "").strip()
        resolved_at = str(item.get("resolved_at") or "").strip()

        if IMPACT_RANK[impact] > IMPACT_RANK[highest_impact]:
            highest_impact = impact
        if inc_status not in ("resolved", "postmortem", "completed"):
            unresolved_count += 1

        normalized_incidents.append(
            {
                "id": inc_id,
                "name": name,
                "impact": impact,
                "status": inc_status,
                "started_at": started_at,
                "resolved_at": resolved_at,
            }
        )

    normalized_incidents.sort(key=lambda x: (x["started_at"], x["id"]))

    canonical_snapshot = {
        "ok": True,
        "source_url": source_url,
        "page_name": str(page.get("name", "")).strip()[:120],
        "status_indicator": normalize_impact(str(status.get("indicator", "none"))),
        "status_description": str(status.get("description", "")).strip()[:200],
        "highest_impact": highest_impact,
        "unresolved_count": unresolved_count,
        "incidents": normalized_incidents,
    }
    digest = sha256_hex(canonical_json(canonical_snapshot))
    canonical_snapshot["evidence_digest"] = digest
    return canonical_snapshot


def compute_deterministic_credit_bps(agreement: dict, evidence: dict) -> int:
    highest = normalize_impact(str(evidence.get("highest_impact", "none")))
    max_allowed = normalize_impact(str(agreement.get("max_allowed_impact", "minor")))
    unresolved = int(evidence.get("unresolved_count", 0))
    max_unresolved = int(agreement.get("max_unresolved_incidents", 0))

    breached_by_impact = IMPACT_RANK[highest] > IMPACT_RANK[max_allowed]
    breached_by_count = unresolved > max_unresolved and highest != "none"

    if not breached_by_impact and not breached_by_count:
        return 0

    if highest == "critical":
        return int(agreement.get("critical_credit_bps", 5000))
    if highest == "major":
        return int(agreement.get("major_credit_bps", 2500))
    return int(agreement.get("minor_credit_bps", 1000))


def normalize_adjudication_output(
    raw_llm_output: str,
    agreement: dict,
    evidence: dict,
) -> dict:
    """Normalize LLM judgment strictly and fail closed on malformed or ambiguous responses."""
    if not evidence.get("ok"):
        return {
            "verdict": "REVIEW_NEEDED",
            "credit_bps": 0,
            "cited_incident_ids": [],
            "reasoning": f"Fail-closed: live statuspage evidence unavailable ({evidence.get('error', 'unknown')}).",
            "deterministic_credit_bps": 0,
        }

    deterministic_bps = compute_deterministic_credit_bps(agreement, evidence)
    valid_incident_ids = {inc["id"] for inc in evidence.get("incidents", []) if inc.get("id")}

    cleaned = (raw_llm_output or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        parsed = json.loads(cleaned)
    except Exception:
        return {
            "verdict": "REVIEW_NEEDED",
            "credit_bps": 0,
            "cited_incident_ids": [],
            "reasoning": "Fail-closed: validator adjudication response was not valid JSON.",
            "deterministic_credit_bps": deterministic_bps,
        }

    if not isinstance(parsed, dict):
        return {
            "verdict": "REVIEW_NEEDED",
            "credit_bps": 0,
            "cited_incident_ids": [],
            "reasoning": "Fail-closed: validator adjudication response must be a JSON object.",
            "deterministic_credit_bps": deterministic_bps,
        }

    verdict = str(parsed.get("verdict", "REVIEW_NEEDED")).strip().upper()
    if verdict not in VALID_VERDICTS:
        verdict = "REVIEW_NEEDED"

    raw_cited = parsed.get("cited_incident_ids", [])
    cited_ids = []
    if isinstance(raw_cited, list):
        for item in raw_cited:
            sid = str(item).strip()
            if sid and (not valid_incident_ids or sid in valid_incident_ids):
                cited_ids.append(sid)
    cited_ids = sorted(set(cited_ids))

    reasoning = str(parsed.get("reasoning", "")).strip()[:400]
    if not reasoning:
        reasoning = "Evaluated against live statuspage snapshot and registered SLA terms."

    max_cap_bps = max(
        int(agreement.get("minor_credit_bps", 1000)),
        int(agreement.get("major_credit_bps", 2500)),
        int(agreement.get("critical_credit_bps", 5000)),
    )

    if verdict == "BREACH_CONFIRMED":
        raw_bps = parsed.get("credit_bps", deterministic_bps)
        try:
            chosen_bps = int(raw_bps)
        except Exception:
            chosen_bps = deterministic_bps
        if chosen_bps <= 0:
            chosen_bps = deterministic_bps
        chosen_bps = max(0, min(chosen_bps, max_cap_bps, 10000))
        if chosen_bps == 0:
            verdict = "REVIEW_NEEDED"
            reasoning = "Fail-closed: breach indicated without positive credit tier match."
    else:
        chosen_bps = 0

    return {
        "verdict": verdict,
        "credit_bps": chosen_bps,
        "cited_incident_ids": cited_ids,
        "reasoning": reasoning,
        "deterministic_credit_bps": deterministic_bps,
    }


class SLAWatch(gl.Contract):
    """Trustless API & Cloud Uptime SLA Adjudicator powered by GenLayer multi-validator consensus."""

    owner: Address
    agreement_counter: u256
    claim_counter: u256
    agreements: TreeMap[str, str]
    claims: TreeMap[str, str]
    receipts: TreeMap[str, str]
    agreement_ids: DynArray[str]
    claim_ids: DynArray[str]

    def __init__(self):
        self.owner = gl.message.sender_address
        self.agreement_counter = u256(0)
        self.claim_counter = u256(0)

    @gl.public.write
    def create_agreement(
        self,
        vendor_name: str,
        statuspage_url: str,
        customer_address: str,
        max_allowed_impact: str,
        max_unresolved_incidents: int,
        minor_credit_bps: int,
        major_credit_bps: int,
        critical_credit_bps: int,
        sla_terms: str,
    ) -> str:
        clean_vendor = vendor_name.strip()
        if not clean_vendor or len(clean_vendor) > 100:
            raise ValueError("vendor_name must be 1-100 characters")

        clean_url = normalize_url(statuspage_url)
        clean_impact = normalize_impact(max_allowed_impact)
        if max_unresolved_incidents < 0 or max_unresolved_incidents > 50:
            raise ValueError("max_unresolved_incidents must be between 0 and 50")

        for label, bps in (
            ("minor_credit_bps", minor_credit_bps),
            ("major_credit_bps", major_credit_bps),
            ("critical_credit_bps", critical_credit_bps),
        ):
            if bps < 0 or bps > 10000:
                raise ValueError(f"{label} must be between 0 and 10000")

        clean_terms = sla_terms.strip()
        if len(clean_terms) < 10 or len(clean_terms) > 1500:
            raise ValueError("sla_terms must be 10-1500 characters")

        self.agreement_counter = u256(int(self.agreement_counter) + 1)
        agreement_id = f"SLA-{int(self.agreement_counter):04d}"
        provider = str(gl.message.sender_address)
        customer = customer_address.strip() or provider

        record = {
            "agreement_id": agreement_id,
            "vendor_name": clean_vendor,
            "statuspage_url": clean_url,
            "provider": provider,
            "customer": customer,
            "max_allowed_impact": clean_impact,
            "max_unresolved_incidents": int(max_unresolved_incidents),
            "minor_credit_bps": int(minor_credit_bps),
            "major_credit_bps": int(major_credit_bps),
            "critical_credit_bps": int(critical_credit_bps),
            "sla_terms": clean_terms,
            "status": "ACTIVE",
        }
        record["terms_digest"] = sha256_hex(canonical_json(record))
        self.agreements[agreement_id] = canonical_json(record)
        self.agreement_ids.append(agreement_id)
        return agreement_id

    @gl.public.write
    def open_claim(
        self,
        agreement_id: str,
        incident_window: str,
        claim_summary: str,
    ) -> str:
        raw_agreement = self.agreements.get(agreement_id, "")
        if not raw_agreement:
            raise ValueError(f"Agreement not found: {agreement_id}")

        clean_window = incident_window.strip()
        clean_summary = claim_summary.strip()
        if not clean_window or len(clean_window) > 120:
            raise ValueError("incident_window must be 1-120 characters")
        if len(clean_summary) < 10 or len(clean_summary) > 1000:
            raise ValueError("claim_summary must be 10-1000 characters")

        self.claim_counter = u256(int(self.claim_counter) + 1)
        claim_id = f"CLM-{int(self.claim_counter):04d}"

        claim = {
            "claim_id": claim_id,
            "agreement_id": agreement_id,
            "claimant": str(gl.message.sender_address),
            "incident_window": clean_window,
            "claim_summary": clean_summary,
            "status": "CLAIM_OPEN",
            "verdict": "",
            "credit_bps": 0,
            "challenged": False,
            "challenge_note": "",
            "evidence_digest": "",
            "cited_incident_ids": [],
            "reasoning": "",
        }
        self.claims[claim_id] = canonical_json(claim)
        self.claim_ids.append(claim_id)
        return claim_id

    @gl.public.write
    def adjudicate_claim(self, claim_id: str) -> str:
        raw_claim = self.claims.get(claim_id, "")
        if not raw_claim:
            raise ValueError(f"Claim not found: {claim_id}")
        claim = json.loads(raw_claim)
        if claim["status"] not in ("CLAIM_OPEN", "DISPUTED"):
            raise ValueError(f"Claim {claim_id} is already in terminal state: {claim['status']}")

        agreement = json.loads(self.agreements[claim["agreement_id"]])
        target_url = agreement["statuspage_url"]

        # Stage 1: Independent validator web fetch + canonical evidence digest under strict_eq
        def fetch_canonical_statuspage() -> str:
            try:
                response = gl.nondet.web.get(target_url)
                http_status = getattr(response, "status", getattr(response, "status_code", 0))
                if http_status != 200:
                    err_obj = {
                        "ok": False,
                        "error": f"http_status_{http_status}",
                        "source_url": target_url,
                        "page_name": "",
                        "status_indicator": "unknown",
                        "status_description": "",
                        "highest_impact": "none",
                        "unresolved_count": 0,
                        "incidents": [],
                        "evidence_digest": sha256_hex(f"http_error|{http_status}|{target_url}"),
                    }
                    return canonical_json(err_obj)
                raw_body = response.body
                body = raw_body.decode("utf-8") if isinstance(raw_body, (bytes, bytearray)) else str(raw_body)
                parsed = parse_statuspage_summary(body, target_url)
                return canonical_json(parsed)
            except Exception as exc:
                err_obj = {
                    "ok": False,
                    "error": f"fetch_failed:{type(exc).__name__}",
                    "source_url": target_url,
                    "page_name": "",
                    "status_indicator": "unknown",
                    "status_description": "",
                    "highest_impact": "none",
                    "unresolved_count": 0,
                    "incidents": [],
                    "evidence_digest": sha256_hex(f"fetch_failed|{target_url}"),
                }
                return canonical_json(err_obj)

        canonical_evidence_json = gl.eq_principle.strict_eq(fetch_canonical_statuspage)
        evidence = json.loads(canonical_evidence_json)

        if not evidence.get("ok"):
            adjudication = normalize_adjudication_output("", agreement, evidence)
        else:
            # Stage 2: Subjective SLA clause adjudication with prompt_non_comparative
            def build_adjudication_input() -> str:
                return canonical_json(
                    {
                        "agreement": {
                            "vendor_name": agreement["vendor_name"],
                            "max_allowed_impact": agreement["max_allowed_impact"],
                            "max_unresolved_incidents": agreement["max_unresolved_incidents"],
                            "minor_credit_bps": agreement["minor_credit_bps"],
                            "major_credit_bps": agreement["major_credit_bps"],
                            "critical_credit_bps": agreement["critical_credit_bps"],
                            "sla_terms": agreement["sla_terms"],
                        },
                        "claim": {
                            "incident_window": claim["incident_window"],
                            "claim_summary": claim["claim_summary"],
                            "challenge_note": claim.get("challenge_note", ""),
                        },
                        "live_evidence": evidence,
                    }
                )

            task_prompt = (
                "Adjudicate whether the live Statuspage evidence proves an SLA breach under the "
                "registered agreement terms and exclusions. Return ONLY a strict JSON object with keys: "
                "verdict ('BREACH_CONFIRMED' | 'NO_BREACH' | 'REVIEW_NEEDED'), "
                "credit_bps (integer 0..10000 matching the agreement credit tier if breach is confirmed, else 0), "
                "cited_incident_ids (array of incident id strings from live_evidence), "
                "and reasoning (concise factual justification under 300 chars). "
                "If scheduled maintenance exclusions apply or evidence is ambiguous, fail closed to REVIEW_NEEDED or NO_BREACH."
            )
            criteria_prompt = (
                "- Output MUST be valid JSON with keys verdict, credit_bps, cited_incident_ids, reasoning.\n"
                "- Verdict MUST be one of BREACH_CONFIRMED, NO_BREACH, REVIEW_NEEDED.\n"
                "- Any cited_incident_ids MUST exist in live_evidence.incidents.\n"
                "- If status_indicator is none and incidents is empty, verdict MUST NOT be BREACH_CONFIRMED.\n"
                "- If verdict is BREACH_CONFIRMED, credit_bps MUST match the registered SLA tier and be > 0.\n"
                "- Reasoning MUST ground directly in live_evidence and sla_terms with zero hallucinated incidents."
            )

            raw_llm = gl.eq_principle.prompt_non_comparative(
                fn=build_adjudication_input,
                task=task_prompt,
                criteria=criteria_prompt,
            )
            adjudication = normalize_adjudication_output(raw_llm, agreement, evidence)

        claim["status"] = adjudication["verdict"]
        claim["verdict"] = adjudication["verdict"]
        claim["credit_bps"] = adjudication["credit_bps"]
        claim["evidence_digest"] = evidence["evidence_digest"]
        claim["cited_incident_ids"] = adjudication["cited_incident_ids"]
        claim["reasoning"] = adjudication["reasoning"]
        self.claims[claim_id] = canonical_json(claim)

        receipt = {
            "receipt_id": f"RCPT-{claim_id}",
            "claim_id": claim_id,
            "agreement_id": claim["agreement_id"],
            "vendor_name": agreement["vendor_name"],
            "source_url": target_url,
            "adjudicated_by": str(gl.message.sender_address),
            "verdict": adjudication["verdict"],
            "credit_bps": adjudication["credit_bps"],
            "deterministic_credit_bps": adjudication["deterministic_credit_bps"],
            "status_indicator": evidence.get("status_indicator", "unknown"),
            "highest_impact": evidence.get("highest_impact", "none"),
            "unresolved_count": evidence.get("unresolved_count", 0),
            "cited_incident_ids": adjudication["cited_incident_ids"],
            "reasoning": adjudication["reasoning"],
            "evidence_digest": evidence["evidence_digest"],
            "terms_digest": agreement["terms_digest"],
            "challenged": claim["challenged"],
            "settled": False,
        }
        receipt["receipt_digest"] = sha256_hex(canonical_json(receipt))
        self.receipts[claim_id] = canonical_json(receipt)
        return canonical_json(receipt)

    @gl.public.write
    def challenge_claim(self, claim_id: str, counter_evidence_note: str) -> str:
        raw_claim = self.claims.get(claim_id, "")
        if not raw_claim:
            raise ValueError(f"Claim not found: {claim_id}")
        claim = json.loads(raw_claim)
        if claim["challenged"]:
            raise ValueError("Claim has already been challenged once")
        if claim["status"] not in ("BREACH_CONFIRMED", "NO_BREACH", "REVIEW_NEEDED"):
            raise ValueError(f"Cannot challenge claim in status {claim['status']}")

        note = counter_evidence_note.strip()
        if len(note) < 10 or len(note) > 600:
            raise ValueError("counter_evidence_note must be 10-600 characters")

        claim["challenged"] = True
        claim["challenge_note"] = note
        claim["status"] = "DISPUTED"
        self.claims[claim_id] = canonical_json(claim)
        return claim_id

    @gl.public.write
    def settle_claim(self, claim_id: str) -> str:
        raw_claim = self.claims.get(claim_id, "")
        if not raw_claim:
            raise ValueError(f"Claim not found: {claim_id}")
        claim = json.loads(raw_claim)
        if claim["status"] != "BREACH_CONFIRMED":
            raise ValueError("Only BREACH_CONFIRMED claims can be settled")

        claim["status"] = "SETTLED"
        self.claims[claim_id] = canonical_json(claim)

        raw_receipt = self.receipts.get(claim_id, "")
        if raw_receipt:
            receipt = json.loads(raw_receipt)
            receipt["settled"] = True
            receipt["settled_by"] = str(gl.message.sender_address)
            self.receipts[claim_id] = canonical_json(receipt)
        return claim_id

    @gl.public.view
    def get_overview(self) -> typing.Any:
        return {
            "owner": str(self.owner),
            "total_agreements": int(self.agreement_counter),
            "total_claims": int(self.claim_counter),
        }

    @gl.public.view
    def list_agreements(self) -> typing.Any:
        results = []
        for aid in self.agreement_ids:
            raw = self.agreements.get(aid, "")
            if raw:
                results.append(json.loads(raw))
        return results

    @gl.public.view
    def get_agreement(self, agreement_id: str) -> typing.Any:
        raw = self.agreements.get(agreement_id, "")
        if not raw:
            return {}
        return json.loads(raw)

    @gl.public.view
    def list_claims(self) -> typing.Any:
        results = []
        for cid in self.claim_ids:
            raw = self.claims.get(cid, "")
            if raw:
                results.append(json.loads(raw))
        return results

    @gl.public.view
    def get_claim(self, claim_id: str) -> typing.Any:
        raw = self.claims.get(claim_id, "")
        if not raw:
            return {}
        return json.loads(raw)

    @gl.public.view
    def get_receipt(self, claim_id: str) -> typing.Any:
        raw = self.receipts.get(claim_id, "")
        if not raw:
            return {}
        return json.loads(raw)
