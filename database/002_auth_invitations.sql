-- FI Espace V1 — 002 : comptes sur invitation, annuaire interne, intégrité et durcissement.
-- À appliquer APRÈS 001_schema.sql, dans Supabase → SQL Editor. Ré-exécutable sans effet de bord.

-- 1) Informations minimales sur les comptes responsables.
--    display_name : nom affiché dans l'application ; email : visible des seuls administrateurs.
alter table public.user_roles add column if not exists display_name text;
alter table public.user_roles add column if not exists email text;
alter table public.user_roles add column if not exists invited_by uuid references auth.users(id) on delete set null;
alter table public.user_roles drop constraint if exists user_roles_len;
alter table public.user_roles add constraint user_roles_len
  check (char_length(coalesce(display_name, '')) <= 80 and char_length(coalesce(email, '')) <= 254);

-- 2) Limites de longueur : l'application n'est pas un dossier personnel.
alter table public.fi_members drop constraint if exists fi_members_len;
alter table public.fi_members add constraint fi_members_len
  check (char_length(display_name) <= 80 and char_length(coalesce(availability, '')) <= 80);
alter table public.fi_events drop constraint if exists fi_events_len;
alter table public.fi_events add constraint fi_events_len
  check (char_length(title) <= 120 and char_length(coalesce(location, '')) <= 120 and char_length(coalesce(notes, '')) <= 200);
alter table public.follow_ups drop constraint if exists follow_ups_len;
alter table public.follow_ups add constraint follow_ups_len
  check (char_length(contact_label) <= 60 and char_length(next_action) <= 160);
alter table public.tasks drop constraint if exists tasks_len;
alter table public.tasks add constraint tasks_len
  check (char_length(title) <= 120 and char_length(coalesce(description, '')) <= 200);

-- 3) Appartenance active d'un compte à une organisation.
create or replace function public.is_org_user(target_org uuid, target_user uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles ur
                 where ur.organization_id = target_org and ur.user_id = target_user and ur.active)
$$;

-- 4) Annuaire des responsables d'une organisation (pour choisir un référent ou un assigné).
--    Réservé aux administrateurs et responsables FI ; l'e-mail n'est renvoyé qu'aux administrateurs.
create or replace function public.list_org_people(target_org uuid)
returns table (user_id uuid, display_name text, email text, role text, active boolean)
language sql stable security definer set search_path = public
as $$
  select ur.user_id,
         coalesce(nullif(ur.display_name, ''), 'Responsable'),
         case when public.is_fi_admin(target_org) then ur.email end,
         ur.role,
         ur.active
  from public.user_roles ur
  where ur.organization_id = target_org
    and public.is_fi_leader(target_org)
    and (ur.active or public.is_fi_admin(target_org))
  order by ur.active desc, ur.display_name
$$;
revoke execute on function public.list_org_people(uuid) from public, anon;
grant execute on function public.list_org_people(uuid) to authenticated;

-- 5) Intégrité : une ligne ne peut pas référencer une rencontre, un membre ou un compte
--    d'une autre organisation.
create or replace function public.check_org_refs()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_table_name = 'attendance' then
    if not exists (select 1 from public.fi_events e where e.id = new.event_id and e.organization_id = new.organization_id)
       or not exists (select 1 from public.fi_members m where m.id = new.member_id and m.organization_id = new.organization_id) then
      raise exception 'Rencontre ou membre hors de cette organisation';
    end if;
  elsif tg_table_name = 'fi_members' then
    if new.referent_user_id is not null then
      if tg_op = 'INSERT' then
        if not public.is_org_user(new.organization_id, new.referent_user_id) then
          raise exception 'Le référent doit être un responsable actif de cette organisation';
        end if;
      elsif new.referent_user_id is distinct from old.referent_user_id
            and not public.is_org_user(new.organization_id, new.referent_user_id) then
        raise exception 'Le référent doit être un responsable actif de cette organisation';
      end if;
    end if;
  elsif tg_table_name = 'follow_ups' then
    if new.owner_user_id is not null then
      if tg_op = 'INSERT' then
        if not public.is_org_user(new.organization_id, new.owner_user_id) then
          raise exception 'Le responsable du suivi doit être un responsable actif de cette organisation';
        end if;
      elsif new.owner_user_id is distinct from old.owner_user_id
            and not public.is_org_user(new.organization_id, new.owner_user_id) then
        raise exception 'Le responsable du suivi doit être un responsable actif de cette organisation';
      end if;
    end if;
  elsif tg_table_name = 'tasks' then
    if new.assigned_to is not null then
      if tg_op = 'INSERT' then
        if not public.is_org_user(new.organization_id, new.assigned_to) then
          raise exception 'La tâche doit être attribuée à un responsable actif de cette organisation';
        end if;
      elsif new.assigned_to is distinct from old.assigned_to
            and not public.is_org_user(new.organization_id, new.assigned_to) then
        raise exception 'La tâche doit être attribuée à un responsable actif de cette organisation';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists attendance_org_refs on public.attendance;
create trigger attendance_org_refs before insert or update on public.attendance
  for each row execute function public.check_org_refs();
drop trigger if exists fi_members_org_refs on public.fi_members;
create trigger fi_members_org_refs before insert or update on public.fi_members
  for each row execute function public.check_org_refs();
drop trigger if exists follow_ups_org_refs on public.follow_ups;
create trigger follow_ups_org_refs before insert or update on public.follow_ups
  for each row execute function public.check_org_refs();
drop trigger if exists tasks_org_refs on public.tasks;
create trigger tasks_org_refs before insert or update on public.tasks
  for each row execute function public.check_org_refs();

-- 6) Auteur et horodatage fixés par le serveur (non falsifiables depuis le navigateur).
alter table public.fi_events alter column created_by set default auth.uid();
alter table public.follow_ups alter column created_by set default auth.uid();
alter table public.tasks alter column created_by set default auth.uid();
alter table public.attendance alter column recorded_by set default auth.uid();

create or replace function public.stamp_author()
returns trigger language plpgsql set search_path = public
as $$
begin
  if auth.uid() is not null then
    if tg_table_name = 'attendance' then
      new.recorded_by := auth.uid();
      new.updated_at := now();
    elsif tg_op = 'INSERT' then
      new.created_by := auth.uid();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists fi_events_stamp on public.fi_events;
create trigger fi_events_stamp before insert on public.fi_events
  for each row execute function public.stamp_author();
drop trigger if exists follow_ups_stamp on public.follow_ups;
create trigger follow_ups_stamp before insert on public.follow_ups
  for each row execute function public.stamp_author();
drop trigger if exists tasks_stamp on public.tasks;
create trigger tasks_stamp before insert on public.tasks
  for each row execute function public.stamp_author();
drop trigger if exists attendance_stamp on public.attendance;
create trigger attendance_stamp before insert or update on public.attendance
  for each row execute function public.stamp_author();

-- 7) Date de fin de tâche tenue à jour automatiquement.
create or replace function public.set_task_completed_at()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' then
      new.completed_at := coalesce(new.completed_at, now());
    elsif old.status is distinct from 'done' then
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists tasks_completed_at on public.tasks;
create trigger tasks_completed_at before insert or update on public.tasks
  for each row execute function public.set_task_completed_at();

-- 8) Une organisation garde toujours au moins un administrateur actif.
--    Ne s'applique qu'aux requêtes d'utilisateurs connectés (pas au tableau de bord Supabase).
create or replace function public.guard_last_admin()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and old.role = 'admin' and old.active then
    if tg_op = 'DELETE' or new.role <> 'admin' or not new.active
       or new.organization_id is distinct from old.organization_id then
      if not exists (select 1 from public.user_roles ur
                     where ur.organization_id = old.organization_id and ur.role = 'admin'
                       and ur.active and ur.user_id <> old.user_id) then
        raise exception 'Impossible de retirer le dernier administrateur de l''organisation';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists user_roles_guard_last_admin on public.user_roles;
create trigger user_roles_guard_last_admin before update or delete on public.user_roles
  for each row execute function public.guard_last_admin();

-- 9) Aucun accès pour les visiteurs non connectés (le rôle anon reçoit des droits par défaut sur Supabase).
revoke all on public.organizations, public.user_roles, public.fi_members, public.fi_events,
  public.attendance, public.follow_ups, public.tasks from anon;
