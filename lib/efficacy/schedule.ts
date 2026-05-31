/**
 * Reminder scheduling utilities.
 *
 * Maps a medication's frequency-per-day and food relation into concrete
 * clock times (HH:MM:SS, clinic-local) that the retention cron will use to
 * fire WhatsApp reminders.
 *
 * Standard dosing windows (dermatology outpatient defaults):
 *   1x/day  → 09:00 (morning)         or 21:00 if "night"/topical-PM
 *   2x/day  → 09:00, 21:00
 *   3x/day  → 08:00, 14:00, 20:00
 *   4x/day  → 08:00, 12:00, 16:00, 20:00
 *
 * Food relation shifts times slightly:
 *   before_food → 30 min before standard meal slots
 *   after_food  → at standard slots (assumed post-meal)
 */

export function scheduleTimesFor(
  frequencyPerDay: number | null | undefined,
  foodRelation: string | null | undefined,
  instructions?: string | null
): string[] {
  const freq = frequencyPerDay ?? inferFrequency(instructions);
  if (!freq || freq < 1) return [];

  let base: string[];
  switch (freq) {
    case 1:
      // PM-leaning for topical retinoids commonly applied at night
      base = isNightDose(instructions) ? ['21:00:00'] : ['09:00:00'];
      break;
    case 2:
      base = ['09:00:00', '21:00:00'];
      break;
    case 3:
      base = ['08:00:00', '14:00:00', '20:00:00'];
      break;
    case 4:
      base = ['08:00:00', '12:00:00', '16:00:00', '20:00:00'];
      break;
    default:
      base = ['09:00:00'];
  }

  if (foodRelation === 'before_food') {
    return base.map(shiftEarlier30);
  }
  return base;
}

function inferFrequency(instructions?: string | null): number | null {
  if (!instructions) return null;
  const t = instructions.toLowerCase();
  if (/\b(qid|four times|4 times|1-1-1-1)\b/.test(t)) return 4;
  if (/\b(tid|tds|thrice|three times|3 times|1-1-1)\b/.test(t)) return 3;
  if (/\b(bid|bd|twice|two times|2 times|1-0-1|1-1)\b/.test(t)) return 2;
  if (/\b(od|once|hs|daily|1-0-0|0-0-1)\b/.test(t)) return 1;
  return null;
}

function isNightDose(instructions?: string | null): boolean {
  if (!instructions) return false;
  return /\b(hs|night|bedtime|0-0-1|pm)\b/i.test(instructions);
}

function shiftEarlier30(time: string): string {
  const [h, m] = time.split(':').map(Number);
  let total = h * 60 + m - 30;
  if (total < 0) total += 24 * 60;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}:00`;
}
