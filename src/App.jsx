import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Shield, Lock, ShieldCheck, AlertTriangle, Clock, Layers, Target,
  Wallet, Search, UserPlus, Trash2, X, Check, TrendingUp,
  LayoutGrid, Users, Receipt, Pencil, ChevronRight, Activity, KeyRound, Wrench,
  Megaphone, AtSign, Plus, History, Bell, BellOff, Download, Paperclip, Eye,
  Calculator, PieChart as PieChartIcon, Coins, TrendingDown, FileText, Settings2, Landmark
} from "lucide-react";
import {
  AreaChart, Area, LineChart, Line, PieChart, Pie, Cell, Legend, ReferenceLine,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from "recharts";
import { supabase } from "./supabaseClient";
import jsPDF from "jspdf";

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

/* ---------------- PDF statement ---------------- */

function generateMemberStatementPDF(member, stats, payments) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  let y = 60;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(20, 24, 34);
  doc.text("Brotherhood Future Fund", margin, y);
  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 105, 120);
  doc.text("Sep 2026 — Aug 2027 Cycle · Member Statement", margin, y);
  y += 30;

  doc.setDrawColor(220, 220, 225);
  doc.line(margin, y, pageWidth - margin, y);
  y += 24;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(20, 24, 34);
  doc.text(member.name, margin, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(100, 105, 120);
  doc.text(`${member.shares} shares · ${stats.ownership.toFixed(1)}% ownership`, margin, y);
  y += 12;
  doc.text(`Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, margin, y);
  y += 30;

  const summaryRows = [
    ["Expected Due", fmt(stats.expectedDue)],
    ["Total Received", fmt(stats.paidPrincipal)],
    ["Pending Due", fmt(stats.pendingDue)],
    ["Late Fees", fmt(stats.lateFee)],
    ["Maintenance Fee (excl. from equity)", fmt(stats.maintenanceFeeCollected)],
    ["Current Equity", fmtSigned(stats.equity)],
  ];

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 24, 34);
  doc.text("Equity & Payment Summary", margin, y);
  y += 16;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  summaryRows.forEach(([label, value]) => {
    doc.setTextColor(90, 95, 110);
    doc.text(label, margin, y);
    doc.setTextColor(20, 24, 34);
    doc.text(value, pageWidth - margin, y, { align: "right" });
    y += 18;
  });

  y += 12;
  doc.setDrawColor(220, 220, 225);
  doc.line(margin, y, pageWidth - margin, y);
  y += 24;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 24, 34);
  doc.text("12-Month Payment History", margin, y);
  y += 18;

  doc.setFontSize(10);
  MONTHS.forEach((mo) => {
    const val = payments[mo.key] || 0;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(90, 95, 110);
    doc.text(`${mo.label} ${mo.year}`, margin, y);
    doc.setFont("helvetica", val > 0 ? "normal" : "italic");
    doc.setTextColor(val > 0 ? 20 : 150, val > 0 ? 24 : 150, val > 0 ? 34 : 155);
    doc.text(val > 0 ? fmt(val) : "Not Paid", pageWidth - margin, y, { align: "right" });
    y += 17;
  });

  y += 20;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  doc.setTextColor(140, 145, 155);
  doc.text("Generated from the Brotherhood Future Fund live tracker. For record-keeping purposes.", margin, y);

  doc.save(`${member.name.replace(/\s+/g, "-")}-statement-${todayStamp()}.pdf`);
}

/* ---------------- Wealth Lab helpers ---------------- */

const GRAMS_PER_BHORI = 11.664;
const PURITY_OPTIONS = [
  { key: "rate_22k", label: "22K" },
  { key: "rate_21k", label: "21K" },
  { key: "rate_18k", label: "18K" },
  { key: "rate_traditional", label: "Traditional" },
];

// Bangladeshi lakh-style comma grouping (e.g. ৳10,00,000), used only within
// Wealth Lab per the large round figures discussed there — the rest of the
// app keeps its existing international comma format (৳1,000,000).
function fmtLakh(n) {
  const num = Math.round(n || 0);
  const isNeg = num < 0;
  const s = Math.abs(num).toString();
  let result;
  if (s.length <= 3) {
    result = s;
  } else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    result = grouped + "," + last3;
  }
  return (isNeg ? "-" : "") + "\u09F3" + result;
}

function gramsToDisplay(grams, unit) {
  if (unit === "bhori") return (grams / GRAMS_PER_BHORI).toFixed(2) + " bhori";
  return grams.toFixed(2) + " g";
}

// Finds the most recent gold_rates entry on or before the given date for a purity.
// Rates must be sorted ascending by rate_date before calling this.
function findRateOnOrBefore(sortedRates, dateStr, purityKey) {
  let found = null;
  for (const r of sortedRates) {
    if (r.rate_date <= dateStr && r[purityKey] != null) found = r;
    if (r.rate_date > dateStr) break;
  }
  return found;
}

function findLatestRate(sortedRates, purityKey) {
  for (let i = sortedRates.length - 1; i >= 0; i--) {
    if (sortedRates[i][purityKey] != null) return sortedRates[i];
  }
  return null;
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
  const [goldRates, setGoldRates] = useState([]);
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
    const [membersRes, paymentsRes, lateFeesRes, noticesRes, activityRes, goldRatesRes] = await Promise.all([
      supabase.from("members").select("*").order("id"),
      supabase.from("payments").select("*"),
      supabase.from("late_fees").select("*"),
      supabase.from("notices").select("*").order("created_at", { ascending: false }),
      supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("gold_rates").select("*").order("rate_date", { ascending: true }),
    ]);

    if (membersRes.error || paymentsRes.error || lateFeesRes.error || noticesRes.error || activityRes.error || goldRatesRes.error) {
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
      goldRates: goldRatesRes.data || [],
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
        setGoldRates(d.goldRates);
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
        setGoldRates(d.goldRates);
      }
    };

    const channel = supabase
      .channel("bff-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "members" }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "late_fees" }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "notices" }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_log" }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "gold_rates" }, refetch)
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

  const doSaveGoldRate = async (dateStr, rateValues) => {
    const { error } = await supabase
      .from("gold_rates")
      .upsert({ rate_date: dateStr, ...rateValues }, { onConflict: "rate_date" });
    if (error) { showToast("Couldn't save gold rate"); return; }
    showToast("Gold rate saved");
    logActivity(`Logged gold rate for ${dateStr}`);
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

        {tab === "wealthlab" && (
          <WealthLabTab
            members={members}
            statsById={statsById}
            collectedPrincipal={collectedPrincipal}
            totalPendingDues={totalPendingDues}
            totalShares={totalShares}
            monthlyTotals={monthlyTotals}
            goldRates={goldRates}
            isAdmin={isAdmin}
            onSaveGoldRate={doSaveGoldRate}
          />
        )}
      </div>

      <div style={navWrapStyle}>
        <div style={navBarStyle}>
          <NavBtn active={tab === "overview"} onClick={() => setTab("overview")} icon={<LayoutGrid size={18} />} label="Overview" />
          <NavBtn active={tab === "members"} onClick={() => setTab("members")} icon={<Users size={18} />} label="Members" />
          <NavBtn active={tab === "payments"} onClick={() => setTab("payments")} icon={<Receipt size={18} />} label="Payments" />
          <NavBtn active={tab === "wealthlab"} onClick={() => setTab("wealthlab")} icon={<Coins size={18} />} label="Wealth" />
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

function CumulativeGrowthChart({ monthlyTotals, totalShares }) {
  let running = 0;
  const data = MONTHS.map((mo, i) => {
    running += monthlyTotals[i]?.value || 0;
    return {
      name: mo.label,
      Actual: running,
      Target: totalShares * ratesSumUpTo(i + 1),
    };
  });

  return (
    <div className="bff-card" style={{ padding: "18px 10px 8px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", marginBottom: 6 }}>
        <TrendingUp size={15} color="#5bb8ff" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#f4f6fb" }}>Cumulative Growth</span>
      </div>
      <div style={{ padding: "0 10px", marginBottom: 4, fontSize: 11.5, color: "#5b6478" }}>
        What's actually been collected vs. what full on-time payment would look like.
      </div>
      <div style={{ height: 190 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "#5b6478", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip
              formatter={(v, name) => [fmt(v), name]}
              contentStyle={{ background: "#0b0f18", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }}
              labelStyle={{ color: "#8b93a7" }}
            />
            <Legend wrapperStyle={{ fontSize: 11.5, color: "#8b93a7" }} iconType="plainline" iconSize={14} />
            <ReferenceLine x={MONTHS[5].label} stroke="rgba(245,185,66,0.5)" strokeDasharray="3 3"
              label={{ value: "6-Mo", position: "top", fill: "#f5b942", fontSize: 10 }} />
            <ReferenceLine x={MONTHS[11].label} stroke="rgba(52,211,153,0.5)" strokeDasharray="3 3"
              label={{ value: "Year-End", position: "top", fill: "#34d399", fontSize: 10 }} />
            <Line type="monotone" dataKey="Actual" stroke="#5bb8ff" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="Target" stroke="#5b6478" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function FundAllocationChart({ collectedPrincipal, totalPendingDues }) {
  const total = collectedPrincipal + totalPendingDues;
  const data = [
    { name: "Collected", value: collectedPrincipal, color: "#34d399" },
    { name: "Pending", value: totalPendingDues, color: "#f5b942" },
  ];

  return (
    <div className="bff-card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <PieChartIcon size={15} color="#5bb8ff" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#f4f6fb" }}>Fund Allocation</span>
      </div>
      {total === 0 ? (
        <div style={{ fontSize: 13, color: "#5b6478", padding: "6px 2px" }}>No dues recorded yet.</div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 130, height: 130, flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={38} outerRadius={62} paddingAngle={3} stroke="none">
                  {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip
                  formatter={(v, name) => [fmt(v), name]}
                  contentStyle={{ background: "#0b0f18", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
            {data.map((d) => (
              <div key={d.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, display: "inline-block" }} />
                  <span style={{ fontSize: 12.5, color: "#c3cadb" }}>{d.name}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#f4f6fb" }}>{fmt(d.value)}</div>
                  <div style={{ fontSize: 11, color: "#5b6478" }}>{total > 0 ? ((d.value / total) * 100).toFixed(1) : "0.0"}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectionsCalculator({ totalShares }) {
  const [sharesInput, setSharesInput] = useState("");
  const [yearsInput, setYearsInput] = useState("1");

  const shares = parseFloat(sharesInput) || 0;
  const years = parseFloat(yearsInput) || 0;
  const totalContribution = shares * years * (12 * BASE_RATE + SEP_MAINTENANCE);
  const maintenancePortion = shares * years * SEP_MAINTENANCE;
  const projectedEquity = totalContribution - maintenancePortion;
  const ownership = totalShares > 0 ? (shares / totalShares) * 100 : 0;
  const hasInput = shares > 0 && years > 0;

  return (
    <div className="bff-card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Calculator size={15} color="#5bb8ff" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#f4f6fb" }}>Projections Calculator</span>
      </div>
      <div style={{ fontSize: 11.5, color: "#5b6478", marginBottom: 16, lineHeight: 1.4 }}>
        A savings projection, not investment growth — this fund pays back what's contributed, plus any
        share of the penalty pool (which can't be predicted in advance).
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>Shares</label>
          <input
            type="number" min="0" placeholder="e.g. 2" value={sharesInput}
            onChange={(e) => setSharesInput(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Years</label>
          <input
            type="number" min="0" step="1" value={yearsInput}
            onChange={(e) => setYearsInput(e.target.value)}
            style={inputStyle}
          />
        </div>
      </div>

      {hasInput ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ProjectionRow label="Total Contribution Required" value={fmt(totalContribution)} />
          <ProjectionRow label="Projected Equity (excl. penalty pool)" value={fmt(projectedEquity)} highlight />
          <ProjectionRow label="Ownership Share" value={`${ownership.toFixed(1)}%`} />
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: "#5b6478", textAlign: "center", padding: "10px 0" }}>
          Enter shares and years to see a projection.
        </div>
      )}
    </div>
  );
}

function ProjectionRow({ label, value, highlight }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 14px", borderRadius: 11,
      background: highlight ? "rgba(91,184,255,0.06)" : "rgba(255,255,255,0.02)",
      border: highlight ? "1px solid rgba(91,184,255,0.25)" : "1px solid rgba(255,255,255,0.05)",
    }}>
      <span style={{ fontSize: 13, color: "#8b93a7", fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 700, color: highlight ? "#5bb8ff" : "#f4f6fb" }}>{value}</span>
    </div>
  );
}

/* ==================================================================== */
/* WEALTH LAB                                                            */
/* ==================================================================== */

function WealthLabTab({
  members, statsById, collectedPrincipal, totalPendingDues, totalShares,
  monthlyTotals, goldRates, isAdmin, onSaveGoldRate,
}) {
  const latest22k = findLatestRate(goldRates, "rate_22k");
  const currentRatePerGram = latest22k ? Number(latest22k.rate_22k) : null;

  return (
    <div style={{ padding: "12px 16px 0" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#f4f6fb", marginBottom: 3 }}>Wealth Lab</div>
        <div style={{ fontSize: 12.5, color: "#5b6478", lineHeight: 1.4 }}>
          Planning and projection tools. Everything below is exploratory — it doesn't change any
          real balances in the fund.
        </div>
      </div>

      {isAdmin && (
        <GoldRateAdminPanel currentRate={currentRatePerGram} lastUpdated={latest22k?.rate_date} onSave={onSaveGoldRate} />
      )}

      <GoldProjectionSimulator currentRatePerGram={currentRatePerGram} />

      <CumulativeGrowthChart monthlyTotals={monthlyTotals} totalShares={totalShares} />

      <FundAllocationChart collectedPrincipal={collectedPrincipal} totalPendingDues={totalPendingDues} />

      <AssetStrategyComparison members={members} totalShares={totalShares} />

      <StoreLeaseRentCalculator members={members} totalShares={totalShares} />

      <ProjectionsCalculator totalShares={totalShares} />

      <MonthComparisonStat monthlyTotals={monthlyTotals} />
    </div>
  );
}

function WealthSectionHeader({ icon, title, subtitle }) {
  return (
    <div style={{ marginBottom: subtitle ? 4 : 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: subtitle ? 4 : 0 }}>
        {icon}
        <span style={{ fontSize: 13, fontWeight: 700, color: "#f4f6fb" }}>{title}</span>
      </div>
      {subtitle && <div style={{ fontSize: 11.5, color: "#5b6478", marginBottom: 12, lineHeight: 1.4 }}>{subtitle}</div>}
    </div>
  );
}

/* ---------------- 1. Admin gold rate baseline ---------------- */

function GoldRateAdminPanel({ currentRate, lastUpdated, onSave }) {
  const [unit, setUnit] = useState("gram");
  const [value, setValue] = useState("");

  const submit = () => {
    const v = parseFloat(value);
    if (!v || v <= 0) return;
    const perGram = unit === "bhori" ? v / GRAMS_PER_BHORI : v;
    onSave(todayStamp(), { rate_22k: Math.round(perGram * 100) / 100 });
    setValue("");
  };

  return (
    <div className="bff-card" style={{ padding: 18, marginBottom: 16, border: "1px solid rgba(234,179,8,0.25)" }}>
      <WealthSectionHeader icon={<Settings2 size={15} color="#eab308" />} title="Admin: Set 22K Gold Rate" />
      <div style={{ fontSize: 11.5, color: "#5b6478", marginBottom: 14, lineHeight: 1.4 }}>
        Manually entered — there's no reliable live feed for local Bangladesh gold rates, so log
        today's rate here whenever it changes.
      </div>

      {currentRate != null && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px", borderRadius: 10, background: "rgba(234,179,8,0.06)",
          border: "1px solid rgba(234,179,8,0.2)", marginBottom: 14,
        }}>
          <span style={{ fontSize: 12, color: "#8b93a7" }}>Current rate ({lastUpdated})</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#eab308" }}>
            {fmt(currentRate)}/g · {fmt(currentRate * GRAMS_PER_BHORI)}/bhori
          </span>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="number" min="0" placeholder={unit === "bhori" ? "BDT per bhori" : "BDT per gram"}
          value={value} onChange={(e) => setValue(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        />
        <div style={{ display: "flex", borderRadius: 11, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
          {["gram", "bhori"].map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              style={{
                padding: "0 14px", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                background: unit === u ? "rgba(91,184,255,0.15)" : "transparent",
                color: unit === u ? "#5bb8ff" : "#8b93a7",
              }}
            >
              {u === "gram" ? "g" : "bhori"}
            </button>
          ))}
        </div>
      </div>
      <button onClick={submit} className="bff-primarybtn" style={{ marginTop: 12 }}>Save Today's Rate</button>
    </div>
  );
}

/* ---------------- 2. Gold Projection Simulator ---------------- */

const HOLDING_PRESETS = [6, 12, 18, 24, 30, 36];
const DEFAULT_SCENARIOS = [
  { key: "conservative", label: "Conservative", rate: 15, color: "#5bb8ff" },
  { key: "average", label: "Historical Average", rate: 20, color: "#34d399" },
  { key: "high", label: "High Growth", rate: 25, color: "#eab308" },
];

function GoldProjectionSimulator({ currentRatePerGram }) {
  const [amountInput, setAmountInput] = useState("");
  const [months, setMonths] = useState(12);
  const [customMonths, setCustomMonths] = useState("");
  const [scenarioRates, setScenarioRates] = useState(
    Object.fromEntries(DEFAULT_SCENARIOS.map((s) => [s.key, String(s.rate)]))
  );
  const [targetPriceInput, setTargetPriceInput] = useState("");
  const [targetUnit, setTargetUnit] = useState("gram");

  const amount = parseFloat(amountInput) || 0;
  const effectiveMonths = customMonths ? parseFloat(customMonths) || 0 : months;
  const years = effectiveMonths / 12;
  const hasRate = currentRatePerGram != null && currentRatePerGram > 0;
  const weightGrams = hasRate && amount > 0 ? amount / currentRatePerGram : 0;

  const targetPriceRaw = parseFloat(targetPriceInput) || 0;
  const targetPricePerGram = targetUnit === "bhori" ? targetPriceRaw / GRAMS_PER_BHORI : targetPriceRaw;
  const hasTarget = targetPriceRaw > 0 && weightGrams > 0;
  const liquidationValue = hasTarget ? weightGrams * targetPricePerGram : 0;
  const targetProfit = liquidationValue - amount;
  const targetRoi = amount > 0 ? (targetProfit / amount) * 100 : 0;
  const requiredCAGR = hasTarget && years > 0 && currentRatePerGram > 0
    ? (Math.pow(targetPricePerGram / currentRatePerGram, 1 / years) - 1) * 100
    : null;

  return (
    <div className="bff-card" style={{ padding: 18, marginBottom: 16 }}>
      <WealthSectionHeader
        icon={<Coins size={15} color="#eab308" />}
        title="Gold Projection Simulator"
        subtitle="A what-if planning tool, not a guarantee — actual gold prices can rise or fall. Growth rates below are editable estimates, not verified market data."
      />

      {!hasRate ? (
        <div style={{ fontSize: 12.5, color: "#5b6478", padding: "10px 0", textAlign: "center" }}>
          Waiting for admin to log today's gold rate.
        </div>
      ) : (
        <>
          <label style={labelStyle}>Investment Amount (৳)</label>
          <input
            type="number" min="0" placeholder="e.g. 100000" value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            style={{ ...inputStyle, marginBottom: 14 }}
          />

          <label style={labelStyle}>Holding Period</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {HOLDING_PRESETS.map((m) => (
              <button
                key={m}
                onClick={() => { setMonths(m); setCustomMonths(""); }}
                style={{
                  padding: "7px 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                  background: !customMonths && months === m ? "rgba(91,184,255,0.15)" : "rgba(255,255,255,0.03)",
                  border: !customMonths && months === m ? "1px solid rgba(91,184,255,0.4)" : "1px solid rgba(255,255,255,0.08)",
                  color: !customMonths && months === m ? "#5bb8ff" : "#9aa3b8",
                }}
              >
                {m}mo
              </button>
            ))}
          </div>
          <input
            type="number" min="1" placeholder="or type a custom number of months"
            value={customMonths} onChange={(e) => setCustomMonths(e.target.value)}
            style={{ ...inputStyle, marginBottom: 16, fontSize: 13 }}
          />

          {amount > 0 && (
            <>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "12px 14px", borderRadius: 11, background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)", marginBottom: 14,
              }}>
                <span style={{ fontSize: 12.5, color: "#8b93a7" }}>Gold purchased today</span>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#f4f6fb" }}>{weightGrams.toFixed(2)}g</span>
                  <span style={{ fontSize: 12, color: "#5b6478" }}>({(weightGrams / GRAMS_PER_BHORI).toFixed(2)} bhori)</span>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                {DEFAULT_SCENARIOS.map((sc) => {
                  const rate = (parseFloat(scenarioRates[sc.key]) || 0) / 100;
                  const futurePrice = currentRatePerGram * Math.pow(1 + rate, years);
                  const futureValue = weightGrams * futurePrice;
                  const profit = futureValue - amount;
                  const roi = amount > 0 ? (profit / amount) * 100 : 0;
                  return (
                    <div key={sc.key} style={{
                      padding: 14, borderRadius: 12, background: "rgba(255,255,255,0.02)",
                      border: `1px solid ${sc.color}33`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: sc.color }}>{sc.label}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 12, color: sc.color, fontWeight: 700 }}>+</span>
                          <input
                            type="number" step="0.5" value={scenarioRates[sc.key]}
                            onChange={(e) => setScenarioRates((prev) => ({ ...prev, [sc.key]: e.target.value }))}
                            style={{
                              width: 46, textAlign: "right", background: "rgba(255,255,255,0.05)",
                              border: `1px solid ${sc.color}55`, borderRadius: 6, color: sc.color,
                              fontSize: 12, fontWeight: 700, padding: "3px 4px", outline: "none",
                            }}
                          />
                          <span style={{ fontSize: 11, color: "#5b6478" }}>%/yr</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <MiniStatRow label="Projected gold price/g" value={fmt(futurePrice)} />
                        <MiniStatRow label="Total projected value" value={fmt(futureValue)} />
                        <MiniStatRow
                          label="Net profit / ROI"
                          value={`${fmtSigned(profit)} (${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%)`}
                          valueColor={profit >= 0 ? "#34d399" : "#f87171"}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ height: 1, background: "rgba(255,255,255,0.07)", marginBottom: 18 }} />

              <div style={{ fontSize: 11.5, letterSpacing: 0.6, color: "#8b93a7", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
                Or Test Your Own Target Price
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <input
                  type="number" min="0" placeholder="Target Selling Price"
                  value={targetPriceInput} onChange={(e) => setTargetPriceInput(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <div style={{ display: "flex", borderRadius: 11, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
                  {["gram", "bhori"].map((u) => (
                    <button
                      key={u}
                      onClick={() => setTargetUnit(u)}
                      style={{
                        padding: "0 14px", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                        background: targetUnit === u ? "rgba(91,184,255,0.15)" : "transparent",
                        color: targetUnit === u ? "#5bb8ff" : "#8b93a7",
                      }}
                    >
                      {u === "gram" ? "g" : "bhori"}
                    </button>
                  ))}
                </div>
              </div>

              {hasTarget && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <ProjectionRow label="Total Liquidation Value" value={fmt(liquidationValue)} />
                  <ProjectionRow
                    label="Net Profit / Loss"
                    value={`${fmtSigned(targetProfit)} (${targetRoi >= 0 ? "+" : ""}${targetRoi.toFixed(1)}%)`}
                  />
                  <ProjectionRow
                    label="Required Annualized Growth"
                    value={requiredCAGR == null ? "N/A (need a holding period)" : `${requiredCAGR >= 0 ? "+" : ""}${requiredCAGR.toFixed(1)}%/yr`}
                    highlight
                  />
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function MiniStatRow({ label, value, valueColor }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontSize: 12, color: "#8b93a7" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: valueColor || "#f4f6fb" }}>{value}</span>
    </div>
  );
}
/* ---------------- 5. Asset Strategy Comparison (Cash vs Gold vs Store & Rent) ---------------- */

const YEAR_PRESETS = [1, 3, 5, 7, 10];

function AssetStrategyComparison({ members, totalShares }) {
  const [capitalInput, setCapitalInput] = useState("1500000");
  const [years, setYears] = useState(3);
  const [customYears, setCustomYears] = useState("");
  const [goldRateInput, setGoldRateInput] = useState("20");
  const [propAppreciationInput, setPropAppreciationInput] = useState("8");
  const [rentYieldInput, setRentYieldInput] = useState("10");
  const [memberId, setMemberId] = useState("");

  const capital = parseFloat(capitalInput) || 0;
  const T = customYears ? parseFloat(customYears) || 0 : years;
  const goldRate = (parseFloat(goldRateInput) || 0) / 100;
  const propRate = (parseFloat(propAppreciationInput) || 0) / 100;
  const rentYield = (parseFloat(rentYieldInput) || 0) / 100;

  // Option A — Cash in Vault
  const cashValue = capital;
  const cashProfit = 0;

  // Option B — 22K Gold Investment
  const goldValue = capital * Math.pow(1 + goldRate, T);
  const goldProfit = goldValue - capital;
  const goldRoi = capital > 0 ? (goldProfit / capital) * 100 : 0;

  // Option C — Commercial Store & Rent
  const rentCollected = capital * rentYield * T;
  const propertyValue = capital * Math.pow(1 + propRate, T);
  const storeCombinedValue = propertyValue + rentCollected;
  const storeProfit = storeCombinedValue - capital;
  const storeRoi = capital > 0 ? (storeProfit / capital) * 100 : 0;

  const member = members.find((m) => m.id === parseInt(memberId, 10));
  const memberOwnership = member && totalShares > 0 ? (member.shares / totalShares) * 100 : 0;
  const ownershipFrac = memberOwnership / 100;

  const hasInput = capital > 0 && T > 0;

  return (
    <div className="bff-card" style={{ padding: 18, marginBottom: 16 }}>
      <WealthSectionHeader
        icon={<Landmark size={15} color="#5bb8ff" />}
        title="Asset Strategy Comparison"
        subtitle="A hypothetical planning tool — the fund does not currently hold gold or property. Every rate below is an editable assumption."
      />

      <label style={labelStyle}>Total Investment Capital (৳)</label>
      <input
        type="number" min="0" value={capitalInput}
        onChange={(e) => setCapitalInput(e.target.value)}
        style={{ ...inputStyle, marginBottom: 14 }}
      />

      <label style={labelStyle}>Strategy Time Horizon (Years)</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {YEAR_PRESETS.map((y) => (
          <button
            key={y}
            onClick={() => { setYears(y); setCustomYears(""); }}
            style={{
              padding: "7px 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              background: !customYears && years === y ? "rgba(91,184,255,0.15)" : "rgba(255,255,255,0.03)",
              border: !customYears && years === y ? "1px solid rgba(91,184,255,0.4)" : "1px solid rgba(255,255,255,0.08)",
              color: !customYears && years === y ? "#5bb8ff" : "#9aa3b8",
            }}
          >
            {y} Yr
          </button>
        ))}
      </div>
      <input
        type="number" min="0" step="0.5" placeholder="or type a custom number of years"
        value={customYears} onChange={(e) => setCustomYears(e.target.value)}
        style={{ ...inputStyle, marginBottom: 16, fontSize: 13 }}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 18 }}>
        <div>
          <label style={{ ...labelStyle, fontSize: 10.5 }}>Gold Growth %/yr</label>
          <input type="number" step="0.5" value={goldRateInput} onChange={(e) => setGoldRateInput(e.target.value)} style={{ ...inputStyle, fontSize: 13, padding: "10px 10px" }} />
        </div>
        <div>
          <label style={{ ...labelStyle, fontSize: 10.5 }}>Property Growth %/yr</label>
          <input type="number" step="0.5" value={propAppreciationInput} onChange={(e) => setPropAppreciationInput(e.target.value)} style={{ ...inputStyle, fontSize: 13, padding: "10px 10px" }} />
        </div>
        <div>
          <label style={{ ...labelStyle, fontSize: 10.5 }}>Rent Yield %/yr</label>
          <input type="number" step="0.5" value={rentYieldInput} onChange={(e) => setRentYieldInput(e.target.value)} style={{ ...inputStyle, fontSize: 13, padding: "10px 10px" }} />
        </div>
      </div>

      {hasInput && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            <StrategyCard
              label="Option A — Cash in Vault" color="#5b6478"
              totalValue={cashValue} netProfit={cashProfit} roi={0}
            />
            <StrategyCard
              label="Option B — 22K Gold Investment" color="#eab308"
              totalValue={goldValue} netProfit={goldProfit} roi={goldRoi}
            />
            <StrategyCard
              label="Option C — Commercial Store & Rent" color="#34d399"
              totalValue={storeCombinedValue} netProfit={storeProfit} roi={storeRoi}
              extra={[
                { label: "Rent collected over term", value: fmt(rentCollected) },
                { label: "Property value at end of term", value: fmt(propertyValue) },
              ]}
            />
          </div>

          <div style={{ height: 1, background: "rgba(255,255,255,0.07)", marginBottom: 18 }} />

          <div style={{ fontSize: 11.5, letterSpacing: 0.6, color: "#8b93a7", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
            Personal Profit Calculator
          </div>
          <label style={labelStyle}>Select Member</label>
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)} style={{ ...inputStyle, marginBottom: 14 }}>
            <option value="">Choose a member...</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>

          {member && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{
                display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 999,
                background: "rgba(100,116,139,0.15)", border: "1px solid rgba(100,116,139,0.4)",
              }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#94a3b8" }}>
                  {member.shares} shares · {memberOwnership.toFixed(2)}% ownership
                </span>
              </div>

              <MetricRow label="Cash Vault Equity" value={fmt(ownershipFrac * cashValue)} color="#9CA3AF" />

              <div style={{ padding: 12, borderRadius: 11, background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.3)", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11, letterSpacing: 0.5, color: "#F59E0B", fontWeight: 700, textTransform: "uppercase" }}>Gold Strategy</div>
                <MetricRow label="Equity" value={fmt(ownershipFrac * goldValue)} color="#F59E0B" />
                <MetricRow label="Net Profit" value={fmtSigned(ownershipFrac * goldProfit)} color={ownershipFrac * goldProfit >= 0 ? "#22C55E" : "#f87171"} />
              </div>

              <div style={{ padding: 12, borderRadius: 11, background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.3)", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11, letterSpacing: 0.5, color: "#10B981", fontWeight: 700, textTransform: "uppercase" }}>Store Strategy</div>
                <MetricRow label="Equity" value={fmt(ownershipFrac * storeCombinedValue)} color="#10B981" />
                <MetricRow label="Net Profit" value={fmtSigned(ownershipFrac * storeProfit)} color={ownershipFrac * storeProfit >= 0 ? "#22C55E" : "#f87171"} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StrategyCard({ label, color, totalValue, netProfit, roi, extra }) {
  return (
    <div style={{ padding: 14, borderRadius: 12, background: "rgba(255,255,255,0.02)", border: `1px solid ${color}33` }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color, marginBottom: 10 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <MiniStatRow label="Total Value" value={fmt(totalValue)} />
        {extra && extra.map((e, i) => <MiniStatRow key={i} label={e.label} value={e.value} />)}
        <MiniStatRow
          label="Net Profit / ROI"
          value={`${fmtSigned(netProfit)} (${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%)`}
          valueColor={netProfit > 0 ? "#34d399" : netProfit < 0 ? "#f87171" : "#8b93a7"}
        />
      </div>
    </div>
  );
}

function MetricRow({ label, value, color, boxed }) {
  const content = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontSize: 12.5, color: "#8b93a7", fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 14.5, fontWeight: 700, color }}>{value}</span>
    </div>
  );
  if (!boxed) return content;
  return (
    <div style={{
      padding: "12px 14px", borderRadius: 11,
      background: `${color}0D`, border: `1px solid ${color}4D`,
    }}>
      {content}
    </div>
  );
}

/* ---------------- Store Lease & Rent Payout Calculator (standalone) ---------------- */

function StoreLeaseRentCalculator({ members, totalShares }) {
  const [storeValueInput, setStoreValueInput] = useState("6000000");
  const [monthlyRentInput, setMonthlyRentInput] = useState("50000");
  const [leaseTermInput, setLeaseTermInput] = useState("5");
  const [memberId, setMemberId] = useState("");

  const storeValue = parseFloat(storeValueInput) || 0;
  const totalMonthlyRent = parseFloat(monthlyRentInput) || 0;
  const leaseTerm = parseFloat(leaseTermInput) || 0;
  const impliedAnnualYield = storeValue > 0 ? ((totalMonthlyRent * 12) / storeValue) * 100 : 0;

  const member = members.find((m) => m.id === parseInt(memberId, 10));
  const ownershipPct = member && totalShares > 0 ? (member.shares / totalShares) * 100 : 0;
  const monthlyDividend = totalMonthlyRent * (ownershipPct / 100);
  const annualDividend = monthlyDividend * 12;
  const totalOverLease = annualDividend * leaseTerm;

  const hasInput = storeValue > 0 && totalMonthlyRent > 0;

  return (
    <div className="bff-card" style={{ padding: 18, marginBottom: 16 }}>
      <WealthSectionHeader
        icon={<Landmark size={15} color="#06B6D4" />}
        title="Store Lease & Monthly Rent Dividend"
        subtitle="A hypothetical planning tool — the fund does not currently own or lease this store."
      />

      <label style={labelStyle}>Store Purchase / Lease Value (৳)</label>
      <input
        type="number" min="0" placeholder="e.g. 6000000" value={storeValueInput}
        onChange={(e) => setStoreValueInput(e.target.value)}
        style={{ ...inputStyle, marginBottom: 14 }}
      />

      <label style={labelStyle}>Total Monthly Rent Collected (৳)</label>
      <input
        type="number" min="0" placeholder="e.g. 50000" value={monthlyRentInput}
        onChange={(e) => setMonthlyRentInput(e.target.value)}
        style={{ ...inputStyle, marginBottom: 14 }}
      />

      <label style={labelStyle}>Lease Term (Years)</label>
      <input
        type="number" min="0" value={leaseTermInput}
        onChange={(e) => setLeaseTermInput(e.target.value)}
        style={{ ...inputStyle, marginBottom: 16 }}
      />

      {hasInput && (
        <>
          <MetricRow label="Implied Annual Rental Yield" value={`${impliedAnnualYield.toFixed(2)}%`} color="#8b93a7" />
          <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "16px 0" }} />

          <div style={{ fontSize: 11.5, letterSpacing: 0.6, color: "#8b93a7", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
            Member Dividend
          </div>
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)} style={{ ...inputStyle, marginBottom: 14 }}>
            <option value="">Choose a member...</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>

          {member && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{
                display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 999,
                background: "rgba(100,116,139,0.15)", border: "1px solid rgba(100,116,139,0.4)",
              }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#94a3b8" }}>
                  {member.shares} shares · {ownershipPct.toFixed(2)}% ownership
                </span>
              </div>
              <MetricRow label="Monthly Rent Dividend" value={fmt(monthlyDividend)} color="#06B6D4" boxed />
              <MetricRow label="Annual Rent Dividend" value={fmt(annualDividend)} color="#06B6D4" boxed />
              <MetricRow label={`Total Rent over ${leaseTerm}-Yr Lease`} value={fmt(totalOverLease)} color="#06B6D4" boxed />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- 8. Month-over-month comparison ---------------- */

/* ---------------- 8. Month-over-month comparison ---------------- */

function MonthComparisonStat({ monthlyTotals }) {
  let lastIdx = -1;
  for (let i = monthlyTotals.length - 1; i >= 0; i--) {
    if (monthlyTotals[i].value > 0) { lastIdx = i; break; }
  }
  if (lastIdx < 1) {
    return (
      <div className="bff-card" style={{ padding: 18, marginBottom: 16 }}>
        <WealthSectionHeader icon={<TrendingUp size={15} color="#5bb8ff" />} title="Month-over-Month Pace" />
        <div style={{ fontSize: 12.5, color: "#5b6478" }}>Need at least two active months to compare.</div>
      </div>
    );
  }
  const current = monthlyTotals[lastIdx];
  const previous = monthlyTotals[lastIdx - 1];
  const diff = current.value - previous.value;
  const pct = previous.value > 0 ? (diff / previous.value) * 100 : (current.value > 0 ? 100 : 0);
  const up = diff >= 0;

  return (
    <div className="bff-card" style={{ padding: 18, marginBottom: 16 }}>
      <WealthSectionHeader icon={up ? <TrendingUp size={15} color="#34d399" /> : <TrendingDown size={15} color="#f87171" />} title="Month-over-Month Pace" />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 12, color: "#5b6478" }}>{previous.name} → {current.name}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#f4f6fb", marginTop: 2 }}>{fmt(current.value)}</div>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 999,
          background: up ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
          border: up ? "1px solid rgba(52,211,153,0.3)" : "1px solid rgba(248,113,113,0.3)",
        }}>
          {up ? <TrendingUp size={13} color="#34d399" /> : <TrendingDown size={13} color="#f87171" />}
          <span style={{ fontSize: 13, fontWeight: 700, color: up ? "#34d399" : "#f87171" }}>
            {up ? "+" : ""}{pct.toFixed(0)}%
          </span>
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => generateMemberStatementPDF(member, stats, payments)}
              title="Download statement (PDF)"
              style={closeBtnStyle}
            >
              <FileText size={17} color="#8b93a7" />
            </button>
            <button onClick={onClose} style={closeBtnStyle}><X size={18} color="#8b93a7" /></button>
          </div>
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
