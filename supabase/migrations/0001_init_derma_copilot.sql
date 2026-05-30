-- =============================================================================
-- DERMA-COPILOT — PHASE 1 INITIAL MIGRATION
-- =============================================================================
-- Conventions:
--   * All PKs are uuid (gen_random_uuid).
--   * All tenant tables carry clinic_id for RLS scoping.
--   * created_at / updated_at on every mutable row.
--   * Enums enforce clinical sequence integrity.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- -----------------------------------------------------------------------------
-- 1. ENUMS — Clinical Sequence + Operational States
-- -----------------------------------------------------------------------------

create type medical_record_stage as enum (
  'symptom',
  'diagnosis',
  'prescription',
  'lab_test'
);

create type message_direction as enum ('inbound', 'outbound');

create type message_status as enum (
  'queued', 'sent', 'delivered', 'read', 'failed', 'undelivered', 'received'
);

create type appointment_status as enum (
  'requested', 'confirmed', 'rescheduled', 'completed', 'no_show', 'cancelled'
);

create type payment_status as enum ('pending', 'paid', 'refunded', 'failed');

create type food_relation as enum ('before_food', 'after_food', 'with_food', 'irrelevant');

create type patient_sex as enum ('female', 'male', 'other', 'unspecified');

-- -----------------------------------------------------------------------------
-- 2. TENANT ROOT — Clinics
-- -----------------------------------------------------------------------------

create table clinics (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  legal_name      text,
  gst_number      citext,
  twilio_number   text not null unique,
  timezone        text not null default 'Asia/Kolkata',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 3. PRINCIPALS — Doctors & Staff
-- -----------------------------------------------------------------------------

create table doctors (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid not null unique references auth.users(id) on delete cascade,
  clinic_id       uuid not null references clinics(id) on delete cascade,
  full_name       text not null,
  registration_no text not null,
  specialization  text not null default 'Dermatology',
  created_at      timestamptz not null default now()
);

create index idx_doctors_clinic on doctors(clinic_id);

create table staff (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid not null unique references auth.users(id) on delete cascade,
  clinic_id       uuid not null references clinics(id) on delete cascade,
  full_name       text not null,
  role            text not null check (role in ('front_desk','nurse','admin','billing')),
  created_at      timestamptz not null default now()
);

create index idx_staff_clinic on staff(clinic_id);

-- -----------------------------------------------------------------------------
-- 4. PATIENTS — Twilio E.164 enforced
-- -----------------------------------------------------------------------------

create table patients (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references clinics(id) on delete cascade,
  full_name           text not null,
  phone_e164          text not null,
  date_of_birth       date,
  sex                 patient_sex not null default 'unspecified',
  is_influencer       boolean not null default false,
  social_handles      jsonb,
  primary_doctor_id   uuid references doctors(id) on delete set null,
  consent_whatsapp    boolean not null default false,
  consent_data_share  boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint phone_e164_format check (phone_e164 ~ '^\+[1-9]\d{7,14}$'),
  unique (clinic_id, phone_e164)
);

create index idx_patients_clinic on patients(clinic_id);
create index idx_patients_phone on patients(phone_e164);

-- -----------------------------------------------------------------------------
-- 5. MEDICAL RECORDS — Enforced Chronological + Categorical Sequence
-- -----------------------------------------------------------------------------

create table medical_records (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics(id) on delete cascade,
  patient_id      uuid not null references patients(id) on delete cascade,
  doctor_id       uuid references doctors(id) on delete set null,
  visit_id        uuid,
  stage           medical_record_stage not null,
  recorded_at     timestamptz not null default now(),

  symptom         jsonb,
  diagnosis       jsonb,
  prescription_id uuid,
  lab_test        jsonb,

  source          text not null check (source in ('whatsapp_ocr','manual_entry','voice_dictation','lab_import')),
  source_media_path text,
  created_at      timestamptz not null default now(),

  constraint stage_payload_consistency check (
    (stage = 'symptom'      and symptom is not null      and diagnosis is null and prescription_id is null and lab_test is null) or
    (stage = 'diagnosis'    and diagnosis is not null    and symptom is null   and prescription_id is null and lab_test is null) or
    (stage = 'prescription' and prescription_id is not null and symptom is null and diagnosis is null      and lab_test is null) or
    (stage = 'lab_test'     and lab_test is not null     and symptom is null   and diagnosis is null      and prescription_id is null)
  )
);

create index idx_mr_patient_time on medical_records(patient_id, recorded_at desc);
create index idx_mr_clinic on medical_records(clinic_id);
create index idx_mr_visit on medical_records(visit_id);

-- -----------------------------------------------------------------------------
-- 6. PRESCRIPTIONS & MEDICATION TIMELINES
-- -----------------------------------------------------------------------------

create table prescriptions (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics(id) on delete cascade,
  patient_id      uuid not null references patients(id) on delete cascade,
  doctor_id       uuid references doctors(id) on delete set null,
  issued_at       timestamptz not null default now(),
  notes           text,
  created_at      timestamptz not null default now()
);

create index idx_rx_patient on prescriptions(patient_id);

create table medication_timelines (
  id                   uuid primary key default gen_random_uuid(),
  clinic_id            uuid not null references clinics(id) on delete cascade,
  prescription_id      uuid not null references prescriptions(id) on delete cascade,
  patient_id           uuid not null references patients(id) on delete cascade,

  brand_name           text,
  chemical_salt        text not null,
  dosage_value         numeric(10,3),
  dosage_unit          text,
  route                text,

  exact_times          time[] not null default array[]::time[],
  food_relation        food_relation not null default 'irrelevant',
  duration_days        int,
  starts_on            date not null default current_date,
  ends_on              date,

  generic_substitutes  text[] default array[]::text[],
  is_active            boolean not null default true,
  created_at           timestamptz not null default now()
);

create index idx_med_patient_active on medication_timelines(patient_id, is_active);
create index idx_med_salt on medication_timelines(chemical_salt);

alter table medical_records
  add constraint fk_mr_prescription
  foreign key (prescription_id) references prescriptions(id) on delete set null;

-- -----------------------------------------------------------------------------
-- 7. WHATSAPP CONVERSATIONS
-- -----------------------------------------------------------------------------

create table whatsapp_conversations (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references clinics(id) on delete cascade,
  patient_id          uuid references patients(id) on delete set null,
  twilio_message_sid  text not null unique,
  direction           message_direction not null,
  status              message_status not null,
  from_number         text not null,
  to_number           text not null,
  body                text,
  media_count         int not null default 0,
  media_storage_paths text[] default array[]::text[],
  template_sid        text,
  template_variables  jsonb,
  error_code          int,
  error_message       text,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_wac_clinic_time on whatsapp_conversations(clinic_id, created_at desc);
create index idx_wac_patient on whatsapp_conversations(patient_id);
create index idx_wac_sid on whatsapp_conversations(twilio_message_sid);

-- -----------------------------------------------------------------------------
-- 8. APPOINTMENT SLOTS, TREATMENT BUNDLES, PAYMENTS
-- -----------------------------------------------------------------------------

create table appointment_slots (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics(id) on delete cascade,
  doctor_id       uuid not null references doctors(id) on delete cascade,
  patient_id      uuid references patients(id) on delete set null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  status          appointment_status not null default 'requested',
  reason          text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint valid_time_range check (ends_at > starts_at)
);

create index idx_apt_doctor_time on appointment_slots(doctor_id, starts_at);
create index idx_apt_clinic_time on appointment_slots(clinic_id, starts_at);

create table treatment_bundles (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics(id) on delete cascade,
  name            text not null,
  description     text,
  duration_weeks  int not null,
  price_inr_paise bigint not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create table payments (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references clinics(id) on delete cascade,
  patient_id        uuid not null references patients(id) on delete cascade,
  appointment_id    uuid references appointment_slots(id) on delete set null,
  bundle_id         uuid references treatment_bundles(id) on delete set null,
  amount_inr_paise  bigint not null check (amount_inr_paise >= 0),
  status            payment_status not null default 'pending',
  gateway           text,
  gateway_ref       text,
  paid_at           timestamptz,
  created_at        timestamptz not null default now()
);

create index idx_pay_clinic_status on payments(clinic_id, status);
create index idx_pay_patient on payments(patient_id);

-- -----------------------------------------------------------------------------
-- 9. EFFICACY SNAPSHOTS
-- -----------------------------------------------------------------------------

create table efficacy_snapshots (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics(id) on delete cascade,
  patient_id      uuid not null references patients(id) on delete cascade,
  recorded_at     timestamptz not null default now(),
  severity_score  numeric(4,2) not null check (severity_score between 0 and 10),
  area_affected_cm2 numeric(8,2),
  source          text not null check (source in ('whatsapp_self_report','clinic_assessment','photo_analysis')),
  notes           text,
  created_at      timestamptz not null default now()
);

create index idx_efficacy_patient_time on efficacy_snapshots(patient_id, recorded_at);

-- -----------------------------------------------------------------------------
-- 10. updated_at TRIGGERS
-- -----------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  for t in select unnest(array[
    'clinics','patients','whatsapp_conversations','appointment_slots'
  ])
  loop
    execute format(
      'create trigger trg_updated_at_%I before update on %I
       for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 11. CANONICAL CHRONOLOGICAL VIEW
-- -----------------------------------------------------------------------------

create or replace view v_patient_timeline as
select
  mr.id,
  mr.clinic_id,
  mr.patient_id,
  mr.visit_id,
  mr.stage,
  mr.recorded_at,
  case mr.stage
    when 'symptom'      then 1
    when 'diagnosis'    then 2
    when 'prescription' then 3
    when 'lab_test'     then 4
  end as stage_order,
  mr.symptom, mr.diagnosis, mr.prescription_id, mr.lab_test
from medical_records mr
order by mr.patient_id, mr.recorded_at, stage_order;

-- =============================================================================
-- 12. ROW-LEVEL SECURITY
-- =============================================================================

create or replace function auth_clinic_id() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select clinic_id from doctors where auth_user_id = auth.uid() limit 1),
    (select clinic_id from staff   where auth_user_id = auth.uid() limit 1)
  );
$$;

create or replace function auth_doctor_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from doctors where auth_user_id = auth.uid() limit 1;
$$;

alter table clinics                enable row level security;
alter table doctors                enable row level security;
alter table staff                  enable row level security;
alter table patients               enable row level security;
alter table medical_records        enable row level security;
alter table prescriptions          enable row level security;
alter table medication_timelines   enable row level security;
alter table whatsapp_conversations enable row level security;
alter table appointment_slots      enable row level security;
alter table treatment_bundles      enable row level security;
alter table payments               enable row level security;
alter table efficacy_snapshots     enable row level security;

create policy "clinic_isolation_select" on patients
  for select using (clinic_id = auth_clinic_id());
create policy "clinic_isolation_modify" on patients
  for all using (clinic_id = auth_clinic_id())
  with check (clinic_id = auth_clinic_id());

create policy "doctor_reads_own_clinic_medical_records"
  on medical_records
  for select
  using (
    clinic_id = auth_clinic_id()
    and exists (
      select 1 from doctors d
      where d.auth_user_id = auth.uid()
        and d.clinic_id = medical_records.clinic_id
    )
  );

create policy "doctor_writes_own_clinic_medical_records"
  on medical_records
  for insert
  with check (
    clinic_id = auth_clinic_id()
    and doctor_id = auth_doctor_id()
  );

create policy "wac_clinic_isolation" on whatsapp_conversations
  for all using (clinic_id = auth_clinic_id())
  with check (clinic_id = auth_clinic_id());

create policy "med_clinic_isolation" on medication_timelines
  for all using (clinic_id = auth_clinic_id())
  with check (clinic_id = auth_clinic_id());

create policy "rx_clinic_isolation" on prescriptions
  for all using (clinic_id = auth_clinic_id())
  with check (clinic_id = auth_clinic_id());

create policy "apt_clinic_isolation" on appointment_slots
  for all using (clinic_id = auth_clinic_id())
  with check (clinic_id = auth_clinic_id());

create policy "pay_clinic_isolation" on payments
  for all using (clinic_id = auth_clinic_id())
  with check (clinic_id = auth_clinic_id());

create policy "bundle_clinic_isolation" on treatment_bundles
  for all using (clinic_id = auth_clinic_id())
  with check (clinic_id = auth_clinic_id());

create policy "efficacy_clinic_isolation" on efficacy_snapshots
  for all using (clinic_id = auth_clinic_id())
  with check (clinic_id = auth_clinic_id());
