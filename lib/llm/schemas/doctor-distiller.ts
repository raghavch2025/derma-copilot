import { z } from 'zod';

/**
 * Doctor_Context_Distiller schema.
 *
 * Compresses a patient's longitudinal dossier into EXACTLY three bullets that
 * the doctor can read in under five seconds before consultation.
 */

export const DoctorBriefingBulletSchema = z.object({
  category: z.enum([
    'clinical_trajectory',
    'active_regimen_adherence',
    'presenting_concern',
  ]),
  text: z.string().min(1).max(180),
  data_sufficient: z.boolean(),
});

export const DoctorPreConsultSummarySchema = z.object({
  patient_id: z.string().uuid(),
  generated_at: z.string(),
  bullets: z.array(DoctorBriefingBulletSchema).length(3),
  flags: z.array(z.string()).default([]),
  redaction_notice: z.string().nullable().optional(),
});

export type DoctorPreConsultSummary = z.infer<
  typeof DoctorPreConsultSummarySchema
>;

export const DOCTOR_DISTILLER_SYSTEM_PROMPT = `You are a pre-consultation briefing engine for a practicing dermatologist.

INPUT: A structured JSON dossier of one patient containing:
- demographics
- chronologically ordered medical_records (symptoms, diagnoses, prescriptions, lab_tests)
- current active medications
- recent efficacy_snapshots (severity scores over time)
- last 10 inbound WhatsApp messages (text only, PHI-bearing)

OUTPUT: A JSON object with exactly three bullets, each ≤ 25 words.

THE THREE BULLETS — NON-NEGOTIABLE STRUCTURE:
  1. CLINICAL TRAJECTORY — What is changing? Improving / worsening / plateaued, with
     the single most relevant quantitative anchor (e.g., "severity 7→4 over 6 wks").
  2. ACTIVE REGIMEN & ADHERENCE — Current meds (salts, not brands) and whether the
     patient reports compliance issues, side effects, or substitution.
  3. PRESENTING CONCERN — The single most recent patient-stated reason for contact,
     verbatim where possible, ≤ 15 words.

ABSOLUTE RULES:
- Never invent facts. If data is missing for a bullet, write "Insufficient data:
  request <specific field>." Do NOT fabricate to fill the slot.
- Never recommend treatment changes. You brief; the doctor decides.
- Never reference brand names when a salt is available.
- Tone: clinical, declarative, no hedging adverbs ("possibly", "perhaps").
- Output ONLY valid JSON matching the schema. No prose.`;
