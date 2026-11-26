# GenLayer Portal Submission Guide — SLAWatch

以下内容可直接复制填写到 `https://portal.genlayer.foundation/submit-contribution`（选择 **开发者 → Projects**）。

---

## 01 基本信息
- **标志 (Logo)**：上传 `public/logo.png`（512×512 PNG）
- **项目名称**：`SLAWatch`
- **主标签**：`争议解决`（Dispute Resolution）
- **标签 1 / 标签 2**：选择主标签下最贴近的两个子主题（例如仲裁/争议处理、托管/合约验证）

---

## 02 项目摘要（一句话简介，<= 180 字符）
```text
Trustless cloud & API uptime SLA adjudicator on GenLayer that verifies live Statuspage feeds via multi-validator consensus and issues fail-closed, auditable credit receipts.
```
（长度：175 字符）

---

## 03 项目概览（描述，<= 1000 字符）
```text
SLAWatch fixes a real trust gap in cloud, RPC, and SaaS SLAs: today, the vendor causing an outage also decides whether customers deserve a service credit.

SLAWatch uses a two-stage GenLayer Intelligent Contract (contracts/sla_watch.py):
1. Strict Evidence Consensus: Validators independently fetch the vendor's official Atlassian Statuspage v2 JSON API via gl.nondet.web.get, normalize incidents, and agree on a SHA-256 evidence_digest under gl.eq_principle.strict_eq.
2. Neutral Clause Judging: Validators apply gl.eq_principle.prompt_non_comparative to judge plain-English SLA terms and maintenance exclusions, outputting BREACH_CONFIRMED, NO_BREACH, or REVIEW_NEEDED with clamped credit bps and verified incident IDs.

Unreachable APIs or bad JSON fail closed to REVIEW_NEEDED (0 bps). Claims follow CLAIM_OPEN -> Adjudicated -> DISPUTED/SETTLED with immutable receipts, a genlayer-js app, and a wallet-free live Statuspage inspector.
```
（长度：<= 1000 字符）

---

## 04 演示视频（选填）
- 可录制 1 分钟操作录屏发布到 YouTube 或 X，填写直达帖子链接（加分项）。

---

## 05 使用步骤（可分 4 步填写）

### 步骤 1
- **标题**：`Inspect Live Statuspage Evidence (No Wallet Needed)`
- **操作说明**：
```text
Open the SLAWatch web app and switch to the "Live Statuspage Inspector" tab. Click "Inspect GitHub Live" or "Inspect Cloudflare Live" to fetch the real official Statuspage v2 JSON feed and inspect the canonical SHA-256 evidence digest that matches contracts/sla_watch.py.
```

### 步骤 2
- **标题**：`Connect Wallet & Register an SLA Agreement`
- **操作说明**：
```text
Select GenLayer StudioNet (or Testnet Bradbury), enter the deployed SLAWatch contract address (pre-filled via env), and connect an EVM wallet. In "On-Chain Workspace", choose a vendor preset (e.g., GitHub or Cloudflare), review credit bps tiers and plain-English SLA terms, and click "Sign & Register SLA Agreement On-Chain".
```

### 步骤 3
- **标题**：`Open Claim & Trigger Multi-Validator Adjudication`
- **操作说明**：
```text
Select the registered Agreement ID (e.g., SLA-0001), enter an incident window and claim summary, and click "Open On-Chain Breach Claim". Once finalized, click "Run Multi-Validator Adjudication" on the claim card and observe the live Preparing -> Signing -> Pending -> Accepted -> Finalized transaction tracker.
```

### 步骤 4
- **标题**：`Verify Immutable Receipt, Challenge, or Settle`
- **操作说明**：
```text
After adjudication finalizes, click "View Receipt" to inspect the immutable on-chain receipt containing verdict, credit_bps, cited_incident_ids, reasoning, evidence_digest, and receipt_digest. You can also test single-pass challenge (DISPUTED) or credit settlement (SETTLED), or view reference simulations in the "Verified Receipts & Audit Log" tab without a wallet.
```

---

## 06 审核验证
- **预期验证结果（<= 500 字符）**：
```text
1) Opening the site auto-loads live StudioNet state (SLA-0001 and CLM-0001) from 0x6b908b62Ee9D06a62ce063b3880B2E16eD424b36 with finalized NO_BREACH receipt RCPT-CLM-0001 (viewable via "View Receipt" without a wallet). 2) Live Statuspage Inspector fetches official Statuspage v2 JSON and outputs a 64-char SHA-256 digest matching contracts/sla_watch.py. 3) Wallet users can register agreements, open claims, and run adjudicate_claim() with full tx lifecycle tracking. 4) Offline tests pass 11/11.
```
- **合约链接 1（可选）**：`https://genlayer-explorer.vercel.app/address/0x6b908b62Ee9D06a62ce063b3880B2E16eD424b36`

---

## 07 项目链接 & 证明材料
- **网站（必填）**：`https://slawatch-genlayer.vercel.app`
- **GITHUB**：`https://github.com/wallechj/slawatch-genlayer`
- **证明材料（必填 GitHub Repository）**：`https://github.com/wallechj/slawatch-genlayer`
