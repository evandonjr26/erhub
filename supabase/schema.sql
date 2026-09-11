-- ERHub database schema. Apply to a new Supabase project.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  invite_code text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  name text not null default '', bed text not null default '',
  age smallint check (age is null or age between 0 and 130),
  diagnosis text not null default '',
  handoff_notes text not null default '',
  priority text not null default 'yellow' check (priority in ('red','yellow','green')),
  responsible text not null default '', entered_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active','discharged','transferred')),
  outcome_at timestamptz, sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, room_id)
);

create table public.pending_items (
  id uuid primary key default gen_random_uuid(), patient_id uuid not null, room_id uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 240),
  done boolean not null default false, position integer not null default 0,
  due_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (patient_id, room_id) references public.patients(id, room_id) on delete cascade
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  entity text not null, record_id uuid,
  action text not null check (action in ('insert','update','delete')),
  before_data jsonb, after_data jsonb, occurred_at timestamptz not null default now()
);

create index room_members_user_id_idx on public.room_members(user_id);
create index rooms_created_by_idx on public.rooms(created_by);
create index patients_room_status_order_idx on public.patients(room_id,status,sort_order);
create index patients_created_by_idx on public.patients(created_by);
create index patients_updated_by_idx on public.patients(updated_by);
create index pending_items_room_patient_position_idx on public.pending_items(room_id,patient_id,position);
create index pending_items_patient_room_idx on public.pending_items(patient_id,room_id);
create index pending_items_created_by_idx on public.pending_items(created_by);
create index pending_items_updated_by_idx on public.pending_items(updated_by);
create index pending_items_room_due_idx on public.pending_items(room_id,due_at) where done=false;
create index pending_items_assigned_to_idx on public.pending_items(assigned_to) where assigned_to is not null;
create index audit_log_room_occurred_idx on public.audit_log(room_id,occurred_at desc);
create index audit_log_user_id_idx on public.audit_log(user_id);

create function private.is_room_member(target_room_id uuid) returns boolean
language sql stable security definer set search_path=''
as $$ select (select auth.uid()) is not null and exists (
  select 1 from public.room_members where room_id=target_room_id and user_id=(select auth.uid())
) $$;
revoke all on function private.is_room_member(uuid) from public,anon;
grant execute on function private.is_room_member(uuid) to authenticated;

create function private.shares_room(target_user_id uuid) returns boolean
language sql stable security definer set search_path=''
as $$ select (select auth.uid()) is not null and exists (
  select 1 from public.room_members mine join public.room_members theirs on theirs.room_id=mine.room_id
  where mine.user_id=(select auth.uid()) and theirs.user_id=target_user_id
) $$;
revoke all on function private.shares_room(uuid) from public,anon;
grant execute on function private.shares_room(uuid) to authenticated;

create function private.set_updated_at() returns trigger language plpgsql set search_path=''
as $$ begin new.updated_at=now(); return new; end $$;

create function private.create_profile() returns trigger language plpgsql security definer set search_path=''
as $$ begin insert into public.profiles(id,display_name) values(new.id,nullif(trim(coalesce(new.raw_user_meta_data->>'display_name','')),'')); return new; end $$;

create function private.write_audit() returns trigger language plpgsql security definer set search_path=''
as $$
declare row_data jsonb;
begin
  row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_log(room_id,user_id,entity,record_id,action,before_data,after_data)
  values((row_data->>'room_id')::uuid,(select auth.uid()),tg_table_name,(row_data->>'id')::uuid,lower(tg_op),
    case when tg_op='INSERT' then null else to_jsonb(old) end,
    case when tg_op='DELETE' then null else to_jsonb(new) end);
  return case when tg_op='DELETE' then old else new end;
end $$;

revoke all on function private.set_updated_at(), private.create_profile(), private.write_audit() from public,anon,authenticated;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger rooms_set_updated_at before update on public.rooms for each row execute function private.set_updated_at();
create trigger patients_set_updated_at before update on public.patients for each row execute function private.set_updated_at();
create trigger pending_items_set_updated_at before update on public.pending_items for each row execute function private.set_updated_at();
create trigger auth_user_created_profile after insert on auth.users for each row execute function private.create_profile();
create trigger patients_audit after insert or update or delete on public.patients for each row execute function private.write_audit();
create trigger pending_items_audit after insert or update or delete on public.pending_items for each row execute function private.write_audit();

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.patients enable row level security;
alter table public.pending_items enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_select_room_or_self on public.profiles for select to authenticated using((select auth.uid())=id or (select private.shares_room(id)));
create policy profiles_update_self on public.profiles for update to authenticated using((select auth.uid())=id) with check((select auth.uid())=id);
create policy rooms_select_member on public.rooms for select to authenticated using((select private.is_room_member(id)));
create policy rooms_update_owner_admin on public.rooms for update to authenticated
using(exists(select 1 from public.room_members where room_id=id and user_id=(select auth.uid()) and role in('owner','admin')))
with check(exists(select 1 from public.room_members where room_id=id and user_id=(select auth.uid()) and role in('owner','admin')));
create policy room_members_select_same_room on public.room_members for select to authenticated using((select private.is_room_member(room_id)));
create policy patients_select_member on public.patients for select to authenticated using((select private.is_room_member(room_id)));
create policy patients_insert_member on public.patients for insert to authenticated with check((select private.is_room_member(room_id)) and created_by=(select auth.uid()) and updated_by=(select auth.uid()));
create policy patients_update_member on public.patients for update to authenticated using((select private.is_room_member(room_id))) with check((select private.is_room_member(room_id)) and updated_by=(select auth.uid()));
create policy patients_delete_member on public.patients for delete to authenticated using((select private.is_room_member(room_id)));
create policy pending_items_select_member on public.pending_items for select to authenticated using((select private.is_room_member(room_id)));
create policy pending_items_insert_member on public.pending_items for insert to authenticated with check((select private.is_room_member(room_id)) and created_by=(select auth.uid()) and updated_by=(select auth.uid()));
create policy pending_items_update_member on public.pending_items for update to authenticated using((select private.is_room_member(room_id))) with check((select private.is_room_member(room_id)) and updated_by=(select auth.uid()));
create policy pending_items_delete_member on public.pending_items for delete to authenticated using((select private.is_room_member(room_id)));
create policy audit_log_select_member on public.audit_log for select to authenticated using((select private.is_room_member(room_id)));

create function public.create_room(room_name text) returns table(created_room_id uuid,created_invite_code text)
language plpgsql security definer set search_path=''
as $$
declare new_room_id uuid; new_code text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if char_length(trim(room_name)) not between 2 and 80 then raise exception 'Room name must contain 2 to 80 characters'; end if;
  loop
    new_code:=upper(substr(md5(random()::text||clock_timestamp()::text),1,8));
    exit when not exists(select 1 from public.rooms where invite_code=new_code);
  end loop;
  insert into public.rooms(name,invite_code,created_by) values(trim(room_name),new_code,(select auth.uid())) returning id into new_room_id;
  insert into public.room_members(room_id,user_id,role) values(new_room_id,(select auth.uid()),'owner');
  return query select new_room_id,new_code;
end $$;

create function public.join_room(invite_code_input text) returns uuid language plpgsql security definer set search_path=''
as $$
declare found_room_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select id into found_room_id from public.rooms where invite_code=upper(trim(invite_code_input));
  if found_room_id is null then raise exception 'Invalid invite code'; end if;
  insert into public.room_members(room_id,user_id,role) values(found_room_id,(select auth.uid()),'member') on conflict do nothing;
  return found_room_id;
end $$;

revoke all on function public.create_room(text),public.join_room(text) from public,anon;
grant execute on function public.create_room(text),public.join_room(text) to authenticated;
revoke all on table public.profiles,public.rooms,public.room_members,public.patients,public.pending_items,public.audit_log from anon;
grant select,update on public.profiles,public.rooms to authenticated;
grant select on public.room_members,public.audit_log to authenticated;
grant select,insert,update,delete on public.patients,public.pending_items to authenticated;
grant usage,select on sequence public.audit_log_id_seq to authenticated;
alter publication supabase_realtime add table public.patients,public.pending_items;
