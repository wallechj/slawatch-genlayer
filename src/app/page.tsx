"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  Gavel,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  connectWallet,
  formatError,
  isValidContractAddress,
  NETWORK_OPTIONS,
  NetworkKey,
  readSLAWatch,
  TxLifecycleState,
  writeSLAWatch,
} from "@/lib/genlayer";
import { CanonicalStatuspageEvidence } from "@/lib/canonical";
import {
  AgreementRecord,
  ClaimRecord,
  ReceiptRecord,
  SAMPLE_VERIFIED_RECEIPTS,
  STATUSPAGE_PRESETS,
} from "@/lib/demo-data";

type ActiveTab = "workspace" | "inspector" | "receipts";

const DEFAULT_CONTRACT =
  process.env.NEXT_PUBLIC_SLAWATCH_CONTRACT_ADDRESS ||
  "0x6b908b62Ee9D06a62ce063b3880B2E16eD424b36";
const DEFAULT_NETWORK =
  (process.env.NEXT_PUBLIC_GENLAYER_NETWORK as NetworkKey) || "studionet";

export default function SLAWatchPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("workspace");
  const [network, setNetwork] = useState<NetworkKey>(DEFAULT_NETWORK);
  const [contractAddress, setContractAddress] = useState<string>(DEFAULT_CONTRACT);
  const [walletAddress, setWalletAddress] = useState<`0x${string}` | null>(null);
  const [walletError, setWalletError] = useState<string>("");

  // On-chain contract state
  const [agreements, setAgreements] = useState<AgreementRecord[]>([]);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptRecord | null>(null);
  const [loadingChain, setLoadingChain] = useState(false);
  const [chainError, setChainError] = useState<string>("");

  // Transaction lifecycle
  const [txState, setTxState] = useState<TxLifecycleState>({
    stage: "idle",
    action: "",
    message: "Ready to interact with GenLayer SLAWatch contract.",
  });

  // Create Agreement form
  const [vendorName, setVendorName] = useState(STATUSPAGE_PRESETS[0].vendor);
  const [statuspageUrl, setStatuspageUrl] = useState(STATUSPAGE_PRESETS[0].url);
  const [customerAddress, setCustomerAddress] = useState("");
  const [maxAllowedImpact, setMaxAllowedImpact] = useState("minor");
  const [maxUnresolved, setMaxUnresolved] = useState(0);
  const [minorBps, setMinorBps] = useState(1000);
  const [majorBps, setMajorBps] = useState(2500);
  const [criticalBps, setCriticalBps] = useState(5000);
  const [slaTerms, setSlaTerms] = useState(STATUSPAGE_PRESETS[0].defaultTerms);

  // Open Claim form
  const [claimAgreementId, setClaimAgreementId] = useState("SLA-0001");
  const [incidentWindow, setIncidentWindow] = useState("2026-11-26 00:00–23:59 UTC");
  const [claimSummary, setClaimSummary] = useState(
    "Production API requests experienced unscheduled outage impacting core endpoints."
  );

  // Live Statuspage Pre-Flight Inspector
  const [inspectUrl, setInspectUrl] = useState(STATUSPAGE_PRESETS[0].url);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState("");
  const [inspectResult, setInspectResult] = useState<CanonicalStatuspageEvidence | null>(null);

  const hasValidContract = isValidContractAddress(contractAddress);

  const refreshChainState = useCallback(async () => {
    if (!isValidContractAddress(contractAddress)) return;
    setLoadingChain(true);
    setChainError("");
    try {
      const [fetchedAgreements, fetchedClaims] = await Promise.all([
        readSLAWatch<AgreementRecord[]>(network, contractAddress, "list_agreements"),
        readSLAWatch<ClaimRecord[]>(network, contractAddress, "list_claims"),
      ]);
      setAgreements(Array.isArray(fetchedAgreements) ? fetchedAgreements : []);
      setClaims(Array.isArray(fetchedClaims) ? fetchedClaims : []);
      if (Array.isArray(fetchedAgreements) && fetchedAgreements.length > 0) {
        setClaimAgreementId(fetchedAgreements[fetchedAgreements.length - 1].agreement_id);
      }
    } catch (err) {
      setChainError(
        err instanceof Error ? err.message : "Failed to read SLAWatch contract state."
      );
    } finally {
      setLoadingChain(false);
    }
  }, [contractAddress, network]);

  useEffect(() => {
    if (hasValidContract) {
      void refreshChainState();
    }
  }, [hasValidContract, refreshChainState]);

  async function handleConnectWallet() {
    setWalletError("");
    try {
      const account = await connectWallet();
      setWalletAddress(account);
      if (!customerAddress) setCustomerAddress(account);
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Wallet connection failed.");
    }
  }

  async function runContractWrite(
    functionName: string,
    args: unknown[],
    actionLabel: string
  ) {
    if (!isValidContractAddress(contractAddress)) {
      setTxState({
        stage: "error",
        action: actionLabel,
        message: "Enter a valid 0x... deployed SLAWatch contract address first.",
      });
      return;
    }
    if (!walletAddress) {
      setTxState({
        stage: "error",
        action: actionLabel,
        message: "Connect your wallet to sign GenLayer transactions.",
      });
      return;
    }
    try {
      await writeSLAWatch({
        network,
        contractAddress,
        account: walletAddress,
        functionName,
        args,
        actionLabel,
        onProgress: setTxState,
      });
      await refreshChainState();
    } catch (err) {
      setTxState({
        stage: "error",
        action: actionLabel,
        message: formatError(err, "Transaction failed."),
      });
    }
  }

  async function handleInspectReceipt(claimId: string) {
    if (!isValidContractAddress(contractAddress)) return;
    try {
      const receipt = await readSLAWatch<ReceiptRecord>(
        network,
        contractAddress,
        "get_receipt",
        [claimId]
      );
      if (receipt && receipt.receipt_id) {
        setSelectedReceipt(receipt);
      }
    } catch (err) {
      setChainError(err instanceof Error ? err.message : "Failed to load receipt.");
    }
  }

  async function handleLiveStatuspageInspect(urlToFetch = inspectUrl) {
    setInspectLoading(true);
    setInspectError("");
    setInspectResult(null);
    try {
      const res = await fetch(`/api/statuspage?url=${encodeURIComponent(urlToFetch)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setInspectError(data.error || "Failed to fetch live Statuspage data.");
      } else {
        setInspectResult(data as CanonicalStatuspageEvidence);
      }
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setInspectLoading(false);
    }
  }

  const verdictBadge = (verdict: string) => {
    switch (verdict) {
      case "BREACH_CONFIRMED":
      case "SETTLED":
        return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
      case "NO_BREACH":
        return "bg-sky-500/15 text-sky-300 border-sky-500/40";
      case "REVIEW_NEEDED":
      case "DISPUTED":
        return "bg-amber-500/15 text-amber-300 border-amber-500/40";
      default:
        return "bg-slate-700/50 text-slate-300 border-slate-600";
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/90 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="SLAWatch"
              className="w-10 h-10 rounded-xl border border-emerald-500/30"
            />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">SLAWatch</h1>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  GenLayer Intelligent Contract
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Trustless Cloud &amp; API Uptime SLA Adjudicator via Multi-Validator Consensus
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={network}
              onChange={(e) => setNetwork(e.target.value as NetworkKey)}
              className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-400"
            >
              {NETWORK_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={contractAddress}
              onChange={(e) => setContractAddress(e.target.value.trim())}
              placeholder="0x... Deployed SLAWatch Contract"
              className="text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 w-64 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
            />

            <button
              onClick={handleConnectWallet}
              className="inline-flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition cursor-pointer"
            >
              <Wallet className="w-3.5 h-3.5" />
              {walletAddress
                ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
                : "Connect Wallet"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {walletError && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{walletError}</span>
          </div>
        )}

        {/* Hero / Architecture Strip */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
              <Activity className="w-4 h-4" />
              Stage 1 · Strict Web Evidence
            </div>
            <p className="mt-2 text-xs text-slate-300 leading-relaxed">
              Validators independently fetch official Atlassian Statuspage v2 JSON APIs via{" "}
              <code className="text-emerald-300">gl.nondet.web.get</code>, canonicalize incidents,
              and seal a SHA-256 evidence digest under{" "}
              <code className="text-emerald-300">gl.eq_principle.strict_eq</code>.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center gap-2 text-sky-400 text-xs font-semibold uppercase tracking-wider">
              <Gavel className="w-4 h-4" />
              Stage 2 · Neutral Clause Judging
            </div>
            <p className="mt-2 text-xs text-slate-300 leading-relaxed">
              Validators evaluate plain-English SLA terms &amp; maintenance exclusions with{" "}
              <code className="text-sky-300">gl.eq_principle.prompt_non_comparative</code>,
              clamping credit tiers to registered caps and filtering hallucinated IDs.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4" />
              Fail-Closed Receipts
            </div>
            <p className="mt-2 text-xs text-slate-300 leading-relaxed">
              Unreachable APIs, invalid JSON, or ambiguous incidents fail closed to{" "}
              <code className="text-amber-300">REVIEW_NEEDED</code> (0 bps). Every ruling produces
              an immutable, once-challengeable on-chain receipt.
            </p>
          </div>
        </section>

        {/* Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex gap-2">
            {[
              { id: "workspace", label: "On-Chain Workspace", icon: Gavel },
              { id: "inspector", label: "Live Statuspage Inspector (No Wallet)", icon: Activity },
              { id: "receipts", label: "Verified Receipts & Audit Log", icon: FileCheck2 },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as ActiveTab)}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                    active
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {hasValidContract && (
            <button
              onClick={() => void refreshChainState()}
              disabled={loadingChain}
              className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingChain ? "animate-spin" : ""}`} />
              Sync Chain State
            </button>
          )}
        </div>

        {/* Transaction Lifecycle Banner */}
        {txState.stage !== "idle" && (
          <div
            className={`rounded-2xl border p-4 text-xs space-y-2 ${
              txState.stage === "error"
                ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                : txState.stage === "finalized"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-sky-500/40 bg-sky-500/10 text-sky-200"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold flex items-center gap-2">
                {txState.stage === "finalized" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : txState.stage === "error" ? (
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                ) : (
                  <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                )}
                <span>
                  {txState.action} — <span className="uppercase">{txState.stage}</span>
                </span>
              </div>
              {txState.hash && (
                <span className="font-mono text-[11px] bg-slate-950/60 px-2 py-0.5 rounded">
                  tx: {txState.hash}
                </span>
              )}
            </div>
            <p>{txState.message}</p>
            <div className="grid grid-cols-5 gap-1.5 pt-1">
              {(["preparing", "signing", "pending", "accepted", "finalized"] as const).map(
                (step, idx) => {
                  const stages = ["preparing", "signing", "pending", "accepted", "finalized"];
                  const currentIdx = stages.indexOf(txState.stage);
                  const reached = currentIdx >= idx && txState.stage !== "error";
                  return (
                    <div
                      key={step}
                      className={`text-center py-1 rounded text-[10px] font-medium uppercase ${
                        reached
                          ? "bg-emerald-500/30 text-emerald-200"
                          : "bg-slate-900/70 text-slate-500"
                      }`}
                    >
                      {step}
                    </div>
                  );
                }
              )}
            </div>
          </div>
        )}

        {/* TAB 1: ON-CHAIN WORKSPACE */}
        {activeTab === "workspace" && (
          <div className="space-y-6">
            {!hasValidContract && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-100 space-y-1.5">
                <div className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Contract Address Not Configured Yet
                </div>
                <p className="text-amber-200/90">
                  Deploy <code className="font-mono">contracts/sla_watch.py</code> on GenLayer Studio
                  or Testnet Bradbury and paste the <code className="font-mono">0x...</code> address
                  into the top bar (or set{" "}
                  <code className="font-mono">NEXT_PUBLIC_SLAWATCH_CONTRACT_ADDRESS</code>). You can
                  also test live Statuspage canonical hashing right now in the{" "}
                  <button
                    onClick={() => setActiveTab("inspector")}
                    className="underline font-semibold text-white cursor-pointer"
                  >
                    Live Statuspage Inspector
                  </button>{" "}
                  tab without a wallet.
                </p>
              </div>
            )}

            {chainError && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                {chainError}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Create Agreement Card */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-white">1. Register SLA Agreement</h2>
                  <div className="flex gap-1.5">
                    {STATUSPAGE_PRESETS.map((preset) => (
                      <button
                        key={preset.vendor}
                        type="button"
                        onClick={() => {
                          setVendorName(preset.vendor);
                          setStatuspageUrl(preset.url);
                          setSlaTerms(preset.defaultTerms);
                        }}
                        className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                      >
                        {preset.vendor}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <label className="space-y-1">
                    <span className="text-slate-400">Vendor Name</span>
                    <input
                      value={vendorName}
                      onChange={(e) => setVendorName(e.target.value)}
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">Customer Wallet (optional)</span>
                    <input
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                      placeholder="Defaults to connected wallet"
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-slate-100"
                    />
                  </label>
                </div>

                <label className="block space-y-1 text-xs">
                  <span className="text-slate-400">Authoritative Statuspage v2 JSON URL</span>
                  <input
                    value={statuspageUrl}
                    onChange={(e) => setStatuspageUrl(e.target.value)}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-slate-100"
                  />
                </label>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                  <label className="space-y-1">
                    <span className="text-slate-400">Max Impact</span>
                    <select
                      value={maxAllowedImpact}
                      onChange={(e) => setMaxAllowedImpact(e.target.value)}
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-2 text-slate-100"
                    >
                      <option value="none">none</option>
                      <option value="maintenance">maintenance</option>
                      <option value="minor">minor</option>
                      <option value="major">major</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">Max Open</span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={maxUnresolved}
                      onChange={(e) => setMaxUnresolved(Number(e.target.value))}
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-2 text-slate-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">Minor bps</span>
                    <input
                      type="number"
                      value={minorBps}
                      onChange={(e) => setMinorBps(Number(e.target.value))}
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-2 text-slate-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">Major bps</span>
                    <input
                      type="number"
                      value={majorBps}
                      onChange={(e) => setMajorBps(Number(e.target.value))}
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-2 text-slate-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-slate-400">Critical bps</span>
                    <input
                      type="number"
                      value={criticalBps}
                      onChange={(e) => setCriticalBps(Number(e.target.value))}
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2 py-2 text-slate-100"
                    />
                  </label>
                </div>

                <label className="block space-y-1 text-xs">
                  <span className="text-slate-400">Plain-English SLA Terms &amp; Exclusions</span>
                  <textarea
                    rows={3}
                    value={slaTerms}
                    onChange={(e) => setSlaTerms(e.target.value)}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-100"
                  />
                </label>

                <button
                  onClick={() =>
                    void runContractWrite(
                      "create_agreement",
                      [
                        vendorName,
                        statuspageUrl,
                        customerAddress,
                        maxAllowedImpact,
                        maxUnresolved,
                        minorBps,
                        majorBps,
                        criticalBps,
                        slaTerms,
                      ],
                      "Create SLA Agreement"
                    )
                  }
                  className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition cursor-pointer"
                >
                  Sign &amp; Register SLA Agreement On-Chain
                </button>
              </div>

              {/* Open Claim Card */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
                <h2 className="text-sm font-bold text-white">2. Open SLA Breach Claim</h2>
                <div className="space-y-3 text-xs">
                  <label className="block space-y-1">
                    <span className="text-slate-400">Agreement ID</span>
                    <input
                      value={claimAgreementId}
                      onChange={(e) => setClaimAgreementId(e.target.value)}
                      placeholder="SLA-0001"
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-slate-100"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-slate-400">Incident Window</span>
                    <input
                      value={incidentWindow}
                      onChange={(e) => setIncidentWindow(e.target.value)}
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-100"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-slate-400">Claim Summary</span>
                    <textarea
                      rows={4}
                      value={claimSummary}
                      onChange={(e) => setClaimSummary(e.target.value)}
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-100"
                    />
                  </label>
                  <button
                    onClick={() =>
                      void runContractWrite(
                        "open_claim",
                        [claimAgreementId, incidentWindow, claimSummary],
                        "Open SLA Breach Claim"
                      )
                    }
                    className="w-full py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold transition cursor-pointer"
                  >
                    Open On-Chain Breach Claim
                  </button>
                </div>

                {/* Live Agreements Summary */}
                <div className="pt-3 border-t border-slate-800 space-y-2">
                  <div className="text-xs font-semibold text-slate-300">
                    Registered Agreements ({agreements.length})
                  </div>
                  {agreements.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No on-chain agreements loaded yet. Connect to a deployed contract or create one above.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {agreements.map((a) => (
                        <div
                          key={a.agreement_id}
                          className="rounded-xl bg-slate-950/80 border border-slate-800 p-3 text-xs flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-white">
                              {a.agreement_id} · {a.vendor_name}
                            </div>
                            <div className="font-mono text-[11px] text-slate-400 truncate">
                              {a.statuspage_url}
                            </div>
                          </div>
                          <button
                            onClick={() => setClaimAgreementId(a.agreement_id)}
                            className="shrink-0 text-[11px] px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 cursor-pointer"
                          >
                            Use
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Claims Table & Actions */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-white">
                  3. Adjudicate, Challenge &amp; Settle Claims ({claims.length})
                </h2>
              </div>
              {claims.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No on-chain claims found on this contract yet. Open a claim above, then trigger
                  multi-validator adjudication.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {claims.map((c) => (
                    <div
                      key={c.claim_id}
                      className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-white">
                          {c.claim_id} ({c.agreement_id})
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${verdictBadge(
                            c.status
                          )}`}
                        >
                          {c.status}
                        </span>
                      </div>
                      <p className="text-slate-300">{c.claim_summary}</p>
                      {c.reasoning && (
                        <div className="rounded-lg bg-slate-900 p-2.5 text-slate-300 border border-slate-800">
                          <span className="text-slate-400 font-semibold">Consensus Reasoning: </span>
                          {c.reasoning}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {(c.status === "CLAIM_OPEN" || c.status === "DISPUTED") && (
                          <button
                            onClick={() =>
                              void runContractWrite(
                                "adjudicate_claim",
                                [c.claim_id],
                                `Adjudicate ${c.claim_id}`
                              )
                            }
                            className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold cursor-pointer"
                          >
                            Run Multi-Validator Adjudication
                          </button>
                        )}
                        {c.status === "BREACH_CONFIRMED" && (
                          <button
                            onClick={() =>
                              void runContractWrite(
                                "settle_claim",
                                [c.claim_id],
                                `Settle ${c.claim_id}`
                              )
                            }
                            className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold cursor-pointer"
                          >
                            Settle Credit ({(c.credit_bps / 100).toFixed(2)}%)
                          </button>
                        )}
                        {!c.challenged &&
                          ["BREACH_CONFIRMED", "NO_BREACH", "REVIEW_NEEDED"].includes(c.status) && (
                            <button
                              onClick={() =>
                                void runContractWrite(
                                  "challenge_claim",
                                  [
                                    c.claim_id,
                                    "Requesting second validator consensus pass with updated official Statuspage feed.",
                                  ],
                                  `Challenge ${c.claim_id}`
                                )
                              }
                              className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 font-semibold cursor-pointer"
                            >
                              File Challenge
                            </button>
                          )}
                        {c.evidence_digest && (
                          <button
                            onClick={() => void handleInspectReceipt(c.claim_id)}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                          >
                            View Receipt
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedReceipt && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-2 text-xs">
                  <div className="font-bold text-emerald-300">
                    On-Chain Receipt · {selectedReceipt.receipt_id}
                  </div>
                  <pre className="overflow-x-auto font-mono text-[11px] text-slate-200 bg-slate-950/90 p-3 rounded-lg">
                    {JSON.stringify(selectedReceipt, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: LIVE STATUSPAGE INSPECTOR */}
        {activeTab === "inspector" && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-5">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-white">
                Live Statuspage Pre-Flight &amp; Canonical SHA-256 Parity Inspector
              </h2>
              <p className="text-xs text-slate-400">
                Fetch real public Atlassian Statuspage v2 feeds right now (no wallet required) and
                compute the exact canonical JSON snapshot &amp; SHA-256 digest used inside{" "}
                <code className="text-emerald-300">contracts/sla_watch.py</code>.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {STATUSPAGE_PRESETS.map((preset) => (
                <button
                  key={preset.vendor}
                  onClick={() => {
                    setInspectUrl(preset.url);
                    void handleLiveStatuspageInspect(preset.url);
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                >
                  Inspect {preset.vendor} Live
                </button>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={inspectUrl}
                onChange={(e) => setInspectUrl(e.target.value)}
                className="flex-1 rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-xs font-mono text-slate-100"
              />
              <button
                onClick={() => void handleLiveStatuspageInspect()}
                disabled={inspectLoading}
                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {inspectLoading ? "Fetching Live Feed..." : "Fetch & Hash Live Evidence"}
              </button>
            </div>

            {inspectError && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                {inspectError}
              </div>
            )}

            {inspectResult && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
                    <div className="text-slate-400">Provider Page</div>
                    <div className="font-bold text-white mt-1">{inspectResult.page_name || "—"}</div>
                  </div>
                  <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
                    <div className="text-slate-400">Status Indicator</div>
                    <div className="font-bold text-emerald-300 mt-1 uppercase">
                      {inspectResult.status_indicator}
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
                    <div className="text-slate-400">Highest Impact</div>
                    <div className="font-bold text-sky-300 mt-1 uppercase">
                      {inspectResult.highest_impact}
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
                    <div className="text-slate-400">Unresolved Incidents</div>
                    <div className="font-bold text-white mt-1">
                      {inspectResult.unresolved_count}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl bg-slate-950 border border-emerald-500/30 p-3 text-xs">
                  <div className="text-slate-400 mb-1">Canonical SHA-256 Evidence Digest</div>
                  <div className="font-mono text-emerald-300 break-all">
                    {inspectResult.evidence_digest}
                  </div>
                </div>

                <pre className="rounded-xl bg-slate-950 border border-slate-800 p-4 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-80">
                  {JSON.stringify(inspectResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: VERIFIED RECEIPTS & AUDIT LOG */}
        {activeTab === "receipts" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 text-xs text-sky-100">
              <strong>Wallet-Free Reviewer Reference:</strong> The cards below illustrate all three
              adjudication outcomes produced by <code className="font-mono">SLAWatch</code> (
              <code className="font-mono">BREACH_CONFIRMED</code>,{" "}
              <code className="font-mono">NO_BREACH</code>, and fail-closed{" "}
              <code className="font-mono">REVIEW_NEEDED</code>). These reference entries are clearly
              labeled simulations separate from live chain reads in the On-Chain Workspace tab.
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {SAMPLE_VERIFIED_RECEIPTS.map((r) => (
                <div
                  key={r.receipt_id}
                  className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3 text-xs flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-white">{r.receipt_id}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${verdictBadge(
                          r.verdict
                        )}`}
                      >
                        {r.verdict}
                      </span>
                    </div>
                    <div className="font-semibold text-slate-200">{r.vendor_name}</div>
                    <p className="text-slate-400 leading-relaxed">{r.reasoning}</p>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="rounded-lg bg-slate-950 p-2 border border-slate-800">
                        <div className="text-[10px] text-slate-500 uppercase">Credit Awarded</div>
                        <div className="font-bold text-emerald-300 mt-0.5">
                          {(r.credit_bps / 100).toFixed(2)}% ({r.credit_bps} bps)
                        </div>
                      </div>
                      <div className="rounded-lg bg-slate-950 p-2 border border-slate-800">
                        <div className="text-[10px] text-slate-500 uppercase">Impact / Open</div>
                        <div className="font-bold text-slate-200 mt-0.5 uppercase">
                          {r.highest_impact} / {r.unresolved_count}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="pt-3 border-t border-slate-800 space-y-1 font-mono text-[10px] text-slate-500">
                    <div className="truncate">evidence: {r.evidence_digest}</div>
                    <div className="truncate">receipt: {r.receipt_digest}</div>
                    <a
                      href={r.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-400 hover:underline pt-1"
                    >
                      Official Statuspage Feed <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
