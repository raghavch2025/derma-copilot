import { supabaseAdmin } from '@/lib/supabase/server';

export interface EfficacyResult {
  patient_id: string;
  window_days: number;
  data_points: number;
  baseline_severity: number | null;
  latest_severity: number | null;
  absolute_improvement: number | null;
  percent_improvement: number | null;
  weekly_velocity: number | null;
  responsiveness_score: number | null;
  trajectory: 'improving' | 'plateaued' | 'worsening' | 'insufficient_data';
  active_regimen: Array<{ chemical_salt: string; days_on_therapy: number }>;
}

/**
 * Computes drug responsiveness and healing progress over a rolling window.
 *
 * SAFETY: If fewer than 2 data points exist, the function returns
 * `trajectory: 'insufficient_data'` and null scores. It does NOT fabricate
 * efficacy metrics from sparse data.
 */
export async function computeEfficacy(
  patientId: string,
  windowDays = 90
): Promise<EfficacyResult> {
  const supabase = supabaseAdmin();
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const { data: snaps, error: snapErr } = await supabase
    .from('efficacy_snapshots')
    .select('severity_score, recorded_at')
    .eq('patient_id', patientId)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: true });

  if (snapErr) {
    throw new Error(`efficacy query failed: ${snapErr.message}`);
  }

  const { data: meds, error: medsErr } = await supabase
    .from('medication_timelines')
    .select('chemical_salt, starts_on')
    .eq('patient_id', patientId)
    .eq('is_active', true);

  if (medsErr) {
    throw new Error(`medication query failed: ${medsErr.message}`);
  }

  const activeRegimen = (meds ?? []).map((m) => ({
    chemical_salt: m.chemical_salt,
    days_on_therapy: Math.max(
      0,
      Math.floor(
        (Date.now() - new Date(m.starts_on).getTime()) / 86_400_000
      )
    ),
  }));

  if (!snaps || snaps.length < 2) {
    return {
      patient_id: patientId,
      window_days: windowDays,
      data_points: snaps?.length ?? 0,
      baseline_severity: snaps?.[0]?.severity_score ?? null,
      latest_severity: snaps?.[snaps.length - 1]?.severity_score ?? null,
      absolute_improvement: null,
      percent_improvement: null,
      weekly_velocity: null,
      responsiveness_score: null,
      trajectory: 'insufficient_data',
      active_regimen: activeRegimen,
    };
  }

  const baseline = Number(snaps[0].severity_score);
  const latest = Number(snaps[snaps.length - 1].severity_score);
  const absoluteImprovement = baseline - latest;
  const percentImprovement =
    baseline > 0 ? (absoluteImprovement / baseline) * 100 : null;

  const elapsedMs =
    new Date(snaps[snaps.length - 1].recorded_at).getTime() -
    new Date(snaps[0].recorded_at).getTime();
  const elapsedWeeks = elapsedMs / (7 * 86_400_000);
  const weeklyVelocity =
    elapsedWeeks > 0 ? absoluteImprovement / elapsedWeeks : null;

  // Composite responsiveness score (0–100):
  //   50% weighted on percent improvement,
  //   30% on weekly velocity (capped at 2 pts/week as "perfect"),
  //   20% on data density (snapshots per week, capped at 1).
  const pctComponent =
    percentImprovement != null
      ? Math.max(0, Math.min(100, percentImprovement)) * 0.5
      : 0;
  const velComponent =
    weeklyVelocity != null
      ? Math.max(0, Math.min(2, weeklyVelocity)) * (30 / 2)
      : 0;
  const density =
    Math.min(1, snaps.length / Math.max(1, elapsedWeeks)) * 20;

  const responsiveness =
    percentImprovement != null
      ? Math.round(pctComponent + velComponent + density)
      : null;

  let trajectory: EfficacyResult['trajectory'];
  if (absoluteImprovement >= 1.0) trajectory = 'improving';
  else if (absoluteImprovement <= -1.0) trajectory = 'worsening';
  else trajectory = 'plateaued';

  return {
    patient_id: patientId,
    window_days: windowDays,
    data_points: snaps.length,
    baseline_severity: baseline,
    latest_severity: latest,
    absolute_improvement: Number(absoluteImprovement.toFixed(2)),
    percent_improvement:
      percentImprovement != null
        ? Number(percentImprovement.toFixed(1))
        : null,
    weekly_velocity:
      weeklyVelocity != null ? Number(weeklyVelocity.toFixed(2)) : null,
    responsiveness_score: responsiveness,
    trajectory,
    active_regimen: activeRegimen,
  };
}
