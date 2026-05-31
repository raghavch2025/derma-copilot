import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import {
  PrescriptionOCRResultSchema,
  PRESCRIPTION_OCR_SYSTEM_PROMPT,
  type PrescriptionOCRResult,
} from '@/lib/llm/schemas/prescription-ocr';
import { scheduleTimesFor } from '@/lib/efficacy/schedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface OCRRequestBody {
  clinic_id: string;
  patient_id: string;
  storage_paths: string[];
  message_sid: string;
}

/**
 * Prescription OCR pipeline.
 *
 * 1. Authenticate via internal pipeline token (called fire-and-forget from
 *    the WhatsApp webhook).
 * 2. Generate signed URLs for each media artifact.
 * 3. Invoke the LLM (Anthropic Claude) with the OCR system prompt + image.
 * 4. Validate the response against PrescriptionOCRResultSchema.
 * 5. Materialize structured rows into prescriptions + medication_timelines +
 *    medical_records, preserving the Symptoms → Diagnosis → Rx → Lab sequence.
 */
export async function POST(req: NextRequest) {
  const internalToken = process.env.INTERNAL_PIPELINE_TOKEN;
  if (
    !internalToken ||
    req.headers.get('x-internal-token') !== internalToken
  ) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = (await req.json()) as OCRRequestBody;
  const { clinic_id, patient_id, storage_paths } = body;

  if (!clinic_id || !patient_id || !Array.isArray(storage_paths)) {
    return new NextResponse('Invalid payload', { status: 400 });
  }

  const supabase = supabaseAdmin();

  // Generate signed URL for the first artifact (Phase 1: process single image).
  const primaryPath = storage_paths[0];
  if (!primaryPath) {
    return new NextResponse('No media to process', { status: 400 });
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from('patient-media')
    .createSignedUrl(primaryPath, 900); // 15-min TTL

  if (signErr || !signed?.signedUrl) {
    return new NextResponse('Signed URL generation failed', { status: 500 });
  }

  // Invoke LLM. The actual provider call is abstracted; this function will
  // raise if the model output fails schema validation — zero-hallucination
  // contract is enforced at the boundary.
  let parsed: PrescriptionOCRResult;
  try {
    parsed = await invokeOCRModel(signed.signedUrl);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 502 }
    );
  }

  if (!parsed.is_prescription) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'Document not recognized as prescription',
      warnings: parsed.parse_warnings,
    });
  }

  // Materialize structured records.
  const visitId = crypto.randomUUID();
  const recordedAt = new Date().toISOString();

  // 1. Symptoms
  for (const s of parsed.symptoms) {
    await supabase.from('medical_records').insert({
      clinic_id,
      patient_id,
      visit_id: visitId,
      stage: 'symptom',
      recorded_at: recordedAt,
      symptom: {
        description: s.description,
        body_region: s.body_region ?? null,
        duration_days: s.duration_days ?? null,
        severity_1_to_10: s.severity_1_to_10 ?? null,
        confidence: s.confidence,
      },
      source: 'whatsapp_ocr',
      source_media_path: primaryPath,
    });
  }

  // 2. Diagnoses
  for (const d of parsed.diagnoses) {
    await supabase.from('medical_records').insert({
      clinic_id,
      patient_id,
      visit_id: visitId,
      stage: 'diagnosis',
      recorded_at: recordedAt,
      diagnosis: {
        label: d.label,
        icd10_code: d.icd10_code ?? null,
        notes: d.notes ?? null,
        confidence: d.confidence,
      },
      source: 'whatsapp_ocr',
      source_media_path: primaryPath,
    });
  }

  // 3. Prescription + medication_timelines
  if (parsed.prescriptions.length > 0) {
    const { data: rx, error: rxErr } = await supabase
      .from('prescriptions')
      .insert({
        clinic_id,
        patient_id,
        issued_at: parsed.issued_on ?? recordedAt,
        notes: parsed.prescribing_doctor_name
          ? `Prescribed by ${parsed.prescribing_doctor_name}`
          : null,
      })
      .select('id')
      .single();

    if (!rxErr && rx) {
      await supabase.from('medical_records').insert({
        clinic_id,
        patient_id,
        visit_id: visitId,
        stage: 'prescription',
        recorded_at: recordedAt,
        prescription_id: rx.id,
        source: 'whatsapp_ocr',
        source_media_path: primaryPath,
      });

      for (const m of parsed.prescriptions) {
        const exactTimes = scheduleTimesFor(
          m.frequency_per_day,
          m.food_relation,
          m.instructions_verbatim
        );
        const endsOn =
          m.duration_days && m.duration_days > 0
            ? new Date(Date.now() + m.duration_days * 86_400_000)
                .toISOString()
                .slice(0, 10)
            : null;

        await supabase.from('medication_timelines').insert({
          clinic_id,
          prescription_id: rx.id,
          patient_id,
          brand_name: m.brand_name ?? null,
          chemical_salt: m.chemical_salt,
          dosage_value: m.dosage_value ?? null,
          dosage_unit: m.dosage_unit ?? null,
          route: m.route ?? null,
          food_relation: m.food_relation ?? 'irrelevant',
          duration_days: m.duration_days ?? null,
          exact_times: exactTimes,
          ends_on: endsOn,
          is_active: true,
        });
      }
    }
  }

  // 4. Lab tests
  for (const l of parsed.lab_tests) {
    await supabase.from('medical_records').insert({
      clinic_id,
      patient_id,
      visit_id: visitId,
      stage: 'lab_test',
      recorded_at: recordedAt,
      lab_test: {
        test_name: l.test_name,
        rationale: l.rationale ?? null,
        confidence: l.confidence,
        status: 'ordered',
      },
      source: 'whatsapp_ocr',
      source_media_path: primaryPath,
    });
  }

  return NextResponse.json({
    ok: true,
    visit_id: visitId,
    counts: {
      symptoms: parsed.symptoms.length,
      diagnoses: parsed.diagnoses.length,
      prescriptions: parsed.prescriptions.length,
      lab_tests: parsed.lab_tests.length,
    },
    overall_confidence: parsed.overall_confidence,
    warnings: parsed.parse_warnings,
  });
}

/**
 * LLM invocation. Replace the body with a real Anthropic / OpenAI vision call.
 * The contract: returns a PrescriptionOCRResult or throws.
 */
async function invokeOCRModel(
  imageUrl: string
): Promise<PrescriptionOCRResult> {
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
      max_tokens: 2048,
      system: PRESCRIPTION_OCR_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'url', url: imageUrl },
            },
            {
              type: 'text',
              text: 'Parse this prescription image into the required JSON schema. Output ONLY the JSON object.',
            },
          ],
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
  return PrescriptionOCRResultSchema.parse(json);
}
