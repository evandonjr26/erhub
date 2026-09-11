alter table public.patients
  add column if not exists handoff_notes text not null default '';

alter table public.pending_items
  add column if not exists due_at timestamptz,
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists priority text not null default 'normal';

do $$ begin
  alter table public.pending_items
    add constraint pending_items_priority_check check (priority in ('low','normal','high'));
exception when duplicate_object then null;
end $$;

create index if not exists pending_items_room_due_idx
  on public.pending_items(room_id, due_at) where done = false;
create index if not exists pending_items_assigned_to_idx
  on public.pending_items(assigned_to) where assigned_to is not null;

create or replace function private.shares_room(target_user_id uuid) returns boolean
language sql stable security definer set search_path=''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.room_members mine
    join public.room_members theirs on theirs.room_id = mine.room_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = target_user_id
  )
$$;

revoke all on function private.shares_room(uuid) from public, anon;
grant execute on function private.shares_room(uuid) to authenticated;

drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_shared_room on public.profiles;
create policy profiles_select_room_or_self on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id or (select private.shares_room(id)));
