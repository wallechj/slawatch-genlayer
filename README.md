# SLAWatch — Trustless Cloud & API Uptime SLA Adjudicator on GenLayer

**SLAWatch** is a GenLayer Intelligent Contract and full-stack Next.js dApp that turns SaaS, RPC, and cloud uptime Service Level Agreements (SLAs) into verifiable, neutrally adjudicated on-chain claims.

## Why GenLayer? (The Trust Problem)

Traditional SLAs suffer from an inherent conflict of interest: **the service provider who failed uptime is also the judge of whether a customer deserves a service credit**. Traditional blockchains cannot solve this because smart contracts cannot independently fetch official status pages or interpret plain-English maintenance exclusions.

SLAWatch uses **GenLayer's multi-validator consensus** in a two-stage pipeline:
1. **Stage 1 — Deterministic Web Evidence Consensus (`gl.eq_principle.strict_eq` + `gl.nondet.web.get`)**: Every validator independently fetches the vendor's public Atlassian Statuspage v2 JSON endpoint (e.g. GitHub, Cloudflare, Vercel, OpenAI), parses and sorts active incidents, and produces a canonical SHA-256 `evidence_digest`.
2. **Stage 2 — Subjective SLA Clause Adjudication (`gl.eq_principle.prompt_non_comparative`)**: Validators evaluate whether the canonical incident evidence violates the registered plain-English SLA terms and maintenance exclusions, outputting a normalized verdict (`BREACH_CONFIRMED`, `NO_BREACH`, or `REVIEW_NEEDED`), credit basis points clamped to registered caps, and cited incident IDs.
3. **Fail-Closed & Immutable Receipts**: Unreachable status pages, HTTP 5xx errors, malformed JSON, or ambiguous LLM responses always fail closed to `REVIEW_NEEDED` (`0` bps). Every finalized adjudication produces a permanent `receipt_digest` that can be challenged once (`DISPUTED`) or settled (`SETTLED`).

## Architecture

- `contracts/sla_watch.py` — Self-contained GenLayer Python Intelligent Contract (`SLAWatch`)
- `tests/test_sla_watch.py` — Offline `pytest` test suite covering canonical SHA-256 determinism, fail-closed error handling, hallucinated ID filtering, credit clamping, and state machine transitions
- `src/lib/genlayer.ts` — Genuine `genlayer-js` integration (`studionet` & `testnetBradbury`) with full transaction lifecycle tracking (`preparing -> signing -> pending -> accepted -> finalized`)
- `src/app/api/statuspage/route.ts` — Live Statuspage v2 pre-flight inspector computing byte-identical SHA-256 digests in the browser/server before submitting on-chain
- `src/app/page.tsx` — Interactive On-Chain Workspace + Wallet-Free Live Statuspage Inspector + Verified Receipt Reference Explorer

## Live Deployment (GenLayer StudioNet · Chain ID 61999)

- **Contract Address**: `0x6b908b62Ee9D06a62ce063b3880B2E16eD424b36`
- **Deploy Transaction**: `0x88de10e8687498f4263d3a0bf61a39b911c0238bf194bb2cadf08d421b8c2e38`
- **Live Verified Seed Claim (`CLM-0001` on GitHub Statuspage v2)**:
  - Verdict: `NO_BREACH` (`0` bps) — validators independently verified `status_indicator: none` and zero active outages.
  - Evidence Digest: `948a31c6ed175155bb6926b0abffb0b0be3385af3b5cea9adc5efd045af3f4ce`
  - Receipt Digest: `0bba82c5e9cc153a346870342c965eca83eef709ff8808653d67e0bd40d41b1e`

## Quick Start

### 1. Run Contract Unit Tests
```bash
pytest tests/test_sla_watch.py -v
```

### 2. Deploy the Intelligent Contract
1. Open [GenLayer Studio](https://studio.genlayer.com/) (or use `genlayer deploy` / Shipyard).
2. Upload or paste `contracts/sla_watch.py` and deploy it to **StudioNet** or **Testnet Bradbury**.
3. Copy the deployed `0x...` contract address.

### 3. Run Locally or Deploy to Vercel
```bash
npm install
cp .env.example .env.local
# Set NEXT_PUBLIC_SLAWATCH_CONTRACT_ADDRESS=0x...
npm run dev
```

To deploy on **Vercel**:
1. Push this directory to a GitHub repository.
2. Import the repository in Vercel (Next.js is detected automatically at root).
3. Add environment variables `NEXT_PUBLIC_GENLAYER_NETWORK=studionet` (or `testnetBradbury`) and `NEXT_PUBLIC_SLAWATCH_CONTRACT_ADDRESS=0x...`.
4. Deploy!
