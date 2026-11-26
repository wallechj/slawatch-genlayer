from contextlib import contextmanager
import importlib.util
import json
import sys
import types
from pathlib import Path


@contextmanager
def raises(expected_exc):
    try:
        yield
    except expected_exc:
        return
    raise AssertionError(f"Expected {expected_exc.__name__} to be raised")


def load_sla_watch_module(mock_http_status=200, mock_http_body="{}", mock_llm_output="{}"):
    """Load contracts/sla_watch.py against a deterministic local mock of the genlayer runtime."""
    genlayer_mod = types.ModuleType("genlayer")

    class _MockContract:
        pass

    class _MockTreeMap(dict):
        def __class_getitem__(cls, item):
            return cls

    class _MockDynArray(list):
        def __class_getitem__(cls, item):
            return cls

    class _MockAddress(str):
        pass

    class _MockU256(int):
        pass

    class _MockResponse:
        def __init__(self, status, body_str):
            self.status = status
            self.body = body_str.encode("utf-8")

    state = {
        "sender": "0x1111111111111111111111111111111111111111",
        "http_status": mock_http_status,
        "http_body": mock_http_body,
        "llm_output": mock_llm_output,
    }

    gl_ns = types.SimpleNamespace()
    gl_ns.Contract = _MockContract
    gl_ns.public = types.SimpleNamespace(
        write=lambda fn: fn,
        view=lambda fn: fn,
    )
    gl_ns.message = types.SimpleNamespace(sender_address=_MockAddress(state["sender"]))
    gl_ns.nondet = types.SimpleNamespace(
        web=types.SimpleNamespace(
            get=lambda url: _MockResponse(state["http_status"], state["http_body"])
        )
    )
    gl_ns.eq_principle = types.SimpleNamespace(
        strict_eq=lambda fn: fn(),
        prompt_non_comparative=lambda fn, task, criteria: (fn(), state["llm_output"])[1],
    )

    genlayer_mod.gl = gl_ns
    genlayer_mod.TreeMap = _MockTreeMap
    genlayer_mod.DynArray = _MockDynArray
    genlayer_mod.Address = _MockAddress
    genlayer_mod.u256 = _MockU256

    sys.modules["genlayer"] = genlayer_mod

    contract_path = Path(__file__).resolve().parents[1] / "contracts" / "sla_watch.py"
    spec = importlib.util.spec_from_file_location("sla_watch_contract", contract_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module, state, gl_ns


def instantiate_contract(module):
    contract = module.SLAWatch()
    contract.agreements = {}
    contract.claims = {}
    contract.receipts = {}
    contract.agreement_ids = []
    contract.claim_ids = []
    return contract


SAMPLE_OUTAGE_PAYLOAD = json.dumps(
    {
        "page": {"id": "kctbh9vrtdwd", "name": "GitHub"},
        "status": {"indicator": "major", "description": "Major Service Outage"},
        "incidents": [
            {
                "id": "inc-2026-002",
                "name": "API Requests Degraded Performance",
                "impact": "major",
                "status": "investigating",
                "started_at": "2026-11-25T10:15:00Z",
                "resolved_at": None,
            },
            {
                "id": "inc-2026-001",
                "name": "Scheduled DB Maintenance",
                "impact": "maintenance",
                "status": "completed",
                "started_at": "2026-11-24T01:00:00Z",
                "resolved_at": "2026-11-24T01:30:00Z",
            },
        ],
    }
)

SAMPLE_HEALTHY_PAYLOAD = json.dumps(
    {
        "page": {"id": "kctbh9vrtdwd", "name": "GitHub"},
        "status": {"indicator": "none", "description": "All Systems Operational"},
        "incidents": [],
    }
)


def test_parse_statuspage_canonical_and_deterministic_digest():
    mod, _, _ = load_sla_watch_module()
    p1 = mod.parse_statuspage_summary(SAMPLE_OUTAGE_PAYLOAD, "https://www.githubstatus.com/api/v2/summary.json")
    # Reorder incidents in raw payload — digest must remain identical
    reordered = json.loads(SAMPLE_OUTAGE_PAYLOAD)
    reordered["incidents"].reverse()
    p2 = mod.parse_statuspage_summary(json.dumps(reordered), "https://www.githubstatus.com/api/v2/summary.json")
    assert p1["ok"] is True
    assert p1["highest_impact"] == "major"
    assert p1["unresolved_count"] == 1
    assert p1["evidence_digest"] == p2["evidence_digest"]
    assert len(p1["evidence_digest"]) == 64


def test_parse_statuspage_invalid_json_fails_closed():
    mod, _, _ = load_sla_watch_module()
    parsed = mod.parse_statuspage_summary("{bad json", "https://status.example.com/api/v2/summary.json")
    assert parsed["ok"] is False
    assert parsed["error"].startswith("invalid_json:")


def test_normalize_url_enforces_https():
    mod, _, _ = load_sla_watch_module()
    assert mod.normalize_url("https://status.vercel.com/api/v2/summary.json").startswith("https://")
    with raises(ValueError):
        mod.normalize_url("http://status.vercel.com/api/v2/summary.json")
    with raises(ValueError):
        mod.normalize_url("https://status.vercel.com/bad space")


def test_create_agreement_and_open_claim_lifecycle():
    mod, _, _ = load_sla_watch_module()
    c = instantiate_contract(mod)
    aid = c.create_agreement(
        "GitHub Enterprise",
        "https://www.githubstatus.com/api/v2/summary.json",
        "0x2222222222222222222222222222222222222222",
        "minor",
        0,
        1000,
        2500,
        5000,
        "Unscheduled major or critical API outages trigger 25% or 50% service credit. Scheduled maintenance excluded.",
    )
    assert aid == "SLA-0001"
    overview = c.get_overview()
    assert overview["total_agreements"] == 1
    assert overview["total_claims"] == 0

    cid = c.open_claim(aid, "2026-11-25 10:00-11:00 UTC", "Production webhooks failed during major GitHub API outage.")
    assert cid == "CLM-0001"
    assert c.get_claim(cid)["status"] == "CLAIM_OPEN"


def test_adjudicate_breach_confirmed_and_settle():
    llm_reply = json.dumps(
        {
            "verdict": "BREACH_CONFIRMED",
            "credit_bps": 2500,
            "cited_incident_ids": ["inc-2026-002"],
            "reasoning": "Unresolved major outage inc-2026-002 exceeds allowed minor threshold.",
        }
    )
    mod, _, _ = load_sla_watch_module(200, SAMPLE_OUTAGE_PAYLOAD, llm_reply)
    c = instantiate_contract(mod)
    aid = c.create_agreement(
        "GitHub API",
        "https://www.githubstatus.com/api/v2/summary.json",
        "0x2222222222222222222222222222222222222222",
        "minor",
        0,
        1000,
        2500,
        5000,
        "Unscheduled major outages grant 2500 bps credit; critical grants 5000 bps.",
    )
    cid = c.open_claim(aid, "2026-11-25", "API major outage impacted production traffic.")
    receipt_json = c.adjudicate_claim(cid)
    receipt = json.loads(receipt_json)

    assert receipt["verdict"] == "BREACH_CONFIRMED"
    assert receipt["credit_bps"] == 2500
    assert receipt["cited_incident_ids"] == ["inc-2026-002"]
    assert receipt["settled"] is False
    assert len(receipt["receipt_digest"]) == 64

    c.settle_claim(cid)
    assert c.get_claim(cid)["status"] == "SETTLED"
    assert c.get_receipt(cid)["settled"] is True


def test_adjudicate_no_breach_on_healthy_statuspage():
    llm_reply = json.dumps(
        {
            "verdict": "NO_BREACH",
            "credit_bps": 0,
            "cited_incident_ids": [],
            "reasoning": "Statuspage reports all systems operational with zero incidents.",
        }
    )
    mod, _, _ = load_sla_watch_module(200, SAMPLE_HEALTHY_PAYLOAD, llm_reply)
    c = instantiate_contract(mod)
    aid = c.create_agreement(
        "GitHub API",
        "https://www.githubstatus.com/api/v2/summary.json",
        "0x2222222222222222222222222222222222222222",
        "minor",
        0,
        1000,
        2500,
        5000,
        "Unscheduled major outages grant 2500 bps credit.",
    )
    cid = c.open_claim(aid, "2026-11-25", "Checking whether any outage occurred.")
    receipt = json.loads(c.adjudicate_claim(cid))
    assert receipt["verdict"] == "NO_BREACH"
    assert receipt["credit_bps"] == 0
    with raises(ValueError):
        c.settle_claim(cid)


def test_adjudicate_http_503_fails_closed_to_review_needed():
    mod, _, _ = load_sla_watch_module(503, "Service Unavailable", '{"verdict":"BREACH_CONFIRMED","credit_bps":5000}')
    c = instantiate_contract(mod)
    aid = c.create_agreement(
        "Cloudflare",
        "https://www.cloudflarestatus.com/api/v2/summary.json",
        "0x2222222222222222222222222222222222222222",
        "minor",
        0,
        1000,
        2500,
        5000,
        "Unscheduled major outages trigger 25% credit.",
    )
    cid = c.open_claim(aid, "2026-11-25", "Statuspage returned HTTP 503 during claim.")
    receipt = json.loads(c.adjudicate_claim(cid))
    assert receipt["verdict"] == "REVIEW_NEEDED"
    assert receipt["credit_bps"] == 0
    assert "Fail-closed" in receipt["reasoning"]


def test_adjudicate_malformed_llm_json_fails_closed():
    mod, _, _ = load_sla_watch_module(200, SAMPLE_OUTAGE_PAYLOAD, "Not a JSON object at all")
    c = instantiate_contract(mod)
    aid = c.create_agreement(
        "GitHub API",
        "https://www.githubstatus.com/api/v2/summary.json",
        "0x2222222222222222222222222222222222222222",
        "minor",
        0,
        1000,
        2500,
        5000,
        "Unscheduled major outages trigger 25% credit.",
    )
    cid = c.open_claim(aid, "2026-11-25", "Testing malformed LLM output fail-closed behavior.")
    receipt = json.loads(c.adjudicate_claim(cid))
    assert receipt["verdict"] == "REVIEW_NEEDED"
    assert receipt["credit_bps"] == 0


def test_credit_bps_clamped_to_registered_cap_and_hallucinated_ids_filtered():
    llm_reply = json.dumps(
        {
            "verdict": "BREACH_CONFIRMED",
            "credit_bps": 9999,
            "cited_incident_ids": ["inc-2026-002", "fake-incident-999"],
            "reasoning": "Major incident confirmed.",
        }
    )
    mod, _, _ = load_sla_watch_module(200, SAMPLE_OUTAGE_PAYLOAD, llm_reply)
    c = instantiate_contract(mod)
    aid = c.create_agreement(
        "GitHub API",
        "https://www.githubstatus.com/api/v2/summary.json",
        "0x2222222222222222222222222222222222222222",
        "minor",
        0,
        1000,
        2500,
        5000,
        "Unscheduled major outages trigger 25% credit, critical 50%.",
    )
    cid = c.open_claim(aid, "2026-11-25", "Major outage check.")
    receipt = json.loads(c.adjudicate_claim(cid))
    assert receipt["credit_bps"] == 5000  # capped at critical_credit_bps
    assert receipt["cited_incident_ids"] == ["inc-2026-002"]


def test_single_challenge_allowed_and_re_adjudication_works():
    mod, state, _ = load_sla_watch_module(
        200,
        SAMPLE_HEALTHY_PAYLOAD,
        json.dumps({"verdict": "NO_BREACH", "credit_bps": 0, "cited_incident_ids": [], "reasoning": "Healthy."}),
    )
    c = instantiate_contract(mod)
    aid = c.create_agreement(
        "Vercel",
        "https://status.vercel.com/api/v2/summary.json",
        "0x2222222222222222222222222222222222222222",
        "minor",
        0,
        1000,
        2500,
        5000,
        "Unscheduled major outages grant 2500 bps credit.",
    )
    cid = c.open_claim(aid, "2026-11-25", "Initial claim before outage appeared on statuspage.")
    c.adjudicate_claim(cid)
    assert c.get_claim(cid)["status"] == "NO_BREACH"

    # Challenge once
    c.challenge_claim(cid, "Statuspage published incident inc-2026-002 ten minutes later; requesting re-adjudication.")
    assert c.get_claim(cid)["status"] == "DISPUTED"

    # Second challenge must fail
    with raises(ValueError):
        c.challenge_claim(cid, "Trying to challenge a second time must be rejected.")

    # Re-adjudicate with new live outage payload
    state["http_body"] = SAMPLE_OUTAGE_PAYLOAD
    state["llm_output"] = json.dumps(
        {
            "verdict": "BREACH_CONFIRMED",
            "credit_bps": 2500,
            "cited_incident_ids": ["inc-2026-002"],
            "reasoning": "Confirmed on re-adjudication.",
        }
    )
    receipt = json.loads(c.adjudicate_claim(cid))
    assert receipt["verdict"] == "BREACH_CONFIRMED"
    assert receipt["challenged"] is True


def test_input_validation_rejects_bad_parameters():
    mod, _, _ = load_sla_watch_module()
    c = instantiate_contract(mod)
    with raises(ValueError):
        c.create_agreement("", "https://status.vercel.com/api/v2/summary.json", "", "minor", 0, 1000, 2500, 5000, "Valid SLA terms here.")
    with raises(ValueError):
        c.create_agreement("Vercel", "https://status.vercel.com/api/v2/summary.json", "", "minor", 0, 15000, 2500, 5000, "Valid SLA terms here.")
    with raises(ValueError):
        c.create_agreement("Vercel", "https://status.vercel.com/api/v2/summary.json", "", "minor", 0, 1000, 2500, 5000, "too short")
    with raises(ValueError):
        c.open_claim("SLA-9999", "2026-11-25", "Missing agreement should fail.")


if __name__ == "__main__":
    passed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
            passed += 1
    print(f"\nAll {passed} SLAWatch tests passed.")
