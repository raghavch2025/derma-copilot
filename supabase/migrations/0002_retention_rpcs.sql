-- =============================================================================
-- DERMA-COPILOT — RETENTION ENGINE RPCs
-- =============================================================================
-- Postgres functions invoked by the Vercel Cron retention handler. Each returns
-- a result set of patients eligible for one of three outbound actions.
-- =============================================================================

create or replace function find_unconverted_inquiries(p_lookback_hours int)
returns table (
  clinic_id   uuid,
  patient_id  uuid,
  phone_e164  text,
  clinic_name text
)
language sql stable
as $$
  select distinct
    w.clinic_id,
    w.patient_id,
    p.phone_e164,
    c.name as clinic_name
  from whatsapp_conversations w
  join patients p on p.id = w.patient_id
  join clinics  c on c.id = w.clinic_id
  where w.direction = 'inbound'
    and w.created_at > now() - make_interval(hours => p_lookback_hours)
    and w.patient_id is not null
    and not exists (
      select 1
      from appointment_slots a
      where a.patient_id = w.patient_id
        and a.created_at > w.created_at
    );
$$;

create or replace function find_due_medications(p_window_minutes int)
returns table (
  clinic_id      uuid,
  patient_id     uuid,
  phone_e164     text,
  chemical_salt  text,
  exact_time     text
)
language sql stable
as $$
  select
    m.clinic_id,
    m.patient_id,
    p.phone_e164,
    m.chemical_salt,
    to_char(t, 'HH24:MI') as exact_time
  from medication_timelines m
  join patients p on p.id = m.patient_id
  cross join lateral unnest(m.exact_times) as t
  where m.is_active
    and current_date between m.starts_on and coalesce(m.ends_on, current_date)
    and t between (current_time - make_interval(mins => p_window_minutes))
              and (current_time + make_interval(mins => p_window_minutes));
$$;

create or replace function find_pre_procedure_due()
returns table (
  clinic_id      uuid,
  patient_id     uuid,
  phone_e164     text,
  procedure_name text,
  hours_before   int
)
language sql stable
as $$
  select
    a.clinic_id,
    a.patient_id,
    p.phone_e164,
    coalesce(a.reason, 'procedure') as procedure_name,
    case
      when a.starts_at between now() + interval '23 hours'
                           and now() + interval '25 hours' then 24
      when a.starts_at between now() + interval '5 hours'
                           and now() + interval '7 hours'  then 6
    end as hours_before
  from appointment_slots a
  join patients p on p.id = a.patient_id
  where a.status = 'confirmed'
    and a.patient_id is not null
    and (
      a.starts_at between now() + interval '23 hours' and now() + interval '25 hours'
      or
      a.starts_at between now() + interval '5 hours'  and now() + interval '7 hours'
    );
$$;
