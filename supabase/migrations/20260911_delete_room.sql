-- Allow only the room owner to delete a room.
-- Patients, pending items, memberships and audit entries are removed by foreign-key cascades.
create or replace function public.delete_room(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if not exists (
    select 1 from public.room_members
    where room_id = target_room_id
      and user_id = (select auth.uid())
      and role = 'owner'
  ) then
    raise exception 'Only the room owner can delete it';
  end if;
  delete from public.rooms where id = target_room_id;
end
$$;
revoke all on function public.delete_room(uuid) from public, anon;
grant execute on function public.delete_room(uuid) to authenticated;
