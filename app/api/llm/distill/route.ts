import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import {
  DoctorPreConsultSummarySchema,
  DOCTOR_DISTILLER_SYSTEM_PROMPT,
  type DoctorPreConsultSummary,
} from '@/lib/llm/schemas/doctor-distiller';
import { computeEfficacy } from '@/lib/efficacy/tracker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Doctor pre-consultation distiller.
 *
 * Aggregates the patient's structured dossier, calls the LLM with the
 * Doctor_Context_Distiller prompt, validates the response, and returns
 * exactly 3 bullets for the Doctor Dashboard.
 */
export async function POST(req: NextRequest) {
  const internalToken = process.env.INTERNAL_PIPELINE_TOKEN;
  if (
    !internalToken ||
    req.headers.get('x-internal-token') !== internalToken
  ) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { patient_id } = (await req.json()) as { patient_id: string };
  if (!patient_id) {
    return new NextResponse('patient_id required', { status: 400 });
  }

  const supabase = supabaseAdmin();

  const [{ data: patient }, { data: records }, { data: meds }, { data: msgs }, efficacy] =
    await Promise.all([
      supabase
        .from('patients')
        .select('id, full_name, date_of_birth, sex, is_influencer')
        .eq('id', patient_id)
        .single(),
      supabase
        .from('v_patient_timeline')
        .select('*')
        .eq('patient_id', patient_id)
        .order('recorded_at', { ascending: true })
        .limit(200),
      supabase
        .from('medication_timelines')
        .select('chemical_salt, dosage_value, dosage_unit, food_relation, starts_on, is_active')
        .eq('patient_id', patient_id)
        .eq('is_active', true),
      supabase
        .from('whatsapp_conversations')
        .select('body, created_at')
        .eq('patient_id', patient_id)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(10),
      computeEfficacy(patient_id, 90),
    ]);

  if (!patient) {
    return new NextResponse('Patient not found', { status: 404 });
  }

  const dossier = {
    demographics: patient,
    medical_records: records ?? [],
    active_medications: meds ?? [],
    efficacy_snapshot: efficacy,
    recent_messages: msgs ?? [],
  };

  let summary: DoctorPreConsultSummary;
  try {
    summary = await invokeDistillerModel(patient_id, dossier);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, summary });
}

async function invokeDistillerModel(
  patientId: string,
  dossier: unknown
): Promise<DoctorPreConsultSummary> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: DOCTOR_DISTILLER_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Patient ID: ${patientId}\n\nDossier:\n${JSON.stringify(dossier, null, 2)}\n\nProduce the 3-bullet JSON summary now.`,
        },
      ],
    }),
  });

  if (!resp.ok) {
    throw new Error(`LLM call failed: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json();
  const text = (data.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');

  const cleaned = text.replace(/```json|```/g, '').trim();
  const json = JSON.parse(cleaned);
  return DoctorPreConsultSummarySchema.parse(json);
}
