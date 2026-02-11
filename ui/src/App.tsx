import { useEffect, useMemo, useState } from "react";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { IDS } from "./ids";

type StatusKind = "idle" | "info" | "success" | "error";

type Status = {
  kind: StatusKind;
  message: string;
  digest?: string;
};

const MODULE = "firewall";
const MIST_PER_SUI = 1_000_000_000n;

function parseSuiToMist(input: string): bigint | null {
  const value = input.trim();
  if (!value) return null;
  if (!/^\d+(\.\d{0,9})?$/.test(value)) return null;
  const [whole, frac = ""] = value.split(".");
  const padded = (frac + "000000000").slice(0, 9);
  return BigInt(whole) * MIST_PER_SUI + BigInt(padded);
}

function shortAddress(value: string) {
  if (value.length <= 10) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function findCreatedId(result: any, suffix: string) {
  const changes = result?.objectChanges ?? [];
  const created = changes.find(
    (change: any) =>
      change?.type === "created" &&
      typeof change?.objectType === "string" &&
      change.objectType.endsWith(suffix),
  );
  return created?.objectId ?? "";
}

export default function App() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction({
    execute: ({ bytes, signature }) =>
      client.executeTransactionBlock({
        transactionBlock: bytes,
        signature,
        options: {
          showEffects: true,
          showObjectChanges: true,
          showRawEffects: true,
        },
      }),
  });

  // State for the full workflow
  const [adminId, setAdminId] = useState("");
  const [vaultId, setVaultId] = useState("");
  const [permissionId, setPermissionId] = useState("");
  const [proposalId, setProposalId] = useState("");
  const [depositSui, setDepositSui] = useState("0.1");
  const [maxAmountSui, setMaxAmountSui] = useState("0.05");
  const [totalQuotaSui, setTotalQuotaSui] = useState("0.1");
  const [expiryMinutes, setExpiryMinutes] = useState("0");
  const [recipient, setRecipient] = useState("");
  const [transferSui, setTransferSui] = useState("0.01");
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message:
      "AI Action Firewall is a Sui Move MVP that grants scoped SUI transfer permissions (per-transfer cap, total quota, expiry) via Vault and ActionProposal.",
  });

  useEffect(() => {
    if (!agent && account?.address) {
      setAgent(account.address);
    }
    if (!recipient && account?.address) {
      setRecipient(account.address);
    }
  }, [account?.address, agent, recipient]);

  const baseTarget = useMemo(() => `${IDS.packageId}::${MODULE}`, []);

  const runTransaction = (tx: Transaction, label: string) => {
    if (!account?.address) {
      setStatus({ kind: "error", message: "Please connect a wallet first." });
      return Promise.reject(new Error("No wallet connected"));
    }

    tx.setSenderIfNotSet(account.address);
    setStatus({ kind: "info", message: `Submitting ${label}...` });

    return new Promise<any>((resolve, reject) => {
      signAndExecute(
        {
          transaction: tx,
        },
        {
          onSuccess: (result) => {
            setStatus({
              kind: "success",
              message: `${label} confirmed.`,
              digest: result.digest,
            });
            resolve(result);
          },
          onError: (error) => {
            const message =
              error instanceof Error ? error.message : String(error);
            setStatus({
              kind: "error",
              message: `${label} failed: ${message}`,
            });
            reject(error);
          },
        },
      );
    });
  };

  const runAndCapture = async (
    tx: Transaction,
    label: string,
    onSuccess?: (result: any) => void,
  ) => {
    try {
      const result = await runTransaction(tx, label);
      if (onSuccess) onSuccess(result);
    } catch {
      // Status is handled inside runTransaction.
    }
  };

  const onCreateAdmin = async () => {
    const tx = new Transaction();
    tx.moveCall({
      target: `${baseTarget}::create_admin`,
      arguments: [],
    });
    await runAndCapture(tx, "Create AdminCap", (result) => {
      const created = findCreatedId(result, "::firewall::AdminCap");
      if (created) setAdminId(created);
    });
  };

  const onCreateVault = async () => {
    if (!adminId) {
      setStatus({ kind: "error", message: "AdminCap ID is required." });
      return;
    }
    const tx = new Transaction();
    tx.moveCall({
      target: `${baseTarget}::create_vault`,
      arguments: [tx.object(adminId)],
    });
    await runAndCapture(tx, "Create Vault", (result) => {
      const created = findCreatedId(result, "::firewall::Vault");
      if (created) setVaultId(created);
    });
  };

  const onDeposit = async () => {
    if (!vaultId) {
      setStatus({ kind: "error", message: "Vault ID is required." });
      return;
    }
    const amount = parseSuiToMist(depositSui);
    if (!amount || amount <= 0n) {
      setStatus({
        kind: "error",
        message: "Deposit amount must be greater than 0.",
      });
      return;
    }
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
    tx.moveCall({
      target: `${baseTarget}::deposit`,
      arguments: [tx.object(vaultId), coin],
    });
    await runAndCapture(tx, "Deposit into Vault");
  };

  const onIssuePermission = async () => {
    if (!adminId || !vaultId) {
      setStatus({
        kind: "error",
        message: "AdminCap and Vault IDs are required.",
      });
      return;
    }
    if (!agent) {
      setStatus({ kind: "error", message: "Agent address is required." });
      return;
    }
    const maxAmount = parseSuiToMist(maxAmountSui);
    if (!maxAmount || maxAmount <= 0n) {
      setStatus({
        kind: "error",
        message: "Max per transfer must be greater than 0.",
      });
      return;
    }
    const totalQuota = totalQuotaSui.trim()
      ? parseSuiToMist(totalQuotaSui)
      : 0n;
    if (totalQuota === null || totalQuota < 0n) {
      setStatus({ kind: "error", message: "Total quota is invalid." });
      return;
    }
    const minutes = Number(expiryMinutes || "0");
    const expiresAt = minutes > 0 ? BigInt(Date.now() + minutes * 60_000) : 0n;

    const tx = new Transaction();
    tx.moveCall({
      target: `${baseTarget}::issue_permission`,
      arguments: [
        tx.object(adminId),
        tx.object(vaultId),
        tx.pure.address(agent),
        tx.pure.u64(maxAmount),
        tx.pure.u64(totalQuota ?? 0n),
        tx.pure.u64(expiresAt),
      ],
    });
    await runAndCapture(tx, "Issue Permission", (result) => {
      const created = findCreatedId(result, "::firewall::Permission");
      if (created) setPermissionId(created);
    });
  };

  const onProposeTransfer = async () => {
    if (!permissionId) {
      setStatus({ kind: "error", message: "Permission ID is required." });
      return;
    }
    if (!recipient) {
      setStatus({ kind: "error", message: "Recipient address is required." });
      return;
    }
    const amount = parseSuiToMist(transferSui);
    if (!amount || amount <= 0n) {
      setStatus({
        kind: "error",
        message: "Transfer amount must be greater than 0.",
      });
      return;
    }
    const tx = new Transaction();
    tx.moveCall({
      target: `${baseTarget}::propose_transfer`,
      arguments: [
        tx.object(permissionId),
        tx.pure.address(recipient),
        tx.pure.u64(amount),
        tx.object(IDS.clockId),
      ],
    });
    await runAndCapture(tx, "Propose Transfer", (result) => {
      const created = findCreatedId(result, "::firewall::ActionProposal");
      if (created) setProposalId(created);
    });
  };

  const onExecuteTransfer = async () => {
    if (!vaultId || !permissionId || !proposalId) {
      setStatus({
        kind: "error",
        message: "Vault, Permission, and Proposal IDs are required.",
      });
      return;
    }
    const tx = new Transaction();
    tx.moveCall({
      target: `${baseTarget}::execute_transfer`,
      arguments: [
        tx.object(vaultId),
        tx.object(permissionId),
        tx.object(proposalId),
        tx.object(IDS.clockId),
      ],
    });
    await runAndCapture(tx, "Execute Transfer");
  };

  return (
    <div className="app" style={{ display: "flex", gap: 32 }}>
      <div style={{ flex: 2, minWidth: 0 }}>
        {/* Orbs removed for minimal UI */}
        {/* Orbs removed for minimal UI */}
        <header className="hero" style={{ display: "block", marginBottom: 24 }}>
          <span className="eyebrow">Sui Move MVP</span>
          <h1>AI Action Firewall Console</h1>
          <p className="lead">
            Connect your wallet, create a vault, issue permissions, and execute
            transfers through the on-chain firewall.
          </p>
          <div className="chip-row">
            <span className="chip">Network: {IDS.network}</span>
            <span className="chip">Module: firewall</span>
            <span className="chip">1 SUI = 1,000,000,000 MIST</span>
          </div>
        </header>
        <div className="status-card" style={{ marginBottom: 24 }}>
          <div className="status-title">Status</div>
          <div className="status-message">{status.message}</div>
          {status.digest && (
            <div className="status-digest">
              Digest: <code>{status.digest}</code>
            </div>
          )}
        </div>
        <div className="panel-card" style={{ padding: 32, marginBottom: 32 }}>
          <h2 style={{ marginTop: 0 }}>Workflow</h2>
          {/* Step 1: Create AdminCap */}
          <div style={{ marginBottom: 24 }}>
            <b>1. Create AdminCap</b>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                marginTop: 8,
              }}
            >
              <button
                className="btn primary"
                type="button"
                onClick={onCreateAdmin}
                disabled={isPending}
              >
                Create AdminCap
              </button>
              <input
                style={{ flex: 1 }}
                value={adminId}
                onChange={(e) => setAdminId(e.target.value)}
                placeholder="AdminCap ID"
              />
            </div>
            <span className="note">
              AdminCap allows you to create vaults and issue permissions.
            </span>
          </div>
          {/* Step 2: Create Vault */}
          <div style={{ marginBottom: 24 }}>
            <b>2. Create Vault</b>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                marginTop: 8,
              }}
            >
              <button
                className="btn primary"
                type="button"
                onClick={onCreateVault}
                disabled={isPending}
              >
                Create Vault
              </button>
              <input
                style={{ flex: 1 }}
                value={vaultId}
                onChange={(e) => setVaultId(e.target.value)}
                placeholder="Vault ID"
              />
            </div>
            <span className="note">Vault is a shared SUI storage object.</span>
          </div>
          {/* Step 3: Fund Vault */}
          <div style={{ marginBottom: 24 }}>
            <b>3. Fund Vault</b>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                marginTop: 8,
              }}
            >
              <input
                style={{ width: 120 }}
                value={depositSui}
                onChange={(e) => setDepositSui(e.target.value)}
                placeholder="Deposit SUI"
              />
              <button
                className="btn primary"
                type="button"
                onClick={onDeposit}
                disabled={isPending}
              >
                Deposit SUI
              </button>
            </div>
            <span className="note">Deposit SUI into the vault (SUI unit).</span>
          </div>
          {/* Step 4: Issue Permission */}
          <div style={{ marginBottom: 24 }}>
            <b>4. Issue Permission</b>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                marginTop: 8,
                flexWrap: "wrap",
              }}
            >
              <input
                style={{ flex: 1, minWidth: 120 }}
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                placeholder="Agent address"
              />
              <input
                style={{ width: 120 }}
                value={maxAmountSui}
                onChange={(e) => setMaxAmountSui(e.target.value)}
                placeholder="Max/transfer"
              />
              <input
                style={{ width: 120 }}
                value={totalQuotaSui}
                onChange={(e) => setTotalQuotaSui(e.target.value)}
                placeholder="Total quota"
              />
              <input
                style={{ width: 120 }}
                value={expiryMinutes}
                onChange={(e) => setExpiryMinutes(e.target.value)}
                placeholder="Expiry (min)"
              />
              <button
                className="btn primary"
                type="button"
                onClick={onIssuePermission}
                disabled={isPending}
              >
                Issue Permission
              </button>
            </div>
            <input
              style={{ marginTop: 8, width: "100%" }}
              value={permissionId}
              onChange={(e) => setPermissionId(e.target.value)}
              placeholder="Permission ID"
            />
            <span className="note">Limit, quota, expiry (0 = unlimited).</span>
          </div>
          {/* Step 5: Propose Transfer */}
          <div style={{ marginBottom: 24 }}>
            <b>5. Propose Transfer</b>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                marginTop: 8,
                flexWrap: "wrap",
              }}
            >
              <input
                style={{ flex: 1, minWidth: 120 }}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Recipient address"
              />
              <input
                style={{ width: 120 }}
                value={transferSui}
                onChange={(e) => setTransferSui(e.target.value)}
                placeholder="Amount SUI"
              />
              <button
                className="btn primary"
                type="button"
                onClick={onProposeTransfer}
                disabled={isPending}
              >
                Propose
              </button>
            </div>
            <input
              style={{ marginTop: 8, width: "100%" }}
              value={proposalId}
              onChange={(e) => setProposalId(e.target.value)}
              placeholder="Proposal ID"
            />
            <span className="note">
              Agent creates a proposal before execution.
            </span>
          </div>
          {/* Step 6: Execute Transfer */}
          <div style={{ marginBottom: 0 }}>
            <b>6. Execute Transfer</b>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                marginTop: 8,
                flexWrap: "wrap",
              }}
            >
              <button
                className="btn primary"
                type="button"
                onClick={onExecuteTransfer}
                disabled={isPending}
              >
                Execute
              </button>
              <input
                style={{ flex: 1, minWidth: 120 }}
                value={vaultId}
                onChange={(e) => setVaultId(e.target.value)}
                placeholder="Vault ID"
              />
              <input
                style={{ flex: 1, minWidth: 120 }}
                value={permissionId}
                onChange={(e) => setPermissionId(e.target.value)}
                placeholder="Permission ID"
              />
              <input
                style={{ flex: 1, minWidth: 120 }}
                value={proposalId}
                onChange={(e) => setProposalId(e.target.value)}
                placeholder="Proposal ID"
              />
            </div>
            <span className="note">Execute the proposal if valid.</span>
          </div>
        </div>
      </div>
      {/* Right sidebar: wallet and object info */}
      <aside style={{ flex: 1, minWidth: 320, maxWidth: 400 }}>
        <div className="panel-card" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <span className="pill">Wallet</span>
            <span className="pill ghost">
              {account?.address ? "Connected" : "Disconnected"}
            </span>
          </div>
          <ConnectButton />
          <div className="keyline">
            <span>Address</span>
            <code className="mono">{account?.address ?? "Not connected"}</code>
          </div>
          <div className="keyline">
            <span>Package</span>
            <code className="mono">{IDS.packageId}</code>
          </div>
          <div className="keyline">
            <span>Clock</span>
            <code className="mono">{IDS.clockId}</code>
          </div>
        </div>
        <div className="status-card neutral">
          <div className="status-title">Objects</div>
          <div className="status-grid">
            <div>
              <span>AdminCap</span>
              <code>{adminId ? shortAddress(adminId) : "—"}</code>
            </div>
            <div>
              <span>Vault</span>
              <code>{vaultId ? shortAddress(vaultId) : "—"}</code>
            </div>
            <div>
              <span>Permission</span>
              <code>{permissionId ? shortAddress(permissionId) : "—"}</code>
            </div>
            <div>
              <span>Proposal</span>
              <code>{proposalId ? shortAddress(proposalId) : "—"}</code>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
