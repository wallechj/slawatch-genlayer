import { createClient } from "genlayer-js";
import * as GenLayerChains from "genlayer-js/chains";
import { TransactionHashVariant, TransactionStatus } from "genlayer-js/types";

export type NetworkKey = "studionet" | "testnetBradbury";

export type TxStage =
  | "idle"
  | "preparing"
  | "signing"
  | "pending"
  | "accepted"
  | "finalized"
  | "error";

export interface TxLifecycleState {
  stage: TxStage;
  action: string;
  hash?: string;
  message: string;
  receipt?: unknown;
}

export interface NetworkOption {
  key: NetworkKey;
  label: string;
  rpcHint: string;
  explorerBase: string;
}

export const NETWORK_OPTIONS: NetworkOption[] = [
  {
    key: "studionet",
    label: "GenLayer StudioNet",
    rpcHint: "https://studio.genlayer.com/api",
    explorerBase: "https://studio.genlayer.com",
  },
  {
    key: "testnetBradbury",
    label: "Testnet Bradbury",
    rpcHint: "GenLayer Bradbury Testnet",
    explorerBase: "https://explorer-bradbury.genlayer.com",
  },
];

function resolveChain(network: NetworkKey) {
  const chainsRecord = GenLayerChains as Record<string, unknown>;
  if (network === "testnetBradbury" && chainsRecord.testnetBradbury) {
    return chainsRecord.testnetBradbury as typeof GenLayerChains.studionet;
  }
  return GenLayerChains.studionet;
}

export function getEthereumProvider(): {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
} | null {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: unknown }).ethereum;
  if (!eth || typeof eth !== "object" || !("request" in eth)) return null;
  return eth as {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  };
}

export async function connectWallet(): Promise<`0x${string}`> {
  const provider = getEthereumProvider();
  if (!provider) {
    throw new Error("No EVM wallet detected. Install MetaMask, Rabby, or OKX Wallet.");
  }
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  if (!accounts || accounts.length === 0) {
    throw new Error("No account authorized by wallet.");
  }
  return accounts[0] as `0x${string}`;
}

export function getReadClient(network: NetworkKey) {
  return createClient({
    chain: resolveChain(network),
  });
}

export function getWriteClient(network: NetworkKey, account: `0x${string}`) {
  return createClient({
    chain: resolveChain(network),
    account,
  });
}

export function isValidContractAddress(address: string): address is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(address.trim());
}

export async function readSLAWatch<T>(
  network: NetworkKey,
  contractAddress: `0x${string}`,
  functionName: string,
  args: unknown[] = []
): Promise<T> {
  const client = getReadClient(network);
  const result = await client.readContract({
    address: contractAddress,
    functionName,
    args: args as never[],
    transactionHashVariant: TransactionHashVariant.LATEST_NONFINAL,
  });
  return result as T;
}

export async function writeSLAWatch(params: {
  network: NetworkKey;
  contractAddress: `0x${string}`;
  account: `0x${string}`;
  functionName: string;
  args: unknown[];
  actionLabel: string;
  onProgress: (state: TxLifecycleState) => void;
}): Promise<{ hash: `0x${string}`; receipt: unknown }> {
  const { network, contractAddress, account, functionName, args, actionLabel, onProgress } = params;

  onProgress({
    stage: "preparing",
    action: actionLabel,
    message: `Preparing ${functionName}() payload for ${network}...`,
  });

  const client = getWriteClient(network, account);

  let fees: { distribution: unknown; feeValue: bigint } | undefined;
  try {
    const est = await client.estimateTransactionFees();
    fees = { distribution: est.distribution, feeValue: est.feeValue };
  } catch {
    fees = undefined;
  }

  onProgress({
    stage: "signing",
    action: actionLabel,
    message: "Waiting for wallet signature confirmation...",
  });

  const txHash = await client.writeContract({
    address: contractAddress,
    functionName,
    args: args as never[],
    value: BigInt(0),
    ...(fees ? { fees: fees as never } : {}),
  });

  onProgress({
    stage: "pending",
    action: actionLabel,
    hash: txHash,
    message: "Transaction broadcast. Waiting for GenLayer validator consensus (ACCEPTED)...",
  });

  const acceptedReceipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.ACCEPTED,
    retries: 60,
    interval: 4000,
  });

  onProgress({
    stage: "accepted",
    action: actionLabel,
    hash: txHash,
    receipt: acceptedReceipt,
    message: "Validator consensus ACCEPTED. Polling for FINALIZED state...",
  });

  try {
    const finalizedReceipt = await client.waitForTransactionReceipt({
      hash: txHash,
      status: TransactionStatus.FINALIZED,
      retries: 30,
      interval: 4000,
    });
    onProgress({
      stage: "finalized",
      action: actionLabel,
      hash: txHash,
      receipt: finalizedReceipt,
      message: "Transaction FINALIZED on GenLayer.",
    });
    return { hash: txHash, receipt: finalizedReceipt };
  } catch {
    onProgress({
      stage: "accepted",
      action: actionLabel,
      hash: txHash,
      receipt: acceptedReceipt,
      message: "Consensus ACCEPTED (finalization continues asynchronously).",
    });
    return { hash: txHash, receipt: acceptedReceipt };
  }
}
