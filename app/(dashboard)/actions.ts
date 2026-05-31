'use server';

import { supabaseAdmin } from '@/lib/supabase/server';

// NOTE: For Phase 1 the panel uses the service-role client server-side and
// scopes to a single clinic via CLINIC_ID env. In production, replace with
// Supabase Auth + RLS so each assistant only sees their own clinic.

function clinicId(): string {
  const id = process.env.CLINIC_ID;
  if (!id) throw new Error('CLINIC_ID env var not set');
  return id;
}

export async function getDashboardStats() {
  const supabase = supabaseAdmin();
  const cid = clinicId();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [appts, patients, msgs, pendingPay] = await Promise.all([
    supabase
      .from('appointment_slots')
      .select('id, status', { count: 'exact' })
      .eq('clinic_id', cid)
      .gte('starts_at', todayStart.toISOString()),
    supabase
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', cid),
    supabase
      .from('whatsapp_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', cid)
      .eq('direction', 'inbound')
      .gte('created_at', todayStart.toISOString()),
    supabase
      .from('payments')
      .select('amount_inr_paise')
      .eq('clinic_id', cid)
      .eq('status', 'pending'),
  ]);

  const pendingAmount = (pendingPay.data ?? []).reduce(
    (sum, p) => sum + Number(p.amount_inr_paise ?? 0),
    0
  );

  return {
    appointmentsToday: appts.count ?? 0,
    totalPatients: patients.count ?? 0,
    messagesToday: msgs.count ?? 0,
    pendingRevenueInr: Math.round(pendingAmount / 100),
  };
}

export async function getAppointments() {
  const supabase = supabaseAdmin();
  const { data } = await supabase
    .from('appointment_slots')
    .select(
      `id, starts_at, ends_at, status, reason, notes,
       patients ( id, full_name, phone_e164 ),
       doctors ( id, full_name )`
    )
    .eq('clinic_id', clinicId())
    .order('starts_at', { ascending: true })
    .limit(100);

  return data ?? [];
}

export async function getPatients() {
  const supabase = supabaseAdmin();
  const { data } = await supabase
    .from('patients')
    .select('id, full_name, phone_e164, is_influencer, created_at')
    .eq('clinic_id', clinicId())
    .order('created_at', { ascending: false })
    .limit(200);

  return data ?? [];
}

export async function getMessages() {
  const supabase = supabaseAdmin();
  const { data } = await supabase
    .from('whatsapp_conversations')
    .select(
      `id, body, direction, status, created_at, media_count,
       patients ( id, full_name, phone_e164 )`
    )
    .eq('clinic_id', clinicId())
    .order('created_at', { ascending: false })
    .limit(100);

  return data ?? [];
}

export async function getActiveMedications() {
  const supabase = supabaseAdmin();
  const { data } = await supabase
    .from('medication_timelines')
    .select(
      `id, brand_name, chemical_salt, dosage_value, dosage_unit,
       exact_times, food_relation, starts_on, ends_on, is_active,
       patients ( id, full_name, phone_e164 )`
    )
    .eq('clinic_id', clinicId())
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(100);

  return data ?? [];
}

export async function getPatientTimeline(patientId: string) {
  const supabase = supabaseAdmin();
  const { data } = await supabase
    .from('v_patient_timeline')
    .select('*')
    .eq('patient_id', patientId)
    .order('recorded_at', { ascending: true });

  return data ?? [];
}
