import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Shield, Lock, ShieldCheck, AlertTriangle, Clock, Layers, Target,
  Wallet, Search, UserPlus, Trash2, X, Check, TrendingUp,
  LayoutGrid, Users, Receipt, Pencil, ChevronRight, Activity, KeyRound, Wrench,
  Megaphone, AtSign, Plus, History, Bell, BellOff, Download, Paperclip, Eye
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from "recharts";
import { supabase } from "./supabaseClient";

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */

const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN || "27198";
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";
const TOTAL_SHARES_FALLBACK = 32;
const BASE_RATE = 5000;
const SEP_MAINTENANCE = 50;

const MONTHS = [
  { key: "2026-09", label: "SEP", year: "2026" },
  { key: "2026-10", label: "OCT", year: "2026" },
  { key: "2026-11", label: "NOV", year: "2026" },
  { key: "2026-12", label: "DEC", year: "2026" },
  { key: "2027-01", label: "JAN", year: "2027" },
  { key: "2027-02", label: "FEB", year: "2027" },
  { key: "2027-03", label: "MAR", year: "2027" },
  { key: "2027-04", label: "APR", year: "2027" },
  { key: "2027-05", label: "MAY", year: "2027" },
  { key: "2027-06", label: "JUN", year: "2027" },
  { key: "2027-07", label: "JUL", year: "2027" },
  { key: "2027-08", label: "AUG", year: "2027" },
];

const rateForMonth = (idx) => (idx === 0 ? BASE_RATE + SEP_MAINTENANCE : BASE_RATE);

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const fmt = (n) => "\u09F3" + Math.round(n || 0).toLocaleString("en-US");
const fmtSigned = (n) => (n < 0 ? "-" : "") + fmt(Math.abs(n));

function computeElapsedMonths(members, payments) {
  for (let i = MONTHS.length - 1; i >= 0; i--) {
    const key = MONTHS[i].key;
    const any = members.some((m) => (payments[m.id]?.[key] || 0) > 0);
    if (any) return i + 1;
  }
  return 1;
}

function ratesSumUpTo(elapsed) {
  let s = 0;
  for (let i = 0; i < elapsed; i++) s += rateForMonth(i);
  return s;
}

function memberStats(member, payments, lateFees, elapsed, penaltyPool, totalShares) {
  const memberPayments = payments[member.id] || {};
  const paidPrincipal = MONTHS.reduce((sum, m) => sum + (memberPayments[m.key] || 0), 0);
  const expectedDue = member.shares * ratesSumUpTo(elapsed);
  const pendingDue = Math.max(0, expectedDue - paidPrincipal);
  const lateFee = lateFees[member.id] || 0;

  const maintenanceFeeOwed = member.shares * SEP_MAINTENANCE;
  const maintenanceFeeCollected = Math.min(maintenanceFeeOwed, paidPrincipal);
  const equityPrincipal = paidPrincipal - maintenanceFeeCollected;

  const equity = equityPrincipal - lateFee + penaltyPool * (member.shares / totalShares);
  const ownership = (member.shares / totalShares) * 100;
  let status = "Pending";
  if (paidPrincipal > 0 && pendingDue === 0) status = "Paid";
  else if (paidPrincipal > 0) status = "Partial";
  return {
    paidPrincipal, expectedDue, pendingDue, lateFee, equity, ownership, status,
    maintenanceFeeOwed, maintenanceFeeCollected,
  };
}

function initials(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

// Web Push requires the VAPID key as a Uint8Array, but it's issued as a base64url string.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/* ---------------- CSV export helpers ---------------- */

function csvEscape(val) {
  const s = String(val ?? "");
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function rowsToCSV(rows) {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

function downloadCSV(filename, rows) {
  const csv = "\uFEFF" + rowsToCSV(rows); // BOM so ৳ and non-ASCII names open correctly in Excel
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Small UI atoms                                                       */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }) {
  const map = {
    Paid: { bg: "rgba(52,211,153,0.12)", border: "rgba(52,211,153,0.35)", color: "#34d399" },
    Partial: { bg: "rgba(245,185,66,0.12)", border: "rgba(245,185,66,0.35)", color: "#f5b942" },
    Pending: { bg: "rgba(139,147,167,0.12)", border: "rgba(139,147,167,0.3)", color: "#9aa3b8" },
  };
  const s = map[status] || map.Pending;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "6px 12px", borderRadius: 999,
        background: s.bg, border: `1px solid ${s.border}`,
        color: s.color, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color, display: "inline-block" }} />
      {status}
    </span>
  );
}

function Avatar({ name, size = 44 }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: 12,
        background: "linear-gradient(155deg, rgba(77,166,255,0.22), rgba(37,99,235,0.10))",
        border: "1px solid rgba(77,166,255,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#7cc0ff", fontWeight: 700, fontSize: size * 0.4, flexShrink: 0,
      }}
    >
      {initials(name)}
    </div>
  );
}

function StatCard({ icon, iconBg, iconColor, label, value, sub }) {
  return (
    <div className="bff-card" style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, background: iconBg,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          {React.cloneElement(icon, { size: 17, color: iconColor })}
        </div>
        <span style={{ fontSize: 11.5, letterSpacing: 0.6, color: "#8b93a7", fontWeight: 700, textTransform: "uppercase" }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#f4f6fb", letterSpacing: -0.3 }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: "#5b6478", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function ModalShell({ onClose, children, align = "center" }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(3,5,10,0.72)",
        backdropFilter: "blur(3px)", zIndex: 100,
        display: "flex", alignItems: align === "bottom" ? "flex-end" : "center",
        justifyContent: "center", padding: align === "bottom" ? 0 : 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 460,
          background: "#0b0f18",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: align === "bottom" ? "20px 20px 0 0" : 18,
          maxHeight: "88vh", overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                   */
/* ------------------------------------------------------------------ */

export default function App() {
  const [tab, setTab] = useState("overview");
  const [isAdmin, setIsAdmin] = useState(false);
  const [members, setMembers] = useState([]);
  const [payments, setPayments] = useState({});
  const [receipts, setReceipts] = useState({});
  const [lateFees, setLateFees] = useState({});
  const [notices, setNotices] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [connError, setConnError] = useState(false);

  const [search, setSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState(null);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [pushStatus, setPushStatus] = useState("checking"); // checking | unsupported | off | on | denied

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  /* ---------------- Supabase: fetch + realtime ---------------- */

  const fetchAll = useCallback(async () => {
    const [membersRes, paymentsRes, lateFeesRes, noticesRes, activityRes] = await Promise.all([
      supabase.from("members").select("*").order("id"),
      supabase.from("payments").select("*"),
      supabase.from("late_fees").select("*"),
      supabase.from("notices").select("*").order("created_at", { ascending: false }),
      supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(200),
    ]);

    if (membersRes.error || paymentsRes.error || lateFeesRes.error || noticesRes.error || activityRes.error) {
      setConnError(true);
      return null;
    }
    setConnError(false);

    const paymentsObj = {};
    const receiptsObj = {};
    (paymentsRes.data || []).forEach((row) => {
      if (!paymentsObj[row.member_id]) paymentsObj[row.member_id] = {};
      paymentsObj[row.member_id][row.month_key] = Number(row.amount);
      if (row.receipt_path) {
        if (!receiptsObj[row.member_id]) receiptsObj[row.member_id] = {};
        receiptsObj[row.member_id][row.month_key] = row.receipt_path;
      }
    });

    const lateFeesObj = {};
    (lateFeesRes.data || []).forEach((row) => {
      lateFeesObj[row.member_id] = Number(row.amount);
    });

    return {
      members: membersRes.data || [],
      payments: paymentsObj,
      receipts: receiptsObj,
      lateFees: lateFeesObj,
      notices: noticesRes.data || [],
      activityLog: activityRes.data || [],
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await fetchAll();
      if (d && !cancelled) {
        setMembers(d.members);
        setPayments(d.payments);
        setReceipts(d.receipts);
        setLateFees(d.lateFees);
        setNotices(d.notices);
        setActivityLog(d.activityLog);
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [fetchAll]);

  useEffect(() => {
    const refetch = async () => {
      const d = await fetchAll();
      if (d) {
        setMembers(d.members);
        setPayments(d.payments);
        setReceipts(d.receipts);
        setLateFees(d.lateFees);
        setNotices(d.notices);
        setActivityLog(d.activityLog);
      }
    };

    const channel = supabase
      .channel("bff-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "members" }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "late_fees" }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "notices" }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_log" }, refetch)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchAll]);

  const logActivity = async (action) => {
    await supabase.from("activity_log").insert({ action });
  };

  /* ---------------- push notifications ---------------- */

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !VAPID_PUBLIC_KEY) {
      setPushStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setPushStatus("denied");
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setPushStatus(sub ? "on" : "off"))
      .catch(() => setPushStatus("off"));
  }, []);

  const enablePush = async () => {
    if (pushStatus === "unsupported") {
      showToast("Notifications aren't supported on this device/browser");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushStatus(permission === "denied" ? "denied" : "off");
        showToast("Notification permission wasn't granted");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const json = sub.toJSON();
      const { error } = await supabase.from("push_subscriptions").upsert(
        { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
        { onConflict: "endpoint" }
      );
      if (error) { showToast("Couldn't save subscription"); return; }
      setPushStatus("on");
      showToast("Notifications enabled");
    } catch (e) {
      showToast("Couldn't enable notifications");
    }
  };

  const disablePush = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setPushStatus("off");
      showToast("Notifications turned off");
    } catch (e) {
      showToast("Couldn't turn off notifications");
    }
  };

  /* ---------------- derived ---------------- */

  const totalShares = members.reduce((s, m) => s + m.shares, 0) || TOTAL_SHARES_FALLBACK;
  const yearlyTarget = totalShares * 12 * BASE_RATE + totalShares * SEP_MAINTENANCE;

  const elapsed = computeElapsedMonths(members, payments);
  const penaltyPool = Object.values(lateFees).reduce((s, v) => s + (v || 0), 0);

  const statsById = {};
  let collectedPrincipal = 0;
  let totalPendingDues = 0;
  let totalMaintenanceFee = 0;
  let maintenanceFeeCollected = 0;
  members.forEach((m) => {
    const st = memberStats(m, payments, lateFees, elapsed, penaltyPool, totalShares);
    statsById[m.id] = st;
    collectedPrincipal += st.paidPrincipal;
    totalPendingDues += st.pendingDue;
    totalMaintenanceFee += st.maintenanceFeeOwed;
    maintenanceFeeCollected += st.maintenanceFeeCollected;
  });
  const remainingDues = Math.max(0, yearlyTarget - collectedPrincipal);
  const progressPct = Math.min(100, (collectedPrincipal / yearlyTarget) * 100);

  const monthlyTotals = MONTHS.map((mo) => {
    const total = members.reduce((s, m) => s + (payments[m.id]?.[mo.key] || 0), 0);
    return { name: mo.label, value: total };
  });

  const exportMembersCSV = () => {
    const header = [
      "Name", "Shares", "Ownership %", "Total Received", "Expected Due", "Pending Due",
      "Late Fee", "Maintenance Owed", "Maintenance Collected", "Equity", "Status",
    ];
    const rows = [header, ...members.map((m) => {
      const st = statsById[m.id];
      return [
        m.name, m.shares, st.ownership.toFixed(1),
        Math.round(st.paidPrincipal), Math.round(st.expectedDue), Math.round(st.pendingDue),
        Math.round(st.lateFee), Math.round(st.maintenanceFeeOwed), Math.round(st.maintenanceFeeCollected),
        Math.round(st.equity), st.status,
      ];
    })];
    downloadCSV(`bff-members-${todayStamp()}.csv`, rows);
    logActivity("Exported members summary (CSV)");
  };

  const exportPaymentsCSV = () => {
    const header = ["Member", "Shares", ...MONTHS.map((mo) => `${mo.label} ${mo.year}`), "Total"];
    const rows = [header];
    members.forEach((m) => {
      const monthVals = MONTHS.map((mo) => payments[m.id]?.[mo.key] || 0);
      const total = monthVals.reduce((s, v) => s + v, 0);
      rows.push([m.name, m.shares, ...monthVals.map((v) => Math.round(v)), Math.round(total)]);
    });
    const monthTotals = MONTHS.map((mo) =>
      Math.round(members.reduce((s, m) => s + (payments[m.id]?.[mo.key] || 0), 0))
    );
    const grandTotal = monthTotals.reduce((s, v) => s + v, 0);
    rows.push(["TOTAL", "", ...monthTotals, grandTotal]);
    downloadCSV(`bff-payments-${todayStamp()}.csv`, rows);
    logActivity("Exported payments tracker (CSV)");
  };

  /* ---------------- admin actions (write straight to Supabase) ---------------- */

  const doAddMember = async (name, shares) => {
    const { error } = await supabase.from("members").insert({ name, shares });
    if (error) { showToast("Couldn't add member"); return; }
    showToast(`${name} added to the fund`);
    logActivity(`Added ${name} to the fund (${shares} share${shares === 1 ? "" : "s"})`);
  };

  const doDeleteMember = async (id) => {
    const member = members.find((m) => m.id === id);
    const { error } = await supabase.from("members").delete().eq("id", id);
    if (error) { showToast("Couldn't remove member"); return; }
    showToast("Member removed");
    logActivity(`Removed ${member ? member.name : "a member"} from the fund`);
  };

  const doSetPayment = async (memberId, monthKey, amount) => {
    const member = members.find((m) => m.id === memberId);
    const monthInfo = MONTHS.find((mo) => mo.key === monthKey);
    const { error } = await supabase
      .from("payments")
      .upsert({ member_id: memberId, month_key: monthKey, amount }, { onConflict: "member_id,month_key" });
    if (error) { showToast("Couldn't save payment"); return; }
    showToast("Payment recorded");
    const name = member ? member.name : "a member";
    const monthLabel = monthInfo ? `${monthInfo.label} ${monthInfo.year}` : monthKey;
    if (amount > 0) {
      logActivity(`Recorded ${fmt(amount)} for ${name} — ${monthLabel}`);
    } else {
      logActivity(`Cleared ${monthLabel} payment for ${name}`);
    }
  };

  const doUploadReceipt = async (member, monthKey, file) => {
    const monthInfo = MONTHS.find((mo) => mo.key === monthKey);
    const monthLabel = monthInfo ? `${monthInfo.label} ${monthInfo.year}` : monthKey;
    const ext = (file.name.split(".").pop() || "dat").toLowerCase();
    const path = `${member.id}/${monthKey}.${ext}`;

    const existingPath = receipts[member.id]?.[monthKey];
    if (existingPath && existingPath !== path) {
      await supabase.storage.from("receipts").remove([existingPath]);
    }

    const { error: upErr } = await supabase.storage
      .from("receipts")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) { showToast("Couldn't upload receipt"); return; }

    const { error: dbErr } = await supabase
      .from("payments")
      .upsert({ member_id: member.id, month_key: monthKey, receipt_path: path }, { onConflict: "member_id,month_key" });
    if (dbErr) { showToast("Couldn't save receipt"); return; }

    showToast("Receipt uploaded");
    logActivity(`Uploaded receipt for ${member.name} — ${monthLabel}`);
  };

  const doRemoveReceipt = async (member, monthKey) => {
    const monthInfo = MONTHS.find((mo) => mo.key === monthKey);
    const monthLabel = monthInfo ? `${monthInfo.label} ${monthInfo.year}` : monthKey;
    const path = receipts[member.id]?.[monthKey];
    if (!path) return;

    await supabase.storage.from("receipts").remove([path]);
    const { error } = await supabase
      .from("payments")
      .upsert({ member_id: member.id, month_key: monthKey, receipt_path: null }, { onConflict: "member_id,month_key" });
    if (error) { showToast("Couldn't remove receipt"); return; }

    showToast("Receipt removed");
    logActivity(`Removed receipt for ${member.name} — ${monthLabel}`);
  };

  const totalReceiptCount = Object.values(receipts).reduce(
    (sum, memberReceipts) => sum + Object.keys(memberReceipts).length,
    0
  );

  const doDeleteAllReceipts = async () => {
    const allPaths = Object.values(receipts).flatMap((memberReceipts) => Object.values(memberReceipts));
    if (allPaths.length === 0) { showToast("No receipts to delete"); return; }

    const { error: storageError } = await supabase.storage.from("receipts").remove(allPaths);
    if (storageError) { showToast("Couldn't delete receipt files"); return; }

    const { error: dbError } = await supabase
      .from("payments")
      .update({ receipt_path: null })
      .not("receipt_path", "is", null);
    if (dbError) { showToast("Files deleted, but couldn't clear attachments"); return; }

    showToast(`Deleted ${allPaths.length} receipt${allPaths.length === 1 ? "" : "s"}`);
    logActivity(`Deleted all receipt attachments (${allPaths.length} file${allPaths.length === 1 ? "" : "s"})`);
  };

  const doSetLateFee = async (memberId, amount) => {
    const member = members.find((m) => m.id === memberId);
    const oldAmount = lateFees[memberId] || 0;
    const { error } = await supabase
      .from("late_fees")
      .upsert({ member_id: memberId, amount }, { onConflict: "member_id" });
    if (error) { showToast("Couldn't update late fee"); return; }
    showToast("Late fee updated");
    const name = member ? member.name : "a member";
    logActivity(`Late fee for ${name}: ${fmt(oldAmount)} → ${fmt(amount)}`);
  };

  const doSetShares = async (memberId, shares) => {
    const member = members.find((m) => m.id === memberId);
    const oldShares = member ? member.shares : null;
    const { error } = await supabase.from("members").update({ shares }).eq("id", memberId);
    if (error) { showToast("Couldn't update shares"); return; }
    showToast("Shares updated");
    const name = member ? member.name : "a member";
    logActivity(`Shares for ${name}: ${oldShares ?? "?"} → ${shares}`);
  };

  const doAddNotice = async (message, mentionedMemberId) => {
    const mentioned = mentionedMemberId ? members.find((m) => m.id === mentionedMemberId) : null;
    const { error } = await supabase
      .from("notices")
      .insert({ message, mentioned_member_id: mentionedMemberId || null });
    if (error) { showToast("Couldn't post notice"); return; }
    showToast("Notice posted");
    logActivity(`Posted a notice${mentioned ? ` mentioning ${mentioned.name}` : ""}`);
  };

  const doDeleteNotice = async (id) => {
    const { error } = await supabase.from("notices").delete().eq("id", id);
    if (error) { showToast("Couldn't remove notice"); return; }
    showToast("Notice removed");
    logActivity("Removed a notice");
  };

  /* ---------------- render ---------------- */

  const filteredMembers = members.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase())
  );

  if (!loaded) {
    return (
      <div style={rootStyle}>
        <GlobalStyle />
        <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#5b6478" }}>
          Loading fund data…
        </div>
      </div>
    );
  }

  return (
    <div style={rootStyle}>
      <GlobalStyle />

      <div style={{ maxWidth: 480, margin: "0 auto", paddingBottom: 96 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 16px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 46, height: 46, borderRadius: 13,
              background: "linear-gradient(155deg, #5bb8ff, #2f7fe0)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 18px rgba(77,166,255,0.35)",
            }}>
              <Shield size={22} color="#04121f" strokeWidth={2.4} fill="#04121f" />
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#f4f6fb", letterSpacing: -0.2 }}>Brotherhood Future Fund</div>
              <div style={{ fontSize: 12.5, color: "#5b6478", marginTop: 1 }}>Sep 2026 — Aug 2027 Cycle</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isAdmin && (
              <button
                onClick={() => setModal({ type: "export" })}
                title="Export data"
                style={{
                  width: 40, height: 40, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center",
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  cursor: "pointer", flexShrink: 0,
                }}
              >
                <Download size={16} color="#9aa3b8" />
              </button>
            )}
            {pushStatus !== "unsupported" && (
              <button
                onClick={pushStatus === "on" ? disablePush : enablePush}
                title={pushStatus === "on" ? "Notifications on — tap to turn off" : "Turn on notifications"}
                style={{
                  width: 40, height: 40, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center",
                  background: pushStatus === "on" ? "rgba(52,211,153,0.1)" : "rgba(255,255,255,0.05)",
                  border: pushStatus === "on" ? "1px solid rgba(52,211,153,0.35)" : "1px solid rgba(255,255,255,0.1)",
                  cursor: "pointer", flexShrink: 0,
                }}
              >
                {pushStatus === "on"
                  ? <Bell size={16} color="#34d399" />
                  : <BellOff size={16} color="#9aa3b8" />}
              </button>
            )}
            <button
              onClick={() => (isAdmin ? setIsAdmin(false) : setModal({ type: "adminLogin" }))}
              className="bff-pillbtn"
              style={
                isAdmin
                  ? { background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.35)", color: "#34d399" }
                  : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#9aa3b8" }
              }
            >
              {isAdmin ? <ShieldCheck size={15} /> : <Lock size={15} />}
              {isAdmin ? "Admin" : "Member"}
            </button>
          </div>
        </div>

        {connError && (
          <div style={{ margin: "4px 16px 0", padding: "8px 12px", borderRadius: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", fontSize: 12 }}>
            Couldn't reach the database — check your Supabase connection.
          </div>
        )}

        {tab === "overview" && (
          <OverviewTab
            collectedPrincipal={collectedPrincipal}
            progressPct={progressPct}
            totalPendingDues={totalPendingDues}
            penaltyPool={penaltyPool}
            elapsed={elapsed}
            members={members}
            totalShares={totalShares}
            yearlyTarget={yearlyTarget}
            remainingDues={remainingDues}
            monthlyTotals={monthlyTotals}
            totalMaintenanceFee={totalMaintenanceFee}
            maintenanceFeeCollected={maintenanceFeeCollected}
            notices={notices}
            isAdmin={isAdmin}
            onAddNotice={() => setModal({ type: "addNotice" })}
            onDeleteNotice={(id) => setModal({ type: "confirmDeleteNotice", payload: id })}
          />
        )}

        {tab === "members" && (
          <MembersTab
            members={filteredMembers}
            statsById={statsById}
            search={search}
            setSearch={setSearch}
            isAdmin={isAdmin}
            onOpenMember={(m) => setSelectedMember(m)}
            onAdd={() => setModal({ type: "addMember" })}
            onDelete={(m) => setModal({ type: "confirmDelete", payload: m })}
          />
        )}

        {tab === "payments" && (
          <PaymentsTab
            members={members}
            payments={payments}
            isAdmin={isAdmin}
            onEditCell={(member, month) => setModal({ type: "editPayment", payload: { member, month } })}
          />
        )}

        {tab === "activity" && (
          <ActivityTab activityLog={activityLog} />
        )}
      </div>

      <div style={navWrapStyle}>
        <div style={navBarStyle}>
          <NavBtn active={tab === "overview"} onClick={() => setTab("overview")} icon={<LayoutGrid size={18} />} label="Overview" />
          <NavBtn active={tab === "members"} onClick={() => setTab("members")} icon={<Users size={18} />} label="Members" />
          <NavBtn active={tab === "payments"} onClick={() => setTab("payments")} icon={<Receipt size={18} />} label="Payments" />
          <NavBtn active={tab === "activity"} onClick={() => setTab("activity")} icon={<History size={18} />} label="Activity" />
        </div>
      </div>

      {selectedMember && statsById[selectedMember.id] && (
        <MemberDetailModal
          member={selectedMember}
          stats={statsById[selectedMember.id]}
          payments={payments[selectedMember.id] || {}}
          receipts={receipts[selectedMember.id] || {}}
          isAdmin={isAdmin}
          onClose={() => setSelectedMember(null)}
          onEditLateFee={() => setModal({ type: "editLateFee", payload: selectedMember })}
          onEditShares={() => setModal({ type: "editShares", payload: selectedMember })}
          onEditMonth={(month) => setModal({ type: "editPayment", payload: { member: selectedMember, month } })}
          onUploadReceipt={(monthKey, file) => doUploadReceipt(selectedMember, monthKey, file)}
          onRemoveReceipt={(monthKey) => doRemoveReceipt(selectedMember, monthKey)}
        />
      )}

      {modal?.type === "export" && (
        <ExportModal
          onClose={() => setModal(null)}
          onExportMembers={() => { exportMembersCSV(); setModal(null); }}
          onExportPayments={() => { exportPaymentsCSV(); setModal(null); }}
          receiptCount={totalReceiptCount}
          onDeleteAllReceipts={() => setModal({ type: "confirmDeleteAllReceipts" })}
        />
      )}
      {modal?.type === "confirmDeleteAllReceipts" && (
        <ConfirmDeleteAllReceiptsModal
          count={totalReceiptCount}
          onClose={() => setModal(null)}
          onConfirm={async () => { await doDeleteAllReceipts(); setModal(null); }}
        />
      )}
      {modal?.type === "adminLogin" && (
        <AdminLoginModal
          onClose={() => setModal(null)}
          onSuccess={() => { setIsAdmin(true); setModal(null); showToast("Admin mode unlocked"); }}
        />
      )}
      {modal?.type === "addMember" && (
        <AddMemberModal
          onClose={() => setModal(null)}
          onSave={async (name, shares) => { await doAddMember(name, shares); setModal(null); }}
        />
      )}
      {modal?.type === "confirmDelete" && (
        <ConfirmDeleteModal
          member={modal.payload}
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await doDeleteMember(modal.payload.id);
            if (selectedMember?.id === modal.payload.id) setSelectedMember(null);
            setModal(null);
          }}
        />
      )}
      {modal?.type === "editLateFee" && (
        <EditNumberModal
          title="Edit Late Fee"
          label={`Late fee for ${modal.payload.name}`}
          initial={lateFees[modal.payload.id] || 0}
          onClose={() => setModal(null)}
          onSave={async (val) => { await doSetLateFee(modal.payload.id, val); setModal(null); }}
        />
      )}
      {modal?.type === "editShares" && (
        <EditNumberModal
          title="Edit Shares"
          label={`Share allocation for ${modal.payload.name}`}
          initial={modal.payload.shares}
          onClose={() => setModal(null)}
          onSave={async (val) => {
            const v = Math.max(0, Math.round(val));
            await doSetShares(modal.payload.id, v);
            setSelectedMember((sm) => (sm ? { ...sm, shares: v } : sm));
            setModal(null);
          }}
        />
      )}
      {modal?.type === "addNotice" && (
        <AddNoticeModal
          members={members}
          onClose={() => setModal(null)}
          onSave={async (message, mentionedId) => { await doAddNotice(message, mentionedId); setModal(null); }}
        />
      )}
      {modal?.type === "confirmDeleteNotice" && (
        <ConfirmDeleteNoticeModal
          onClose={() => setModal(null)}
          onConfirm={async () => { await doDeleteNotice(modal.payload); setModal(null); }}
        />
      )}
      {modal?.type === "editPayment" && (
        <EditNumberModal
          title="Record Payment"
          label={`${modal.payload.member.name} — ${modal.payload.month.label} ${modal.payload.month.year}`}
          initial={payments[modal.payload.member.id]?.[modal.payload.month.key] || 0}
          allowClear
          onClose={() => setModal(null)}
          onSave={async (val) => {
            await doSetPayment(modal.payload.member.id, modal.payload.month.key, val);
            setModal(null);
          }}
        />
      )}

      {toast && (
        <div style={toastStyle}>
          <Check size={14} color="#34d399" /> {toast}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                  */
/* ------------------------------------------------------------------ */

function timeAgo(dateStr) {
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Always shown in Dhaka time (GMT+6), regardless of the viewer's own device timezone —
// keeps the log consistent for everyone reading it.
function formatDhakaTime(dateStr) {
  const d = new Date(dateStr);
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Dhaka",
  });
  const date = d.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Dhaka",
  });
  return `${time}, ${date}`;
}

function OverviewTab({
  collectedPrincipal, progressPct, totalPendingDues, penaltyPool, elapsed,
  members, totalShares, yearlyTarget, remainingDues, monthlyTotals,
  totalMaintenanceFee, maintenanceFeeCollected,
  notices, isAdmin, onAddNotice, onDeleteNotice,
}) {
  const memberById = {};
  members.forEach((m) => { memberById[m.id] = m; });

  return (
    <div style={{ padding: "12px 16px 0" }}>
      <div className="bff-card" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Megaphone size={16} color="#5bb8ff" />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#f4f6fb" }}>Notices</span>
          </div>
          {isAdmin && (
            <button onClick={onAddNotice} className="bff-addbtn" style={{ padding: "0 14px", height: 34 }}>
              <Plus size={14} /> Post
            </button>
          )}
        </div>

        {notices.length === 0 ? (
          <div style={{ fontSize: 13, color: "#5b6478", padding: "6px 2px" }}>
            No notices yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {notices.map((n) => {
              const mentioned = n.mentioned_member_id ? memberById[n.mentioned_member_id] : null;
              return (
                <div
                  key={n.id}
                  style={{
                    padding: "12px 14px", borderRadius: 11, background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {mentioned && (
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "3px 9px", borderRadius: 999, marginBottom: 7,
                          background: "rgba(91,184,255,0.12)", border: "1px solid rgba(91,184,255,0.35)",
                          color: "#5bb8ff", fontSize: 12, fontWeight: 700,
                        }}>
                          <AtSign size={11} /> {mentioned.name}
                        </span>
                      )}
                      <div style={{ fontSize: 14, color: "#e2e6f0", lineHeight: 1.45, wordBreak: "break-word" }}>
                        {n.message}
                      </div>
                      <div style={{ fontSize: 11.5, color: "#5b6478", marginTop: 6 }}>{timeAgo(n.created_at)}</div>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => onDeleteNotice(n.id)}
                        style={{
                          width: 30, height: 30, borderRadius: 9, background: "rgba(248,113,113,0.08)",
                          border: "1px solid rgba(248,113,113,0.25)", display: "flex", alignItems: "center",
                          justifyContent: "center", color: "#f87171", cursor: "pointer", flexShrink: 0,
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bff-card" style={{ padding: 22, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontSize: 12, letterSpacing: 0.8, color: "#8b93a7", fontWeight: 700, textTransform: "uppercase" }}>
            Collected Principal
          </span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px",
            borderRadius: 999, background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.35)",
            color: "#34d399", fontSize: 11.5, fontWeight: 700,
          }}>
            <span className="bff-live-dot" />
            LIVE
          </span>
        </div>
        <div style={{ fontSize: 38, fontWeight: 800, color: "#f4f6fb", letterSpacing: -0.5, marginBottom: 20 }}>
          {fmt(collectedPrincipal)}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: "#8b93a7" }}>Progress to {fmt(yearlyTarget)}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#5bb8ff" }}>{progressPct.toFixed(2)}%</span>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${Math.max(progressPct, 1.5)}%`, borderRadius: 999,
            background: "linear-gradient(90deg, #2f7fe0, #5bb8ff)",
          }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <StatCard icon={<AlertTriangle />} iconBg="rgba(245,185,66,0.12)" iconColor="#f5b942" label="Pending Dues" value={fmt(totalPendingDues)} />
        <StatCard icon={<AlertTriangle />} iconBg="rgba(248,113,113,0.12)" iconColor="#f87171" label="Penalty Pool" value={fmt(penaltyPool)} />
        <StatCard icon={<Clock />} iconBg="rgba(52,211,153,0.12)" iconColor="#34d399" label="Active Months" value={elapsed} sub="of 12 elapsed" />
        <StatCard icon={<Layers />} iconBg="rgba(148,163,184,0.14)" iconColor="#c3cadb" label="Fund Shares" value={totalShares} sub={`${members.length} members`} />
        <StatCard icon={<Target />} iconBg="rgba(100,116,139,0.16)" iconColor="#94a3b8" label="Yearly Target" value={fmt(yearlyTarget)} />
        <StatCard icon={<Wallet />} iconBg="rgba(234,179,8,0.14)" iconColor="#eab308" label="Remaining Dues" value={fmt(remainingDues)} />
      </div>

      <div className="bff-card" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9, background: "rgba(139,147,167,0.14)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Wrench size={16} color="#c3cadb" />
          </div>
          <span style={{ fontSize: 11.5, letterSpacing: 0.6, color: "#8b93a7", fontWeight: 700, textTransform: "uppercase" }}>
            Yearly Maintenance Fee
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#f4f6fb", letterSpacing: -0.3 }}>{fmt(totalMaintenanceFee)}</div>
            <div style={{ fontSize: 12, color: "#5b6478", marginTop: 4 }}>৳50 / share · collected each September</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#34d399" }}>{fmt(maintenanceFeeCollected)}</div>
            <div style={{ fontSize: 11.5, color: "#5b6478", marginTop: 2 }}>collected so far</div>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: "#5b6478", marginTop: 12, lineHeight: 1.4 }}>
          Operational fund — excluded from member equity calculations.
        </div>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)",
        }}>
          <span style={{ fontSize: 12.5, color: "#8b93a7", fontWeight: 600 }}>Net Equity Target</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#5bb8ff" }}>{fmt(yearlyTarget - totalMaintenanceFee)}</span>
        </div>
      </div>

      <div className="bff-card" style={{ padding: "18px 10px 8px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", marginBottom: 6 }}>
          <Activity size={15} color="#5bb8ff" />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#f4f6fb" }}>Payment Pulse</span>
        </div>
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthlyTotals} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5bb8ff" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#5bb8ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#5b6478", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                formatter={(v) => [fmt(v), "Collected"]}
                contentStyle={{ background: "#0b0f18", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }}
                labelStyle={{ color: "#8b93a7" }}
              />
              <Area type="monotone" dataKey="value" stroke="#5bb8ff" strokeWidth={2} fill="url(#pulseFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function MembersTab({ members, statsById, search, setSearch, isAdmin, onOpenMember, onAdd, onDelete }) {
  return (
    <div style={{ padding: "12px 16px 0" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div style={{
          flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "0 14px",
          borderRadius: 13, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
        }}>
          <Search size={16} color="#5b6478" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members..."
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "#f4f6fb", fontSize: 14.5, padding: "13px 0",
            }}
          />
        </div>
        {isAdmin && (
          <button onClick={onAdd} className="bff-addbtn">
            <UserPlus size={16} /> Add
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {members.map((m) => {
          const st = statsById[m.id];
          if (!st) return null;
          return (
            <div key={m.id} className="bff-card" style={{ padding: 16 }}>
              <div onClick={() => onOpenMember(m)} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                <Avatar name={m.name} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#f4f6fb" }}>{m.name}</div>
                  <div style={{ fontSize: 12.5, color: "#5b6478", marginTop: 1 }}>
                    {m.shares} shares · {st.ownership.toFixed(1)}%
                  </div>
                </div>
                <StatusBadge status={st.status} />
              </div>
              <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "14px 0" }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 10.5, letterSpacing: 0.6, color: "#5b6478", fontWeight: 700, textTransform: "uppercase" }}>Equity</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: "#f4f6fb", marginTop: 2 }}>{fmtSigned(st.equity)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, letterSpacing: 0.6, color: "#5b6478", fontWeight: 700, textTransform: "uppercase" }}>Pending</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: "#f5b942", marginTop: 2 }}>{fmt(st.pendingDue)}</div>
                </div>
                {isAdmin ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(m); }}
                    style={{
                      width: 40, height: 40, borderRadius: 11, background: "rgba(248,113,113,0.1)",
                      border: "1px solid rgba(248,113,113,0.3)", display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#f87171", cursor: "pointer",
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                ) : (
                  <ChevronRight size={18} color="#3a4054" />
                )}
              </div>
            </div>
          );
        })}
        {members.length === 0 && (
          <div style={{ textAlign: "center", color: "#5b6478", padding: "40px 0", fontSize: 14 }}>No members match your search.</div>
        )}
      </div>
    </div>
  );
}

function PaymentsTab({ members, payments, isAdmin, onEditCell }) {
  const colWidth = 108;
  const firstColWidth = 168;

  const monthTotal = (monthKey) => members.reduce((s, m) => s + (payments[m.id]?.[monthKey] || 0), 0);
  const grandTotal = MONTHS.reduce((s, mo) => s + monthTotal(mo.key), 0);

  return (
    <div style={{ padding: "12px 0 0" }}>
      <div style={{ overflowX: "auto", padding: "0 16px 4px" }}>
        <div className="bff-card" style={{ overflow: "hidden", minWidth: firstColWidth + colWidth * MONTHS.length }}>
          <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{
              width: firstColWidth, flexShrink: 0, padding: "16px 14px",
              fontSize: 11, letterSpacing: 0.6, color: "#8b93a7", fontWeight: 700, textTransform: "uppercase",
              position: "sticky", left: 0, background: "#0d1119", zIndex: 2,
            }}>
              Member
            </div>
            {MONTHS.map((mo) => (
              <div key={mo.key} style={{ width: colWidth, flexShrink: 0, padding: "14px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#c3cadb", letterSpacing: 0.4 }}>{mo.label}</div>
                <div style={{ fontSize: 10.5, color: "#5b6478", marginTop: 1 }}>{mo.year}</div>
              </div>
            ))}
          </div>

          {members.map((m) => (
            <div key={m.id} style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{
                width: firstColWidth, flexShrink: 0, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10,
                position: "sticky", left: 0, background: "#0b0f18", zIndex: 1,
              }}>
                <Avatar name={m.name} size={36} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#f4f6fb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
                  <div style={{ fontSize: 11.5, color: "#5b6478" }}>{m.shares} sh</div>
                </div>
              </div>
              {MONTHS.map((mo) => {
                const val = payments[m.id]?.[mo.key] || 0;
                return (
                  <div key={mo.key} style={{ width: colWidth, flexShrink: 0, padding: "10px 8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {val > 0 ? (
                      <button
                        onClick={() => isAdmin && onEditCell(m, mo)}
                        style={{
                          padding: "8px 10px", borderRadius: 9, fontSize: 12.5, fontWeight: 700,
                          background: "rgba(245,185,66,0.1)", border: "1px solid rgba(245,185,66,0.35)",
                          color: "#f5b942", cursor: isAdmin ? "pointer" : "default", whiteSpace: "nowrap",
                        }}
                      >
                        {fmt(val)}
                      </button>
                    ) : (
                      <button
                        onClick={() => isAdmin && onEditCell(m, mo)}
                        style={{
                          width: 32, height: 32, borderRadius: 9, background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.06)", color: "#3a4054",
                          cursor: isAdmin ? "pointer" : "default", fontSize: 15,
                        }}
                      >
                        —
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          <div style={{
            display: "flex", position: "sticky", bottom: 0,
            background: "#111726", borderTop: "1px solid rgba(255,255,255,0.12)",
          }}>
            <div style={{
              width: firstColWidth, flexShrink: 0, padding: "14px 14px",
              fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: "#5bb8ff",
              position: "sticky", left: 0, background: "#111726", zIndex: 2,
              display: "flex", alignItems: "center",
            }}>
              TOTAL
            </div>
            {MONTHS.map((mo) => (
              <div key={mo.key} style={{ width: colWidth, flexShrink: 0, padding: "14px 8px", textAlign: "center", fontSize: 12.5, fontWeight: 700, color: "#f4f6fb" }}>
                {fmt(monthTotal(mo.key))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bff-card" style={{ margin: "14px 16px 0", padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, color: "#8b93a7", fontWeight: 600 }}>Total Collected Principal (all months)</span>
        <span style={{ fontSize: 18, fontWeight: 800, color: "#34d399" }}>{fmt(grandTotal)}</span>
      </div>
    </div>
  );
}

function ActivityTab({ activityLog }) {
  return (
    <div style={{ padding: "12px 16px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <History size={16} color="#5bb8ff" />
        <span style={{ fontSize: 14, fontWeight: 700, color: "#f4f6fb" }}>Activity Log</span>
      </div>

      {activityLog.length === 0 ? (
        <div style={{ textAlign: "center", color: "#5b6478", padding: "40px 0", fontSize: 14 }}>
          No activity yet — admin changes will show up here.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {activityLog.map((entry) => (
            <div
              key={entry.id}
              className="bff-card"
              style={{ padding: "13px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: 8, background: "rgba(91,184,255,0.1)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1,
              }}>
                <ShieldCheck size={13} color="#5bb8ff" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: "#e2e6f0", lineHeight: 1.4 }}>{entry.action}</div>
                <div style={{ fontSize: 11.5, color: "#5b6478", marginTop: 3 }}>{formatDhakaTime(entry.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MemberDetailModal({ member, stats, payments, receipts, isAdmin, onClose, onEditLateFee, onEditShares, onEditMonth, onUploadReceipt, onRemoveReceipt }) {
  return (
    <ModalShell onClose={onClose} align="bottom">
      <div style={{ padding: "22px 20px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar name={member.name} size={52} />
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#f4f6fb" }}>{member.name}</div>
              <div style={{ fontSize: 13, color: "#5b6478", marginTop: 2 }}>{stats.ownership.toFixed(1)}% ownership</div>
            </div>
          </div>
          <button onClick={onClose} style={closeBtnStyle}><X size={18} color="#8b93a7" /></button>
        </div>

        <div style={{ fontSize: 11.5, letterSpacing: 0.7, color: "#8b93a7", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
          Equity &amp; Payment Summary
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
          <SummaryRow icon={<Target size={15} />} label="Expected Due" value={fmt(stats.expectedDue)} color="#f4f6fb" />
          <SummaryRow icon={<Check size={15} />} label="Total Received" value={fmt(stats.paidPrincipal)} color="#34d399" />
          <SummaryRow icon={<AlertTriangle size={15} />} label="Pending Due" value={fmt(stats.pendingDue)} color="#f5b942" />
          <SummaryRow icon={<Clock size={15} />} label="Late Fees" value={fmt(stats.lateFee)} color="#f87171" />
          <SummaryRow icon={<TrendingUp size={15} />} label="Current Equity" value={fmtSigned(stats.equity)} color="#5bb8ff" />
        </div>
        {stats.maintenanceFeeCollected > 0 && (
          <div style={{ fontSize: 11.5, color: "#5b6478", marginBottom: 18, lineHeight: 1.4 }}>
            Excludes {fmt(stats.maintenanceFeeCollected)} maintenance fee (of {fmt(stats.maintenanceFeeOwed)} owed) — operational fund, not equity.
          </div>
        )}

        <div style={{
          border: "1px solid rgba(248,113,113,0.3)", borderRadius: 14, padding: 18,
          background: "rgba(248,113,113,0.05)", marginBottom: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#f87171", fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6, marginBottom: 12 }}>
            <AlertTriangle size={14} /> LATE FEE / PENALTY
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#f87171" }}>{fmt(stats.lateFee)}</div>
              <div style={{ fontSize: 12, color: "#8b93a7", marginTop: 2 }}>Current penalty contribution</div>
            </div>
            {isAdmin && <button onClick={onEditLateFee} className="bff-editbtn">Edit Late Fee</button>}
          </div>
        </div>

        <div style={{
          border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 18,
          background: "rgba(255,255,255,0.02)", marginBottom: 22,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#8b93a7", fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6, marginBottom: 10 }}>
                <Layers size={14} /> SHARES ALLOCATION
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#f4f6fb" }}>{member.shares} shares</div>
            </div>
            {isAdmin && (
              <button onClick={onEditShares} className="bff-editbtn" style={{ color: "#5bb8ff", borderColor: "rgba(91,184,255,0.35)", background: "rgba(91,184,255,0.08)" }}>
                <Pencil size={12} style={{ marginRight: 5 }} /> Edit
              </button>
            )}
          </div>
        </div>

        <div style={{ fontSize: 11.5, letterSpacing: 0.7, color: "#8b93a7", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
          12-Month Payment History
        </div>
        <div style={{ fontSize: 11, color: "#5b6478", marginBottom: 10, lineHeight: 1.4 }}>
          <Paperclip size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
          Tap the paperclip to {isAdmin ? "attach or view" : "view"} a bank receipt for a month.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {MONTHS.map((mo) => {
            const val = payments[mo.key] || 0;
            const receiptPath = receipts[mo.key];
            const receiptUrl = receiptPath
              ? supabase.storage.from("receipts").getPublicUrl(receiptPath).data.publicUrl
              : null;
            return (
              <div
                key={mo.key}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                  padding: "12px 14px", borderRadius: 11, background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <div
                  onClick={() => isAdmin && onEditMonth(mo)}
                  style={{
                    flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between",
                    cursor: isAdmin ? "pointer" : "default",
                  }}
                >
                  <span style={{ fontSize: 13.5, color: "#c3cadb", fontWeight: 600 }}>{mo.label} {mo.year}</span>
                  {val > 0 ? (
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: "#34d399" }}>{fmt(val)}</span>
                  ) : (
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "#5b6478" }}>Not Paid</span>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                  {receiptUrl && (
                    <button
                      onClick={(e) => { e.stopPropagation(); window.open(receiptUrl, "_blank"); }}
                      title="View receipt"
                      style={receiptIconBtnStyle("#5bb8ff", "rgba(91,184,255,0.1)", "rgba(91,184,255,0.3)")}
                    >
                      <Eye size={13} />
                    </button>
                  )}
                  {isAdmin && (
                    <>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        id={`receipt-input-${mo.key}`}
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) onUploadReceipt(mo.key, f);
                          e.target.value = "";
                        }}
                      />
                      <label
                        htmlFor={`receipt-input-${mo.key}`}
                        onClick={(e) => e.stopPropagation()}
                        title={receiptUrl ? "Replace receipt" : "Attach receipt"}
                        style={{
                          ...receiptIconBtnStyle(
                            receiptUrl ? "#8b93a7" : "#5bb8ff",
                            receiptUrl ? "rgba(255,255,255,0.04)" : "rgba(91,184,255,0.08)",
                            receiptUrl ? "rgba(255,255,255,0.08)" : "rgba(91,184,255,0.25)"
                          ),
                          cursor: "pointer",
                        }}
                      >
                        <Paperclip size={13} />
                      </label>
                      {receiptUrl && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onRemoveReceipt(mo.key); }}
                          title="Remove receipt"
                          style={receiptIconBtnStyle("#f87171", "rgba(248,113,113,0.08)", "rgba(248,113,113,0.25)")}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ModalShell>
  );
}

function receiptIconBtnStyle(color, bg, border) {
  return {
    width: 27, height: 27, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
    color, background: bg, border: `1px solid ${border}`, flexShrink: 0,
  };
}

function SummaryRow({ icon, label, value, color }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "13px 14px", borderRadius: 11, background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.05)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#8b93a7" }}>
        {React.cloneElement(icon, { color: "#5b6478" })}
        <span style={{ fontSize: 14, color: "#c3cadb", fontWeight: 500 }}>{label}</span>
      </div>
      <span style={{ fontSize: 15.5, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

function ExportModal({ onClose, onExportMembers, onExportPayments, receiptCount, onDeleteAllReceipts }) {
  return (
    <ModalShell onClose={onClose}>
      <div style={{ padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: "#f4f6fb" }}>Export Data</span>
          <button onClick={onClose} style={closeBtnStyle}><X size={18} color="#8b93a7" /></button>
        </div>
        <div style={{ fontSize: 13, color: "#8b93a7", marginBottom: 20, lineHeight: 1.5 }}>
          Downloads a CSV file you can open in Excel, Google Sheets, or Numbers.
        </div>

        <button
          onClick={onExportMembers}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 16,
            borderRadius: 13, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            color: "#f4f6fb", cursor: "pointer", marginBottom: 10, textAlign: "left",
          }}
        >
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(91,184,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Users size={16} color="#5bb8ff" />
          </div>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Members Summary</div>
            <div style={{ fontSize: 12, color: "#5b6478", marginTop: 1 }}>Shares, dues, late fees, equity — one row per member</div>
          </div>
        </button>

        <button
          onClick={onExportPayments}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 16,
            borderRadius: 13, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            color: "#f4f6fb", cursor: "pointer", textAlign: "left", marginBottom: 22,
          }}
        >
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(52,211,153,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Receipt size={16} color="#34d399" />
          </div>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Payments Tracker</div>
            <div style={{ fontSize: 12, color: "#5b6478", marginTop: 1 }}>Full 12-month grid with totals</div>
          </div>
        </button>

        <div style={{ height: 1, background: "rgba(255,255,255,0.07)", marginBottom: 18 }} />

        <div style={{ fontSize: 11, letterSpacing: 0.6, color: "#8b93a7", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
          Danger Zone
        </div>
        <button
          onClick={onDeleteAllReceipts}
          disabled={receiptCount === 0}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 16,
            borderRadius: 13, background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.25)",
            color: receiptCount === 0 ? "#5b6478" : "#f87171", cursor: receiptCount === 0 ? "default" : "pointer",
            textAlign: "left", opacity: receiptCount === 0 ? 0.6 : 1,
          }}
        >
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(248,113,113,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Trash2 size={16} color="#f87171" />
          </div>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Delete All Receipts</div>
            <div style={{ fontSize: 12, color: "#8b93a7", marginTop: 1 }}>
              {receiptCount === 0 ? "No receipts uploaded yet" : `Permanently removes all ${receiptCount} uploaded file${receiptCount === 1 ? "" : "s"}`}
            </div>
          </div>
        </button>
      </div>
    </ModalShell>
  );
}

function ConfirmDeleteAllReceiptsModal({ count, onClose, onConfirm }) {
  return (
    <ModalShell onClose={onClose}>
      <div style={{ padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(248,113,113,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Trash2 size={18} color="#f87171" />
          </div>
          <span style={{ fontSize: 17, fontWeight: 800, color: "#f4f6fb" }}>Delete All Receipts?</span>
        </div>
        <div style={{ fontSize: 14, color: "#8b93a7", marginBottom: 22, lineHeight: 1.5 }}>
          This will permanently delete all <strong style={{ color: "#f4f6fb" }}>{count}</strong> uploaded receipt
          file{count === 1 ? "" : "s"} and clear the attachment from every payment record. Payment amounts
          themselves are <strong style={{ color: "#f4f6fb" }}>not affected</strong> — only the receipt files.
          This can't be undone.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} className="bff-secondarybtn">Cancel</button>
          <button onClick={onConfirm} className="bff-dangerbtn">Delete All</button>
        </div>
      </div>
    </ModalShell>
  );
}

function AdminLoginModal({ onClose, onSuccess }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  const submit = () => {
    if (pin === ADMIN_PIN) onSuccess();
    else { setError(true); setPin(""); }
  };

  return (
    <ModalShell onClose={onClose}>
      <div style={{ padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(91,184,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <KeyRound size={18} color="#5bb8ff" />
            </div>
            <span style={{ fontSize: 17, fontWeight: 800, color: "#f4f6fb" }}>Admin Access</span>
          </div>
          <button onClick={onClose} style={closeBtnStyle}><X size={18} color="#8b93a7" /></button>
        </div>
        <div style={{ fontSize: 13, color: "#8b93a7", marginBottom: 16 }}>Enter the admin PIN to unlock editing.</div>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setError(false); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="• • • • •"
          style={{ ...inputStyle, textAlign: "center", fontSize: 22, letterSpacing: 8, marginBottom: error ? 8 : 18 }}
        />
        {error && <div style={{ color: "#f87171", fontSize: 12.5, marginBottom: 14 }}>Incorrect PIN. Please try again.</div>}
        <button onClick={submit} className="bff-primarybtn">Unlock Admin Mode</button>
      </div>
    </ModalShell>
  );
}

function AddMemberModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [shares, setShares] = useState("1");

  const submit = () => {
    const trimmed = name.trim();
    const sh = parseInt(shares, 10);
    if (!trimmed || !sh || sh < 1) return;
    onSave(trimmed, sh);
  };

  return (
    <ModalShell onClose={onClose}>
      <div style={{ padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: "#f4f6fb" }}>Add Member</span>
          <button onClick={onClose} style={closeBtnStyle}><X size={18} color="#8b93a7" /></button>
        </div>
        <label style={labelStyle}>Full Name</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rafiq" style={{ ...inputStyle, marginBottom: 16 }} />
        <label style={labelStyle}>Share Allocation</label>
        <input
          type="number" min="1" value={shares}
          onChange={(e) => setShares(e.target.value)}
          style={{ ...inputStyle, marginBottom: 22 }}
        />
        <button onClick={submit} className="bff-primarybtn">Add to Fund</button>
      </div>
    </ModalShell>
  );
}

function AddNoticeModal({ members, onClose, onSave }) {
  const [message, setMessage] = useState("");
  const [mentionedId, setMentionedId] = useState("");

  const submit = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    onSave(trimmed, mentionedId ? parseInt(mentionedId, 10) : null);
  };

  return (
    <ModalShell onClose={onClose}>
      <div style={{ padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: "#f4f6fb" }}>Post Notice</span>
          <button onClick={onClose} style={closeBtnStyle}><X size={18} color="#8b93a7" /></button>
        </div>

        <label style={labelStyle}>Message</label>
        <textarea
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. Please clear your September dues by the 25th."
          rows={4}
          style={{ ...inputStyle, marginBottom: 16, resize: "vertical", fontFamily: "inherit" }}
        />

        <label style={labelStyle}>Mention a member (optional)</label>
        <select
          value={mentionedId}
          onChange={(e) => setMentionedId(e.target.value)}
          style={{ ...inputStyle, marginBottom: 22 }}
        >
          <option value="">No one specific</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>

        <button onClick={submit} className="bff-primarybtn">Post Notice</button>
      </div>
    </ModalShell>
  );
}

function ConfirmDeleteNoticeModal({ onClose, onConfirm }) {
  return (
    <ModalShell onClose={onClose}>
      <div style={{ padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(248,113,113,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Trash2 size={18} color="#f87171" />
          </div>
          <span style={{ fontSize: 17, fontWeight: 800, color: "#f4f6fb" }}>Remove Notice</span>
        </div>
        <div style={{ fontSize: 14, color: "#8b93a7", marginBottom: 22, lineHeight: 1.5 }}>
          Remove this notice for everyone? This can't be undone.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} className="bff-secondarybtn">Cancel</button>
          <button onClick={onConfirm} className="bff-dangerbtn">Remove</button>
        </div>
      </div>
    </ModalShell>
  );
}

function ConfirmDeleteModal({ member, onClose, onConfirm }) {
  return (
    <ModalShell onClose={onClose}>
      <div style={{ padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(248,113,113,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Trash2 size={18} color="#f87171" />
          </div>
          <span style={{ fontSize: 17, fontWeight: 800, color: "#f4f6fb" }}>Remove Member</span>
        </div>
        <div style={{ fontSize: 14, color: "#8b93a7", marginBottom: 22, lineHeight: 1.5 }}>
          Remove <strong style={{ color: "#f4f6fb" }}>{member.name}</strong> and all of their payment history from the fund? This can't be undone.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} className="bff-secondarybtn">Cancel</button>
          <button onClick={onConfirm} className="bff-dangerbtn">Remove</button>
        </div>
      </div>
    </ModalShell>
  );
}

function EditNumberModal({ title, label, initial, onClose, onSave, allowClear }) {
  const [val, setVal] = useState(String(initial ?? 0));

  const submit = () => {
    const n = parseFloat(val);
    onSave(isNaN(n) ? 0 : n);
  };

  return (
    <ModalShell onClose={onClose}>
      <div style={{ padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: "#f4f6fb" }}>{title}</span>
          <button onClick={onClose} style={closeBtnStyle}><X size={18} color="#8b93a7" /></button>
        </div>
        <label style={labelStyle}>{label}</label>
        <input
          type="number" autoFocus value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          style={{ ...inputStyle, marginBottom: 22 }}
        />
        <div style={{ display: "flex", gap: 10 }}>
          {allowClear && <button onClick={() => onSave(0)} className="bff-secondarybtn">Clear</button>}
          <button onClick={submit} className="bff-primarybtn">Save</button>
        </div>
      </div>
    </ModalShell>
  );
}

function NavBtn({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
        padding: "12px 0", background: "transparent", border: "none", cursor: "pointer",
        color: active ? "#5bb8ff" : "#5b6478",
      }}
    >
      {icon}
      <span style={{ fontSize: 11.5, fontWeight: 700 }}>{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                                */
/* ------------------------------------------------------------------ */

const rootStyle = {
  minHeight: "100vh", background: "#05070d",
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  color: "#f4f6fb", position: "relative",
};

const navWrapStyle = {
  position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "center",
  padding: "0 16px 18px", zIndex: 50, pointerEvents: "none",
};

const navBarStyle = {
  pointerEvents: "auto", width: "100%", maxWidth: 448, display: "flex",
  background: "rgba(13,17,26,0.92)", backdropFilter: "blur(14px)",
  border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20,
  boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
};

const closeBtnStyle = {
  width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer",
};

const inputStyle = {
  width: "100%", padding: "13px 14px", borderRadius: 11, background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.1)", color: "#f4f6fb", fontSize: 15, outline: "none",
  boxSizing: "border-box",
};

const labelStyle = {
  display: "block", fontSize: 12, color: "#8b93a7", fontWeight: 600, marginBottom: 7,
};

const toastStyle = {
  position: "fixed", bottom: 96, left: "50%", transform: "translateX(-50%)",
  background: "#111726", border: "1px solid rgba(52,211,153,0.35)", borderRadius: 12,
  padding: "10px 18px", display: "flex", alignItems: "center", gap: 8,
  fontSize: 13.5, fontWeight: 600, color: "#f4f6fb", zIndex: 200,
  boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
};

function GlobalStyle() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      input::placeholder { color: #4a5166; }
      input[type=number]::-webkit-inner-spin-button { opacity: 0.4; }
      .bff-card {
        background: rgba(255,255,255,0.025);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 16px;
      }
      .bff-pillbtn {
        display: flex; align-items: center; gap: 6px;
        padding: 9px 16px; border-radius: 999px; font-size: 13px; font-weight: 700;
        cursor: pointer;
      }
      .bff-addbtn {
        display: flex; align-items: center; gap: 6px;
        padding: 0 18px; border-radius: 13px; font-size: 14px; font-weight: 700;
        background: linear-gradient(155deg, #5bb8ff, #2f7fe0); color: #04121f; border: none;
        cursor: pointer; box-shadow: 0 0 16px rgba(77,166,255,0.3);
      }
      .bff-editbtn {
        padding: 10px 16px; border-radius: 11px; font-size: 13px; font-weight: 700;
        background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.35); color: #f87171;
        cursor: pointer; white-space: nowrap; display: flex; align-items: center;
      }
      .bff-primarybtn {
        width: 100%; padding: 14px; border-radius: 12px; border: none; font-size: 15px; font-weight: 700;
        background: linear-gradient(155deg, #5bb8ff, #2f7fe0); color: #04121f; cursor: pointer;
      }
      .bff-secondarybtn {
        flex: 1; padding: 14px; border-radius: 12px; font-size: 15px; font-weight: 700;
        background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #c3cadb; cursor: pointer;
      }
      .bff-dangerbtn {
        flex: 1; padding: 14px; border-radius: 12px; font-size: 15px; font-weight: 700;
        background: rgba(248,113,113,0.14); border: 1px solid rgba(248,113,113,0.4); color: #f87171; cursor: pointer;
      }
      .bff-live-dot {
        width: 6px; height: 6px; border-radius: 50%; background: #34d399; display: inline-block;
        box-shadow: 0 0 0 0 rgba(52,211,153,0.6);
        animation: bff-pulse 1.6s infinite;
      }
      @keyframes bff-pulse {
        0% { box-shadow: 0 0 0 0 rgba(52,211,153,0.6); }
        70% { box-shadow: 0 0 0 6px rgba(52,211,153,0); }
        100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); }
      }
      ::-webkit-scrollbar { height: 6px; width: 6px; }
      ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 999px; }
    `}</style>
  );
}
