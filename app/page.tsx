export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: '4rem auto', padding: '0 1.5rem' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
        Derma-Copilot
      </h1>
      <p style={{ color: '#475569', marginTop: 0 }}>
        AI-Powered Clinic Co-Pilot · Phase 1
      </p>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.125rem' }}>System Status</h2>
        <ul style={{ lineHeight: 1.8 }}>
          <li>
            <code>/api/webhook/whatsapp</code> — Inbound Twilio webhook
          </li>
          <li>
            <code>/api/webhook/twilio-status</code> — Delivery callbacks
          </li>
          <li>
            <code>/api/cron/retention</code> — Outbound retention engine
          </li>
          <li>
            <code>/api/llm/ocr-parse</code> — Prescription OCR
          </li>
          <li>
            <code>/api/llm/distill</code> — Doctor pre-consult summary
          </li>
        </ul>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.125rem' }}>Next Steps</h2>
        <ol style={{ lineHeight: 1.8 }}>
          <li>Configure environment variables (see <code>.env.example</code>)</li>
          <li>Apply Supabase migrations: <code>npx supabase db push</code></li>
          <li>Set Twilio webhook URLs in the Twilio Console</li>
          <li>Build dashboard surfaces under <code>app/(dashboard)/</code></li>
        </ol>
      </section>
    </main>
  );
}
