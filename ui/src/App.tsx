import { useEffect, useMemo, useState } from "react";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { IDS } from "./ids";
import { 
  Menu, 
  X, 
  Shield, 
  Lock, 
  Zap, 
  Terminal, 
  Layers, 
  Trash2, 
  Wallet,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  ChevronDown
} from "lucide-react";

type StatusKind = "idle" | "info" | "success" | "error";

type Status = {
  kind: StatusKind;
  message: string;
  digest?: string;
};

type Toast = {
  kind: StatusKind;
  message: string;
  digest?: string;
};

const MODULE = "firewall";
const MIST_PER_SUI = 1_000_000_000n;
const STORAGE_PREFIX = `firewall:${IDS.network}:${IDS.packageId}:`;

const FIREWALL_ERROR_MESSAGES: Record<number, string> = {
  0: "Only the authorized agent can perform this action.",
  1: "This permission has been revoked by the admin.",
  2: "This permission has expired. Issue a new permission.",
  3: "Transfer amount exceeds the max per transfer.",
  4: "This proposal has already been executed.",
  5: "The permission does not match the proposal.",
  6: "The vault does not match the permission or proposal.",
  7: "Total quota exceeded for this permission.",
};

function isFirewallAbort(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("::firewall") ||
    lower.includes('identifier("firewall")') ||
    lower.includes(IDS.packageId.toLowerCase())
  );
}

function extractAbortCode(message: string): number | null {
  const moveAbortMatch = message.match(/MoveAbort\([\s\S]*?,\s*(\d+)\)/);
  if (moveAbortMatch?.[1]) return Number(moveAbortMatch[1]);
  const abortCodeMatch = message.match(/abort_code\s*[:=]?\s*(\d+)/i);
  if (abortCodeMatch?.[1]) return Number(abortCodeMatch[1]);
  const fallbackMatch = message.match(/Abort code:\s*(\d+)/i);
  if (fallbackMatch?.[1]) return Number(fallbackMatch[1]);
  return null;
}

function toFriendlyError(message: string): string | null {
  if (!isFirewallAbort(message)) return null;
  const code = extractAbortCode(message);
  if (code === null) return null;
  return FIREWALL_ERROR_MESSAGES[code] ?? null;
}

function readStored(key: string) {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${key}`) ?? "";
  } catch {
    return "";
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);
  } catch {
    // ignore storage failures
  }
}

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

  // Top level view switcher
  const [activeView, setActiveView] = useState<"landing" | "console">("landing");

  // Mobile navigation
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // FAQ state
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // Firewall state for the full workflow
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
  
  // Console logs
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  
  const [status, setStatus] = useState<Status>({
    kind: "idle",
    message: "Ready to load firewall interface.",
  });
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    setAdminId(readStored("adminId"));
    setVaultId(readStored("vaultId"));
    setPermissionId(readStored("permissionId"));
    setProposalId(readStored("proposalId"));
    setAgent(readStored("agent"));
    setRecipient(readStored("recipient"));
    
    addLog("System initialized.");
    addLog(`Network: ${IDS.network}`);
    addLog(`Package: ${shortAddress(IDS.packageId)}`);
  }, []);

  useEffect(() => {
    if (!agent && account?.address) {
      setAgent(account.address);
    }
    if (!recipient && account?.address) {
      setRecipient(account.address);
    }
  }, [account?.address, agent, recipient]);

  useEffect(() => {
    if (status.kind !== "error") return;
    setToast({
      kind: status.kind,
      message: status.message,
      digest: status.digest,
    });
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => { writeStored("adminId", adminId); }, [adminId]);
  useEffect(() => { writeStored("vaultId", vaultId); }, [vaultId]);
  useEffect(() => { writeStored("permissionId", permissionId); }, [permissionId]);
  useEffect(() => { writeStored("proposalId", proposalId); }, [proposalId]);
  useEffect(() => { writeStored("agent", agent); }, [agent]);
  useEffect(() => { writeStored("recipient", recipient); }, [recipient]);

  const baseTarget = useMemo(() => `${IDS.packageId}::${MODULE}`, []);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setConsoleLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 49)]);
  };

  const clearRegistry = () => {
    setAdminId("");
    setVaultId("");
    setPermissionId("");
    setProposalId("");
    addLog("Registry cleared.");
  };

  const runTransaction = (tx: Transaction, label: string) => {
    if (!account?.address) {
      setStatus({ kind: "error", message: "Please connect a wallet first." });
      addLog(`Error: ${label} failed - Wallet disconnected.`);
      return Promise.reject(new Error("No wallet connected"));
    }

    tx.setSenderIfNotSet(account.address);
    setStatus({ kind: "info", message: `Submitting ${label}...` });
    addLog(`Submitting transaction: ${label}`);

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
            addLog(`Success: ${label} confirmed. Digest: ${shortAddress(result.digest)}`);
            resolve(result);
          },
          onError: (error) => {
            const message =
              error instanceof Error ? error.message : String(error);
            const friendly = toFriendlyError(message);
            setStatus({
              kind: "error",
              message: `${label} failed: ${friendly ?? message}`,
            });
            addLog(`Error: ${label} failed. ${friendly ?? message}`);
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
      // Status & Log are handled inside runTransaction.
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
      if (created) {
        setAdminId(created);
        addLog(`AdminCap created: ${shortAddress(created)}`);
      }
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
      if (created) {
        setVaultId(created);
        addLog(`Vault created: ${shortAddress(created)}`);
      }
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
    await runAndCapture(tx, `Deposit ${depositSui} SUI into Vault`);
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
      if (created) {
        setPermissionId(created);
        addLog(`Permission issued: ${shortAddress(created)} to agent ${shortAddress(agent)}`);
      }
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
    await runAndCapture(tx, `Propose Transfer of ${transferSui} SUI`, (result) => {
      const created = findCreatedId(result, "::firewall::ActionProposal");
      if (created) {
        setProposalId(created);
        addLog(`Action proposal created: ${shortAddress(created)}`);
      }
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

  // Switcher top bar
  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans transition-colors duration-200">
      
      {/* GLOBAL VIEW CONTROLLER */}
      <div className="bg-slate-900 text-slate-300 text-xs px-4 py-2.5 flex justify-between items-center z-50 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-450 animate-pulse"></span>
          <span className="font-semibold text-slate-100 uppercase tracking-wider">SkyElite Guard Console</span>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setActiveView("landing")}
            className={`px-3 py-1 rounded transition-colors ${activeView === "landing" ? "bg-cyan-500 text-slate-950 font-bold" : "hover:bg-slate-800 text-slate-300"}`}
          >
            🌐 Portal Home
          </button>
          <button 
            onClick={() => setActiveView("console")}
            className={`px-3 py-1 rounded transition-colors ${activeView === "console" ? "bg-cyan-500 text-slate-950 font-bold" : "hover:bg-slate-800 text-slate-300"}`}
          >
            🛡️ Live dApp Console
          </button>
        </div>
      </div>

      {/* VIEW 1: PREMIUM COMPREHENSIVE CYBERSECURITY LANDING PAGE */}
      {activeView === "landing" && (
        <div className="flex-1 flex flex-col bg-slate-950">
          
          {/* HERO SECTION */}
          <section className="relative min-h-[90vh] md:h-screen overflow-hidden flex flex-col">
            {/* Generated Cybersecurity background image */}
            <img
              className="absolute inset-0 w-full h-full object-cover z-0"
              src="/firewall_bg.png"
              alt="Cybersecurity Firewall Node"
            />
            
            {/* Elegant dark gradient scrim (increased opacity for readability) */}
            <div className="absolute inset-0 bg-slate-950/80 z-10" />

            <div className="relative z-20 flex-1 flex flex-col">
              
              {/* Header Navigation */}
              <nav className="w-full max-w-7xl mx-auto px-6 md:px-8 py-6 flex justify-between items-center">
                <a href="#" className="text-xl md:text-2xl font-bold text-white tracking-tight hover:text-cyan-400 transition-colors duration-200">
                  SkyElite
                </a>

                {/* Desktop Menu */}
                <div className="hidden md:flex items-center gap-8">
                  {["Start", "Story", "Rates", "Benefits", "FAQ"].map((item) => (
                    <a
                      key={item}
                      href={`#${item.toLowerCase()}`}
                      className="text-slate-300 font-medium hover:text-cyan-400 transition-colors duration-200"
                    >
                      {item}
                    </a>
                  ))}
                </div>

                {/* Mobile Menu Button */}
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="md:hidden text-white focus:outline-none p-1 transition-colors duration-200"
                  aria-label="Toggle menu"
                >
                  {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                </button>

                {/* Mobile Menu Dropdown */}
                {mobileMenuOpen && (
                  <div className="absolute top-20 left-4 right-4 md:hidden bg-slate-900/95 backdrop-blur-md rounded-2xl p-6 shadow-xl border border-slate-800 flex flex-col gap-4 z-50">
                    {["Start", "Story", "Rates", "Benefits", "FAQ"].map((item) => (
                      <a
                        key={item}
                        href={`#${item.toLowerCase()}`}
                        onClick={() => setMobileMenuOpen(false)}
                        className="text-lg font-medium text-slate-100 hover:text-cyan-400 py-2 border-b border-slate-800/60 transition-colors duration-200"
                      >
                        {item}
                      </a>
                    ))}
                  </div>
                )}
              </nav>

              {/* Central Hero Content */}
              <div className="flex-1 flex items-center justify-center py-20 md:py-0">
                <div className="text-center px-4 md:-mt-32 flex flex-col items-center">
                  <span className="text-xs md:text-sm font-bold text-cyan-400 tracking-wider mb-4 uppercase">
                    AI AGENT FIREWALL
                  </span>
                  
                  {/* Large overlapping typography */}
                  <h1 className="flex flex-col items-center select-none">
                    <span className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-normal text-slate-300 leading-none tracking-tighter">
                      Premium.
                    </span>
                    <span 
                      className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold leading-none tracking-tighter"
                      style={{ color: "#22d3ee", marginTop: "-8px" }}
                    >
                      Accessible.
                    </span>
                  </h1>

                  <p className="text-base md:text-lg text-slate-400 mt-6 mb-8 max-w-xl font-light leading-relaxed">
                    Your autonomous agents deserve security you can trust. Keep SUI assets safe using on-chain policy filters.
                  </p>

                  <div className="flex items-center gap-4">
                    <a href="#story" className="px-5 py-2.5 rounded-full bg-slate-800 text-slate-200 font-medium hover:bg-slate-700 active:scale-95 transition-all duration-200 text-sm">
                      Discover
                    </a>
                    <button 
                      onClick={() => setActiveView("console")}
                      className="px-5 py-2.5 rounded-full text-slate-950 font-bold bg-cyan-500 hover:bg-cyan-400 active:scale-95 transition-all duration-200 text-sm"
                    >
                      Launch Console
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* START SECTION */}
          <section id="start" className="bg-slate-950 py-20 border-b border-slate-900">
            <div className="max-w-7xl mx-auto px-6 md:px-8">
              <div className="text-center max-w-3xl mx-auto mb-16">
                <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight mb-4">Protecting Agents In 4 Steps</h2>
                <p className="text-slate-400 text-sm md:text-base">Route your AI agent operations through a secure Move-based permission gateway.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
                {[
                  { step: "01", title: "Deploy Admin Cap", desc: "Acquire the master permissioning authority." },
                  { step: "02", title: "Create Vault", desc: "Launch shared, decentralized token storage." },
                  { step: "03", title: "Configure Scope", desc: "Issue restricted spending allowances to agent keys." },
                  { step: "04", title: "Execute Actions", desc: "Agents request and verify transfers on-chain." }
                ].map((item, i) => (
                  <div key={i} className="bg-slate-900/40 border border-slate-900 p-6 rounded-2xl relative">
                    <span className="text-3xl font-bold text-slate-800 block mb-4">{item.step}</span>
                    <h3 className="text-base font-semibold text-slate-100 mb-2">{item.title}</h3>
                    <p className="text-xs md:text-sm text-slate-400 leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* STORY SECTION */}
          <section id="story" className="bg-slate-900/20 py-20 border-b border-slate-900">
            <div className="max-w-5xl mx-auto px-6 md:px-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
                <div>
                  <span className="text-xs font-bold text-cyan-400 uppercase tracking-widest block mb-3">The Security Story</span>
                  <h2 className="text-2xl md:text-3xl font-bold text-white leading-tight mb-6">
                    Autonomous agents need structured guardrails, not blank checks.
                  </h2>
                  <p className="text-sm md:text-base text-slate-400 mb-4 leading-relaxed">
                    AI agents operating directly with private keys present a massive security vulnerability. A compromised key or anomalous logic can lead to total asset depletion.
                  </p>
                  <p className="text-sm md:text-base text-slate-400 leading-relaxed">
                    SkyElite Guard bridges the gap between trustless automation and corporate liability, routing all agent actions through a strictly permissioned Move firewall.
                  </p>
                </div>
                <div className="bg-slate-900/80 rounded-2xl p-6 shadow-xl border border-slate-800 overflow-hidden">
                  <div className="flex gap-1.5 mb-4">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-500"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span>
                  </div>
                  <pre className="text-cyan-400 font-mono text-[10px] md:text-xs leading-relaxed overflow-x-auto">
{`// Firewall Protection Layer
assert!(!permission.revoked, E_REVOKED);
assert!(proposal.amount <= max_amount, E_AMOUNT);
if (permission.max_total != 0) {
    assert!(max_total >= spent_total, E_QUOTA);
};`}
                  </pre>
                </div>
              </div>
            </div>
          </section>

          {/* RATES & SPECIFICATIONS SECTION */}
          <section id="rates" className="bg-slate-950 py-20 border-b border-slate-900">
            <div className="max-w-7xl mx-auto px-6 md:px-8">
              <div className="text-center max-w-3xl mx-auto mb-16">
                <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight mb-4">Firewall Configuration Rules</h2>
                <p className="text-slate-400 text-sm md:text-base">Calibrate spending limits, budgets, and operational timeframes dynamically.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                {[
                  { title: "Single Transfer Cap", value: "Custom Limit Control", desc: "Enforces hard boundaries per operation, stopping single massive drains." },
                  { title: "Budget Quota Limit", value: "Dynamic Allowances", desc: "Limits the cumulative sum an agent can spend over its life." },
                  { title: "Clock Temporal Windows", value: "Sui Time Accuracy", desc: "Automated permission decay. Revokes agent authority when clock expires." }
                ].map((item, i) => (
                  <div key={i} className="bg-slate-900/30 border border-slate-900 p-8 rounded-2xl hover:border-slate-800 transition-colors">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{item.title}</h3>
                    <div className="text-xl font-bold text-cyan-400 mb-4">{item.value}</div>
                    <p className="text-xs md:text-sm text-slate-400 leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* BENEFITS SECTION */}
          <section id="benefits" className="bg-slate-900/20 py-20 border-b border-slate-900">
            <div className="max-w-7xl mx-auto px-6 md:px-8">
              <div className="text-center max-w-3xl mx-auto mb-16">
                <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight mb-4">Engineered For Agent Safety</h2>
                <p className="text-slate-400 text-sm md:text-base">Why enterprise teams run autonomous operations using Sui Move firewalls.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  { icon: <Lock className="text-cyan-400" size={20} />, title: "Zero Seed Leakage", desc: "Agent software runs with low-privileged keys, keeping main capital storage isolated." },
                  { icon: <Shield className="text-cyan-400" size={20} />, title: "Admin Revocation", desc: "Emergency brake capability allows immediate blacklisting of rogue agent keys." },
                  { icon: <CheckCircle className="text-cyan-400" size={20} />, title: "Double-Verification", desc: "Requires independent Proposals, creating cryptographically auditable trails." }
                ].map((item, i) => (
                  <div key={i} className="bg-slate-900/50 p-6 rounded-2xl border border-slate-900 flex gap-4">
                    <div className="p-3 bg-slate-950 rounded-xl h-fit border border-slate-900">{item.icon}</div>
                    <div>
                      <h3 className="text-base font-semibold text-slate-100 mb-2">{item.title}</h3>
                      <p className="text-xs md:text-sm text-slate-450 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* FAQ SECTION */}
          <section id="faq" className="bg-slate-950 py-20">
            <div className="max-w-4xl mx-auto px-6 md:px-8">
              <div className="text-center max-w-3xl mx-auto mb-16">
                <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight mb-4">Frequently Asked Questions</h2>
                <p className="text-slate-400 text-sm md:text-base">Everything you need to know about the AI Action Firewall.</p>
              </div>
              <div className="space-y-4">
                {[
                  { q: "How does the agent execute a transfer?", a: "The agent generates an ActionProposal containing the recipient and amount. The firewall then checks this proposal against the agent's active Permission object and Vault balance on-chain, validating constraints before executing SUI transfer." },
                  { q: "What happens when the permission expires?", a: "Sui's on-chain Clock module verifies the timestamp. If the current time exceeds expires_at_ms, the execute_transfer call instantly aborts." },
                  { q: "Can the admin reclaim vault funds?", a: "Yes, the Vault admin retains master ownership control, enabling them to withdraw capital or adjust permissions at any time." },
                  { q: "Is this safe for multi-agent teams?", a: "Absolutely. The admin cap can issue multiple discrete Permission tokens to different agent addresses, separating and modularizing budgets." }
                ].map((item, i) => (
                  <div key={i} className="border border-slate-900 rounded-xl overflow-hidden">
                    <button
                      onClick={() => toggleFaq(i)}
                      className="w-full text-left px-6 py-4 bg-slate-900/30 hover:bg-slate-900/50 transition-colors flex justify-between items-center font-medium text-slate-200"
                    >
                      <span className="text-sm md:text-base">{item.q}</span>
                      <ChevronDown className={`transform transition-transform duration-200 text-slate-450 ${openFaq === i ? "rotate-180" : ""}`} size={16} />
                    </button>
                    {openFaq === i && (
                      <div className="px-6 py-4 text-xs md:text-sm text-slate-400 border-t border-slate-900 bg-slate-900/10 leading-relaxed">
                        {item.a}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

        </div>
      )}

      {/* VIEW 2: INTERACTIVE FIREWALL DAPP CONSOLE */}
      {activeView === "console" && (
        <div className="bg-slate-950 text-slate-100 flex-1 flex flex-col">
          {/* Header */}
          <header className="max-w-7xl mx-auto w-full px-8 py-6 flex justify-between items-center border-b border-slate-900">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.6)]" />
              <span className="font-bold text-lg text-slate-100">Firewall Console</span>
            </div>
            <div className="flex items-center gap-4">
              <ConnectButton />
            </div>
          </header>

          <main className="max-w-7xl mx-auto px-8 py-8 w-full grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1">
            
            {/* Toast Warning inside console */}
            {toast && (
              <div className="lg:col-span-3 bg-red-950/20 border border-red-800/40 rounded-xl p-4 flex justify-between items-center text-red-400 text-sm">
                <div className="flex items-center gap-2">
                  <AlertCircle size={18} />
                  <span>{toast.message}</span>
                </div>
                <button onClick={() => setToast(null)} className="text-red-300 hover:text-red-100 font-bold">Dismiss</button>
              </div>
            )}

            {/* Left Col: Actions */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* Status Alert Banner */}
              {status.kind !== "idle" && (
                <div className={`p-4 rounded-xl border flex flex-col gap-2 ${
                  status.kind === "info" ? "bg-cyan-950/20 border-cyan-800/40 text-cyan-400" :
                  status.kind === "success" ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-400" :
                  "bg-red-950/20 border-red-800/40 text-red-400"
                }`}>
                  <div className="font-semibold flex items-center gap-2">
                    {status.kind === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {status.message}
                  </div>
                  {status.digest && (
                    <a 
                      href={`https://suiscan.xyz/testnet/tx/${status.digest}`} 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-xs underline flex items-center gap-1 hover:text-white"
                    >
                      View on Suiscan <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              )}

              {/* 1. Infrastructure */}
              <div className="bg-slate-900/30 border border-slate-900 rounded-2xl p-6">
                <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-6 border-b border-slate-900 pb-3">
                  <Shield className="text-cyan-400" size={18} /> 1. Firewall Infrastructure
                </h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Admin Control Cap</label>
                    <div className="flex gap-3">
                      <input
                        value={adminId}
                        onChange={(e) => setAdminId(e.target.value)}
                        placeholder="AdminCap Object ID"
                        className="flex-1 bg-slate-950 border border-slate-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-slate-100"
                      />
                      <button 
                        onClick={onCreateAdmin} 
                        disabled={isPending}
                        className="bg-cyan-500 text-slate-950 font-semibold px-4 py-2.5 rounded-lg hover:bg-cyan-400 active:scale-95 transition-all text-sm shrink-0"
                      >
                        Create AdminCap
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Shared Balance Vault</label>
                    <div className="flex gap-3">
                      <input
                        value={vaultId}
                        onChange={(e) => setVaultId(e.target.value)}
                        placeholder="Vault Object ID"
                        className="flex-1 bg-slate-950 border border-slate-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-slate-100"
                      />
                      <button 
                        onClick={onCreateVault} 
                        disabled={!adminId || isPending}
                        className="bg-slate-850 border border-slate-800 text-slate-100 font-semibold px-4 py-2.5 rounded-lg hover:bg-slate-800 hover:border-slate-700 active:scale-95 transition-all text-sm shrink-0"
                      >
                        Create Vault
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Fund Vault (SUI)</label>
                    <div className="flex gap-3">
                      <input
                        type="number"
                        step="0.01"
                        value={depositSui}
                        onChange={(e) => setDepositSui(e.target.value)}
                        placeholder="0.1"
                        className="flex-1 bg-slate-950 border border-slate-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-slate-100"
                      />
                      <button 
                        onClick={onDeposit} 
                        disabled={!vaultId || isPending}
                        className="bg-slate-850 border border-slate-800 text-slate-100 font-semibold px-4 py-2.5 rounded-lg hover:bg-slate-800 hover:border-slate-700 active:scale-95 transition-all text-sm shrink-0"
                      >
                        Deposit SUI
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Access Control */}
              <div className="bg-slate-900/30 border border-slate-900 rounded-2xl p-6">
                <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-6 border-b border-slate-900 pb-3">
                  <Lock className="text-cyan-400" size={18} /> 2. Agent Access Control
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Agent Address</label>
                    <div className="flex gap-3">
                      <input
                        value={agent}
                        onChange={(e) => setAgent(e.target.value)}
                        placeholder="0x..."
                        className="flex-1 bg-slate-950 border border-slate-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-slate-100"
                      />
                      <button 
                        onClick={() => setAgent(account?.address ?? "")} 
                        disabled={!account?.address}
                        className="bg-slate-850 border border-slate-800 text-slate-100 font-semibold px-4 py-2.5 rounded-lg hover:bg-slate-800 hover:border-slate-700 active:scale-95 transition-all text-sm shrink-0"
                      >
                        Use Wallet
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Max Per Transfer (SUI)</label>
                      <input
                        value={maxAmountSui}
                        onChange={(e) => setMaxAmountSui(e.target.value)}
                        placeholder="0.05"
                        className="w-full bg-slate-950 border border-slate-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Total Limit Quota (SUI)</label>
                      <input
                        value={totalQuotaSui}
                        onChange={(e) => setTotalQuotaSui(e.target.value)}
                        placeholder="0.1"
                        className="w-full bg-slate-950 border border-slate-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Expiry Window (mins)</label>
                      <input
                        value={expiryMinutes}
                        onChange={(e) => setExpiryMinutes(e.target.value)}
                        placeholder="0 (Unlimited)"
                        className="w-full bg-slate-950 border border-slate-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="pt-2">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Permission ID</label>
                    <div className="flex gap-3">
                      <input
                        value={permissionId}
                        onChange={(e) => setPermissionId(e.target.value)}
                        placeholder="Permission Object ID"
                        className="flex-1 bg-slate-950 border border-slate-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-slate-100"
                      />
                      <button 
                        onClick={onIssuePermission} 
                        disabled={!adminId || !vaultId || !agent || isPending}
                        className="bg-cyan-500 text-slate-950 font-semibold px-4 py-2.5 rounded-lg hover:bg-cyan-400 active:scale-95 transition-all text-sm shrink-0"
                      >
                        Issue Permission
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Operations Pipeline */}
              <div className="bg-slate-900/30 border border-slate-900 rounded-2xl p-6">
                <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-6 border-b border-slate-900 pb-3">
                  <Zap className="text-cyan-400" size={18} /> 3. Operations Pipeline
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Recipient Address</label>
                    <div className="flex gap-3">
                      <input
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        placeholder="0x..."
                        className="flex-1 bg-slate-950 border border-slate-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-slate-100"
                      />
                      <button 
                        onClick={() => setRecipient(account?.address ?? "")} 
                        disabled={!account?.address}
                        className="bg-slate-850 border border-slate-800 text-slate-100 font-semibold px-4 py-2.5 rounded-lg hover:bg-slate-800 hover:border-slate-700 active:scale-95 transition-all text-sm shrink-0"
                      >
                        Use Wallet
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Transfer Amount (SUI)</label>
                    <input
                      value={transferSui}
                      onChange={(e) => setTransferSui(e.target.value)}
                      placeholder="0.01"
                      className="w-full bg-slate-950 border border-slate-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Proposal ID</label>
                    <div className="flex gap-3">
                      <input
                        value={proposalId}
                        onChange={(e) => setProposalId(e.target.value)}
                        placeholder="Proposal Object ID"
                        className="flex-1 bg-slate-950 border border-slate-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-slate-100"
                      />
                      <button 
                        onClick={onProposeTransfer} 
                        disabled={!permissionId || !recipient || isPending}
                        className="bg-slate-850 border border-slate-800 text-slate-100 font-semibold px-4 py-2.5 rounded-lg hover:bg-slate-800 hover:border-slate-700 active:scale-95 transition-all text-sm shrink-0"
                      >
                        Propose Action
                      </button>
                    </div>
                  </div>

                  <div className="pt-4">
                    <button
                      onClick={onExecuteTransfer}
                      disabled={!vaultId || !permissionId || !proposalId || isPending}
                      className="w-full bg-cyan-500 text-slate-950 font-bold py-3 rounded-lg hover:bg-cyan-400 active:scale-95 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Execute Proposed Transfer
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Sidebar: State and Log Registry */}
            <div className="space-y-6">
              
              {/* Registry */}
              <div className="bg-slate-900/30 border border-slate-900 rounded-2xl p-6">
                <h2 className="text-base font-bold text-white flex items-center gap-2 mb-4">
                  <Layers className="text-cyan-400" size={16} /> Registry Directory
                </h2>

                <div className="space-y-3.5 text-xs">
                  <div className="flex justify-between items-center py-1.5 border-b border-slate-900/50">
                    <span className="text-slate-500 flex items-center gap-1"><Wallet size={12} /> Wallet</span>
                    <span className="font-mono text-slate-300">
                      {account?.address ? shortAddress(account.address) : "Disconnected"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-slate-900/50">
                    <span className="text-slate-500">Network</span>
                    <span className="font-mono text-slate-300 uppercase">{IDS.network}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-slate-900/50">
                    <span className="text-slate-500">AdminCap</span>
                    <span className="font-mono text-slate-300">{adminId ? shortAddress(adminId) : "—"}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-slate-900/50">
                    <span className="text-slate-500">Vault</span>
                    <span className="font-mono text-slate-300">{vaultId ? shortAddress(vaultId) : "—"}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-slate-900/50">
                    <span className="text-slate-500">Permission</span>
                    <span className="font-mono text-slate-300">{permissionId ? shortAddress(permissionId) : "—"}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-slate-900/50">
                    <span className="text-slate-500">Proposal</span>
                    <span className="font-mono text-slate-300">{proposalId ? shortAddress(proposalId) : "—"}</span>
                  </div>
                </div>

                <div className="mt-6">
                  <button 
                    onClick={clearRegistry}
                    className="w-full bg-slate-950 border border-slate-900 text-slate-400 hover:text-white font-medium py-2 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Trash2 size={12} /> Clear Registry
                  </button>
                </div>
              </div>

              {/* Logs */}
              <div className="bg-slate-900/30 border border-slate-900 rounded-2xl p-6 flex flex-col h-[320px]">
                <h2 className="text-base font-bold text-white flex items-center gap-2 mb-4">
                  <Terminal className="text-cyan-400" size={16} /> Console Terminal
                </h2>
                
                <div className="flex-1 bg-slate-950 border border-slate-900/80 rounded-lg p-4 font-mono text-[11px] text-cyan-400/90 overflow-y-auto space-y-2">
                  {consoleLogs.length === 0 && <span className="text-slate-600">No events recorded.</span>}
                  {consoleLogs.map((log, i) => (
                    <div key={i} className="leading-relaxed break-all">
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </main>
        </div>
      )}

      {/* FOOTER */}
      <footer className="bg-white text-gray-500 text-xs py-6 text-center border-t border-gray-100 z-10">
        <p>© 2026 SkyElite Security & AI Action Firewall. Built on Sui Network.</p>
      </footer>
    </div>
  );
}
