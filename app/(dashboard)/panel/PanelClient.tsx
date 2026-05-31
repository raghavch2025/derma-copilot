'use client';

import { useState } from 'react';

interface Stats {
  appointmentsToday: number;
  totalPatients: number;
  messagesToday: number;
  pendingRevenueInr: number;
}

interface Named {
  id: string;
  full_name: string;
  phone_e164: string;
}

interface Appointment {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  reason: string | null;
  notes: string | null;
  patients: Named | null;
  doctors: { id: string; full_name: string } | null;
}

interface Patient extends Named {
  is_influencer: boolean;
  created_at: string;
}

interface Message {
  id: string;
  body: string | null;
  direction: string;
  status: string;
  created_at: string;
  media_count: number;
  patients: Named | null;
}

interface Medication {
  id: string;
  brand_name: string | null;
  chemical_salt: string;
  dosage_value: number | null;
  dosage_unit: string | null;
  exact_times: string[];
  food_relation: string;
  starts_on: string;
  ends_on: string | null;
  is_active: boolean;
  patients: Named | null;
}

type Tab = 'overview' | 'bookings' | 'messages' | 'reminders' | 'patients';

const C = {
  ink: '#0b2027',
  teal: '#0d7377',
  tealDeep: '#0a5a5d',
  mist: '#e8f1f0',
  paper: '#f6faf9',
  line: '#d3e3e0',
  amber: '#d98c0c',
  rose: '#c2466b',
  white: '#ffffff',
  sub: '#5a7470',
};

export default function PanelClient({
  stats,
  appointments,
  patients,
  messages,
  medications,
}: {
  stats: Stats;
  appointments: Appointment[];
  patients: Patient[];
  messages: Message[];
  medications: Medication[];
}) {
  const [tab, setTab] = useState<Tab>('overview');

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'overview', label: 'Overview', icon: '◧' },
    { key: 'bookings', label: 'Bookings', icon: '▤' },
    { key: 'messages', label: 'Messages', icon: '✉' },
    { key: 'reminders', label: 'Reminders', icon: '◴' },
    { key: 'patients', label: 'Patients', icon: '☺' },
  ];

  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.paper,
        fontFamily:
          'ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif',
        color: C.ink,
        paddingBottom: 90,
      }}
    >
      {/* Header */}
      <header
        style={{
          background: `linear-gradient(135deg, ${C.teal}, ${C.tealDeep})`,
          color: C.white,
          padding: '20px 20px 22px',
          borderBottomLeftRadius: 22,
          borderBottomRightRadius: 22,
          boxShadow: '0 6px 20px rgba(13,115,119,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: 2, opacity: 0.8, textTransform: 'uppercase' }}>
              Derma-Copilot
            </div>
            <h1 style={{ margin: '4px 0 0', fontSize: 22, fontWeight: 700 }}>
              Clinic Panel
            </h1>
          </div>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            ⚕
          </div>
        </div>
      </header>

      <main style={{ padding: '18px 16px', maxWidth: 760, margin: '0 auto' }}>
        {tab === 'overview' && <Overview stats={stats} appointments={appointments} messages={messages} />}
        {tab === 'bookings' && <Bookings appointments={appointments} />}
        {tab === 'messages' && <Messages messages={messages} />}
        {tab === 'reminders' && <Reminders medications={medications} appointments={appointments} />}
        {tab === 'patients' && <Patients patients={patients} />}
      </main>

      {/* Bottom Nav */}
      <nav
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: C.white,
          borderTop: `1px solid ${C.line}`,
          display: 'flex',
          justifyContent: 'space-around',
          padding: '8px 4px calc(8px + env(safe-area-inset-bottom))',
          boxShadow: '0 -4px 14px rgba(11,32,39,0.06)',
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              border: 'none',
              background: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              padding: '4px 10px',
              cursor: 'pointer',
              color: tab === t.key ? C.teal : C.sub,
              fontWeight: tab === t.key ? 700 : 500,
            }}
          >
            <span style={{ fontSize: 18 }}>{t.icon}</span>
            <span style={{ fontSize: 10.5 }}>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ───────── Overview ───────── */
function Overview({
  stats,
  appointments,
  messages,
}: {
  stats: Stats;
  appointments: Appointment[];
  messages: Message[];
}) {
  const cards = [
    { label: "Today's Bookings", value: stats.appointmentsToday, accent: C.teal },
    { label: 'Total Patients', value: stats.totalPatients, accent: C.tealDeep },
    { label: 'Messages Today', value: stats.messagesToday, accent: C.amber },
    { label: 'Pending ₹', value: stats.pendingRevenueInr.toLocaleString('en-IN'), accent: C.rose },
  ];

  const upcoming = appointments
    .filter((a) => new Date(a.starts_at) >= new Date())
    .slice(0, 3);
  const recentMsgs = messages.filter((m) => m.direction === 'inbound').slice(0, 4);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 22 }}>
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              background: C.white,
              borderRadius: 16,
              padding: '16px 16px 14px',
              border: `1px solid ${C.line}`,
              boxShadow: '0 2px 8px rgba(11,32,39,0.04)',
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 800, color: c.accent }}>{c.value}</div>
            <div style={{ fontSize: 12.5, color: C.sub, marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      <SectionTitle>Next Appointments</SectionTitle>
      {upcoming.length === 0 && <Empty>No upcoming appointments.</Empty>}
      {upcoming.map((a) => (
        <Row key={a.id}>
          <div>
            <strong>{a.patients?.full_name ?? 'Unknown'}</strong>
            <div style={{ fontSize: 12, color: C.sub }}>{a.reason ?? 'Consultation'}</div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 12.5 }}>
            <div style={{ fontWeight: 700 }}>{fmtTime(a.starts_at)}</div>
            <StatusPill status={a.status} />
          </div>
        </Row>
      ))}

      <div style={{ height: 18 }} />
      <SectionTitle>Recent Messages</SectionTitle>
      {recentMsgs.length === 0 && <Empty>No messages yet.</Empty>}
      {recentMsgs.map((m) => (
        <Row key={m.id}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{m.patients?.full_name ?? m.patients?.phone_e164 ?? 'Unknown'}</strong>
            <div
              style={{
                fontSize: 12.5,
                color: C.sub,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {m.media_count > 0 ? '📎 Media attached' : m.body ?? '—'}
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.sub, marginLeft: 8 }}>{fmtAgo(m.created_at)}</div>
        </Row>
      ))}
    </div>
  );
}

/* ───────── Bookings ───────── */
function Bookings({ appointments }: { appointments: Appointment[] }) {
  if (appointments.length === 0) return <Empty>No bookings yet.</Empty>;
  return (
    <div>
      <SectionTitle>All Bookings ({appointments.length})</SectionTitle>
      {appointments.map((a) => (
        <Card key={a.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 15 }}>{a.patients?.full_name ?? 'Unknown'}</strong>
            <StatusPill status={a.status} />
          </div>
          <div style={{ fontSize: 12.5, color: C.sub, marginTop: 4 }}>
            📞 {a.patients?.phone_e164 ?? '—'}
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            🗓 {fmtFull(a.starts_at)}
          </div>
          {a.reason && <div style={{ fontSize: 12.5, color: C.sub, marginTop: 4 }}>{a.reason}</div>}
          {a.doctors && (
            <div style={{ fontSize: 12, color: C.teal, marginTop: 4 }}>Dr. {a.doctors.full_name}</div>
          )}
        </Card>
      ))}
    </div>
  );
}

/* ───────── Messages ───────── */
function Messages({ messages }: { messages: Message[] }) {
  if (messages.length === 0) return <Empty>No conversations yet.</Empty>;
  return (
    <div>
      <SectionTitle>WhatsApp Conversations</SectionTitle>
      {messages.map((m) => (
        <div
          key={m.id}
          style={{
            display: 'flex',
            justifyContent: m.direction === 'inbound' ? 'flex-start' : 'flex-end',
            marginBottom: 8,
          }}
        >
          <div
            style={{
              maxWidth: '78%',
              background: m.direction === 'inbound' ? C.white : C.mist,
              border: `1px solid ${C.line}`,
              borderRadius: 14,
              padding: '9px 12px',
            }}
          >
            <div style={{ fontSize: 11, color: C.teal, fontWeight: 700, marginBottom: 2 }}>
              {m.direction === 'inbound'
                ? m.patients?.full_name ?? m.patients?.phone_e164 ?? 'Patient'
                : 'Clinic'}
            </div>
            <div style={{ fontSize: 13.5 }}>
              {m.media_count > 0 ? '📎 Media attached' : m.body ?? '—'}
            </div>
            <div style={{ fontSize: 10, color: C.sub, marginTop: 3, textAlign: 'right' }}>
              {fmtAgo(m.created_at)} · {m.status}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────── Reminders ───────── */
function Reminders({
  medications,
  appointments,
}: {
  medications: Medication[];
  appointments: Appointment[];
}) {
  const followUps = appointments
    .filter((a) => a.status === 'completed')
    .slice(0, 10);

  return (
    <div>
      <div
        style={{
          background: C.mist,
          border: `1px solid ${C.line}`,
          borderRadius: 14,
          padding: '12px 14px',
          marginBottom: 18,
          fontSize: 12.5,
          color: C.tealDeep,
        }}
      >
        ⚙ Reminders fire automatically via the retention engine (every 15 min).
        Medication reminders trigger at each scheduled time; follow-ups and
        pre-procedure prep send on schedule.
      </div>

      <SectionTitle>Active Medication Reminders ({medications.length})</SectionTitle>
      {medications.length === 0 && (
        <Empty>No active medications. Upload a prescription to auto-create reminders.</Empty>
      )}
      {medications.map((m) => (
        <Card key={m.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 14.5 }}>
              {m.brand_name ?? m.chemical_salt}
            </strong>
            <span style={{ fontSize: 11.5, color: C.teal }}>
              {m.patients?.full_name ?? '—'}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3 }}>
            Salt: {m.chemical_salt}
            {m.dosage_value ? ` · ${m.dosage_value}${m.dosage_unit ?? ''}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {(m.exact_times ?? []).length === 0 && (
              <span style={{ fontSize: 11.5, color: C.amber }}>⚠ No times set</span>
            )}
            {(m.exact_times ?? []).map((t, i) => (
              <span
                key={i}
                style={{
                  background: C.mist,
                  borderRadius: 8,
                  padding: '3px 9px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: C.tealDeep,
                }}
              >
                ◴ {t.slice(0, 5)}
              </span>
            ))}
            <span
              style={{
                background: foodColor(m.food_relation).bg,
                color: foodColor(m.food_relation).fg,
                borderRadius: 8,
                padding: '3px 9px',
                fontSize: 11.5,
                fontWeight: 600,
              }}
            >
              {foodLabel(m.food_relation)}
            </span>
          </div>
        </Card>
      ))}

      <div style={{ height: 18 }} />
      <SectionTitle>Follow-up Consultations</SectionTitle>
      {followUps.length === 0 && <Empty>No completed visits awaiting follow-up.</Empty>}
      {followUps.map((a) => (
        <Row key={a.id}>
          <div>
            <strong>{a.patients?.full_name ?? 'Unknown'}</strong>
            <div style={{ fontSize: 12, color: C.sub }}>Last visit: {fmtFull(a.starts_at)}</div>
          </div>
          <span style={{ fontSize: 11.5, color: C.amber, fontWeight: 700 }}>Due follow-up</span>
        </Row>
      ))}
    </div>
  );
}

/* ───────── Patients ───────── */
function Patients({ patients }: { patients: Patient[] }) {
  const [q, setQ] = useState('');
  const filtered = patients.filter(
    (p) =>
      p.full_name.toLowerCase().includes(q.toLowerCase()) ||
      p.phone_e164.includes(q)
  );
  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or phone…"
        style={{
          width: '100%',
          padding: '11px 14px',
          borderRadius: 12,
          border: `1px solid ${C.line}`,
          fontSize: 14,
          marginBottom: 14,
          boxSizing: 'border-box',
          background: C.white,
        }}
      />
      <SectionTitle>Patients ({filtered.length})</SectionTitle>
      {filtered.length === 0 && <Empty>No patients found.</Empty>}
      {filtered.map((p) => (
        <Row key={p.id}>
          <div>
            <strong>
              {p.full_name}
              {p.is_influencer && (
                <span style={{ marginLeft: 6, fontSize: 11, color: C.rose }}>★ influencer</span>
              )}
            </strong>
            <div style={{ fontSize: 12.5, color: C.sub }}>{p.phone_e164}</div>
          </div>
          <div style={{ fontSize: 11, color: C.sub }}>{fmtDate(p.created_at)}</div>
        </Row>
      ))}
    </div>
  );
}

/* ───────── Shared UI ───────── */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 13,
        textTransform: 'uppercase',
        letterSpacing: 1,
        color: C.sub,
        margin: '0 0 10px',
        fontWeight: 700,
      }}
    >
      {children}
    </h2>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.line}`,
        borderRadius: 14,
        padding: '13px 15px',
        marginBottom: 10,
        boxShadow: '0 2px 6px rgba(11,32,39,0.03)',
      }}
    >
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.line}`,
        borderRadius: 13,
        padding: '12px 14px',
        marginBottom: 9,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
      }}
    >
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        textAlign: 'center',
        color: C.sub,
        fontSize: 13.5,
        padding: '26px 16px',
        background: C.white,
        borderRadius: 14,
        border: `1px dashed ${C.line}`,
      }}
    >
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    requested: { bg: '#fef3e2', fg: C.amber },
    confirmed: { bg: C.mist, fg: C.teal },
    completed: { bg: '#e3f1e6', fg: '#2e7d4f' },
    cancelled: { bg: '#fde8ee', fg: C.rose },
    no_show: { bg: '#fde8ee', fg: C.rose },
    rescheduled: { bg: '#fef3e2', fg: C.amber },
  };
  const s = map[status] ?? { bg: C.mist, fg: C.sub };
  return (
    <span
      style={{
        background: s.bg,
        color: s.fg,
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 9px',
        borderRadius: 20,
        textTransform: 'capitalize',
        display: 'inline-block',
        marginTop: 2,
      }}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

/* ───────── Helpers ───────── */
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  });
}
function fmtFull(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function fmtAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
function foodLabel(f: string) {
  return (
    { before_food: '🍽 Before food', after_food: '🍽 After food', with_food: '🍽 With food', irrelevant: 'Anytime' }[
      f
    ] ?? 'Anytime'
  );
}
function foodColor(f: string) {
  if (f === 'before_food') return { bg: '#fef3e2', fg: C.amber };
  if (f === 'after_food') return { bg: '#e3f1e6', fg: '#2e7d4f' };
  return { bg: C.mist, fg: C.sub };
}
