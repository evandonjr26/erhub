alter table public.patients
  add column if not exists outcome_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'patients_outcome_type_check'
      and conrelid = 'public.patients'::regclass
  ) then
    alter table public.patients
      add constraint patients_outcome_type_check
      check (outcome_type is null or outcome_type in (
        'discharge',
        'internal_transfer',
        'external_transfer',
        'admission',
        'death'
      ));
  end if;
end
$$;

comment on column public.patients.outcome_type is
  'Operational outcome: discharge, internal_transfer, external_transfer, admission, or death.';
