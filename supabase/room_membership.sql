CREATE OR REPLACE FUNCTION private.write_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare row_data jsonb;
begin
 row_data := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if not exists(select 1 from public.rooms where id=(row_data->>'room_id')::uuid) then
 return case when tg_op='DELETE' then old else new end;
 end if;
 insert into public.audit_log(room_id,user_id,entity,record_id,action,before_data,after_data)
 values((row_data->>'room_id')::uuid,auth.uid(),tg_table_name,(row_data->>'id')::uuid,lower(tg_op),
 case when tg_op='INSERT' then null else to_jsonb(old) end,
 case when tg_op='DELETE' then null else to_jsonb(new) end);
 return case when tg_op='DELETE' then old else new end;
end $$;
CREATE OR REPLACE FUNCTION private.manage_room_membership(target_room_id uuid,target_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
declare actor uuid:=auth.uid(); creator uuid;
begin
 if actor is null then raise exception 'Authentication required'; end if;
 select created_by into creator from public.rooms where id=target_room_id for update;
 if creator is null then raise exception 'Sala não encontrada.'; end if;
 if target_user_id=creator or exists(select 1 from public.room_members where room_id=target_room_id and user_id=target_user_id and role='owner') then
 raise exception 'O criador não pode sair da própria sala. Use Excluir sala.'; end if;
 if actor<>target_user_id and actor<>creator then raise exception 'Somente o criador pode remover participantes.'; end if;
 if not exists(select 1 from public.room_members where room_id=target_room_id and user_id=actor) then raise exception 'Você não participa desta sala.'; end if;
 delete from public.room_members where room_id=target_room_id and user_id=target_user_id;
 if not found then raise exception 'Participante não encontrado.'; end if;
 if actor<>target_user_id then
 update public.rooms set invite_code=upper(substr(md5(random()::text||clock_timestamp()::text),1,8)) where id=target_room_id;
 end if;
end $$;
REVOKE ALL ON FUNCTION private.manage_room_membership(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.manage_room_membership(uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.leave_room(target_room_id uuid) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ select private.manage_room_membership(target_room_id,auth.uid()); $$;
CREATE OR REPLACE FUNCTION public.remove_room_member(target_room_id uuid,target_user_id uuid) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ select private.manage_room_membership(target_room_id,target_user_id); $$;
REVOKE ALL ON FUNCTION public.leave_room(uuid),public.remove_room_member(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.leave_room(uuid),public.remove_room_member(uuid,uuid) TO authenticated;