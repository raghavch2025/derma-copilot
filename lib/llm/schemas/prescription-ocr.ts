import { z } from 'zod';

/**
 * Zod schema mirroring the Pydantic PrescriptionOCRResult model used by the
 * Prescription_OCR_Parser pipeline. Enforces zero-hallucination contract:
 * any clinically uncertain field MUST be null and accompanied by a warning.
 */

export const SymptomSchema = z.object({
  description: z.string().min(1),
  body_region: z.string().nullable().optional(),
  duration_days: z.number().int().nonnegative().nullable().optional(),
  severity_1_to_10: z.number().int().min(1).max(10).nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export const DiagnosisSchema = z.object({
  label: z.string().min(1),
  icd10_code: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export const PrescribedMedicationSchema = z.object({
  brand_name: z.string().nullable().optional(),
  chemical_salt: z.string().min(1),
  dosage_value: z.number().nonnegative().nullable().optional(),
  dosage_unit: z.string().nullable().optional(),
  route: z
    .enum(['topical', 'oral', 'injection', 'ophthalmic', 'other'])
    .nullable()
    .optional(),
  frequency_per_day: z.number().int().min(0).nullable().optional(),
  food_relation: z
    .enum(['before_food', 'after_food', 'with_food', 'irrelevant'])
    .nullable()
    .optional(),
  duration_days: z.number().int().nonnegative().nullable().optional(),
  instructions_verbatim: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export const LabTestSchema = z.object({
  test_name: z.string().min(1),
  rationale: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export const PrescriptionOCRResultSchema = z.object({
  is_prescription: z.boolean(),
  prescribing_doctor_name: z.string().nullable().optional(),
  prescribing_clinic_name: z.string().nullable().optional(),
  issued_on: z.string().nullable().optional(),
  symptoms: z.array(SymptomSchema).default([]),
  diagnoses: z.array(DiagnosisSchema).default([]),
  prescriptions: z.array(PrescribedMedicationSchema).default([]),
  lab_tests: z.array(LabTestSchema).default([]),
  parse_warnings: z.array(z.string()).default([]),
  overall_confidence: z.number().min(0).max(1),
});

export type PrescriptionOCRResult = z.infer<typeof PrescriptionOCRResultSchema>;

export const PRESCRIPTION_OCR_SYSTEM_PROMPT = `You are a clinical OCR normalization engine for a dermatology clinic.

INPUTS:
- Raw OCR text extracted from a photograph of a handwritten or printed prescription.
- The text may be noisy, partial, multilingual (English/Hindi/Hinglish), or contain stray marks.

OUTPUT:
- A single JSON object that strictly conforms to the provided schema.
- No prose, no markdown, no commentary outside the JSON.

ABSOLUTE RULES — VIOLATIONS ARE A SAFETY INCIDENT:
1. NEVER invent a drug, salt, dosage, frequency, diagnosis, or lab test. If a field
   is not clearly readable, set it to null and add an entry to parse_warnings.
2. NEVER alter chemical salts. If you see "Adapalene", you write "Adapalene". You do
   NOT translate brand-to-salt or salt-to-brand unless both appear in the source.
3. NEVER assume the patient's symptoms; capture only what is explicitly written.
4. Preserve the original ordering encountered in the document where possible.
5. If the document is not a prescription (e.g., random photo, lab report, ID card),
   set is_prescription: false and leave all clinical arrays empty.
6. Confidence scores must reflect actual legibility: < 0.5 means the field is doubtful
   and a human must verify.

CLINICAL SEQUENCE: Populate fields in this order — symptoms, diagnoses, prescriptions,
lab_tests — to mirror the medical compliance chain enforced downstream.`;
