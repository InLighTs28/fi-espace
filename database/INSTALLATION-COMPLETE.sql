-- FI espace — INSTALLATION COMPLÈTE (généré par scripts/build-install-sql.mjs, ne pas modifier à la main).
-- Contient, dans l'ordre : 001_schema.sql, 002_auth_invitations.sql, 003_tuteurs_photos_notifications.sql, 004_roles_membres_evenements.sql, 005_abonnement_agenda.sql.
-- Supabase → SQL Editor → New query → coller tout ce fichier → Run. À exécuter UNE seule fois :
-- tout s'applique d'un bloc (ou rien en cas d'erreur), et le script refuse de tourner sur une base déjà installée.

begin;

do $guard$ begin
  if to_regclass('public.org_roles') is not null then
    raise exception 'FI espace est déjà installé sur cette base : rien n''a été modifié.';
  end if;
end $guard$;

-- ════════════════ 001_schema.sql ════════════════
-- FI Espace V1 — Supabase/PostgreSQL schema.
-- Apply to a new Supabase project. Bootstrap the first admin as described in README.md.
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check (role in ('admin','fi_leader','deputy')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, organization_id)
);

create table if not exists public.fi_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null,
  status text not null default 'active' check (status in ('active','occasional','to_contact','former')),
  availability text,
  referent_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fi_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.fi_events(id) on delete cascade,
  member_id uuid not null references public.fi_members(id) on delete cascade,
  state text not null check (state in ('present','absent','excused','unknown')),
  recorded_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (event_id, member_id)
);

-- Keep follow-up notes deliberately brief and limited to FI leaders/admins.
create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_label text not null,
  next_action text not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  due_at date,
  status text not null default 'open' check (status in ('open','planned','done')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text,
  assigned_to uuid references auth.users(id) on delete set null,
  due_at date,
  status text not null default 'todo' check (status in ('todo','in_progress','done')),
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fi_members_org_idx on public.fi_members(organization_id);
create index if not exists fi_events_org_date_idx on public.fi_events(organization_id, starts_at);
create index if not exists attendance_org_event_idx on public.attendance(organization_id, event_id);
create index if not exists follow_ups_org_due_idx on public.follow_ups(organization_id, due_at);
create index if not exists tasks_org_owner_due_idx on public.tasks(organization_id, assigned_to, due_at);

create or replace function public.current_fi_role(target_org uuid)
returns text language sql stable security definer set search_path = public
as $$
  select ur.role from public.user_roles ur
  where ur.user_id = (select auth.uid()) and ur.organization_id = target_org and ur.active = true
  limit 1
$$;

create or replace function public.is_fi_admin(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_fi_role(target_org) = 'admin', false) $$;

create or replace function public.is_fi_leader(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_fi_role(target_org) in ('admin','fi_leader'), false) $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists fi_members_touch on public.fi_members;
create trigger fi_members_touch before update on public.fi_members for each row execute function public.touch_updated_at();
drop trigger if exists follow_ups_touch on public.follow_ups;
create trigger follow_ups_touch before update on public.follow_ups for each row execute function public.touch_updated_at();
drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();

-- A deputy may change task progress only, and only for tasks assigned to them.
create or replace function public.guard_deputy_task_update()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if public.current_fi_role(old.organization_id) = 'deputy' then
    if old.assigned_to is distinct from (select auth.uid())
      or new.organization_id is distinct from old.organization_id
      or new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.assigned_to is distinct from old.assigned_to
      or new.due_at is distinct from old.due_at
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'Deputies may only update progress on tasks assigned to them';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tasks_guard_deputy on public.tasks;
create trigger tasks_guard_deputy before update on public.tasks for each row execute function public.guard_deputy_task_update();

alter table public.organizations enable row level security;
alter table public.user_roles enable row level security;
alter table public.fi_members enable row level security;
alter table public.fi_events enable row level security;
alter table public.attendance enable row level security;
alter table public.follow_ups enable row level security;
alter table public.tasks enable row level security;

drop policy if exists "users read own organization" on public.organizations;
create policy "users read own organization" on public.organizations for select to authenticated
  using (exists(select 1 from public.user_roles ur where ur.organization_id=id and ur.user_id=(select auth.uid()) and ur.active));
drop policy if exists "admins update organization" on public.organizations;
create policy "admins update organization" on public.organizations for update to authenticated
  using (public.is_fi_admin(id)) with check (public.is_fi_admin(id));

drop policy if exists "read own role or admin manages roles" on public.user_roles;
create policy "read own role or admin manages roles" on public.user_roles for select to authenticated
  using (user_id=(select auth.uid()) or public.is_fi_admin(organization_id));
drop policy if exists "admins insert roles" on public.user_roles;
create policy "admins insert roles" on public.user_roles for insert to authenticated
  with check (public.is_fi_admin(organization_id));
drop policy if exists "admins update roles" on public.user_roles;
create policy "admins update roles" on public.user_roles for update to authenticated
  using (public.is_fi_admin(organization_id)) with check (public.is_fi_admin(organization_id));
drop policy if exists "admins delete roles" on public.user_roles;
create policy "admins delete roles" on public.user_roles for delete to authenticated
  using (public.is_fi_admin(organization_id));

drop policy if exists "leaders manage members" on public.fi_members;
create policy "leaders manage members" on public.fi_members for all to authenticated
  using (public.is_fi_leader(organization_id)) with check (public.is_fi_leader(organization_id));
drop policy if exists "leaders manage events" on public.fi_events;
create policy "leaders manage events" on public.fi_events for all to authenticated
  using (public.is_fi_leader(organization_id)) with check (public.is_fi_leader(organization_id));
drop policy if exists "leaders manage attendance" on public.attendance;
create policy "leaders manage attendance" on public.attendance for all to authenticated
  using (public.is_fi_leader(organization_id)) with check (public.is_fi_leader(organization_id));
drop policy if exists "leaders manage followups" on public.follow_ups;
create policy "leaders manage followups" on public.follow_ups for all to authenticated
  using (public.is_fi_leader(organization_id)) with check (public.is_fi_leader(organization_id));
drop policy if exists "organization reads events" on public.fi_events;
create policy "organization reads events" on public.fi_events for select to authenticated
  using (public.current_fi_role(organization_id) in ('admin','fi_leader','deputy'));

drop policy if exists "leaders manage all tasks; deputies read assigned" on public.tasks;
create policy "leaders manage all tasks; deputies read assigned" on public.tasks for select to authenticated
  using (public.is_fi_leader(organization_id) or (public.current_fi_role(organization_id)='deputy' and assigned_to=(select auth.uid())));
drop policy if exists "leaders create tasks" on public.tasks;
create policy "leaders create tasks" on public.tasks for insert to authenticated
  with check (public.is_fi_leader(organization_id));
drop policy if exists "leaders or assigned deputy update tasks" on public.tasks;
create policy "leaders or assigned deputy update tasks" on public.tasks for update to authenticated
  using (public.is_fi_leader(organization_id) or (public.current_fi_role(organization_id)='deputy' and assigned_to=(select auth.uid())))
  with check (public.is_fi_leader(organization_id) or (public.current_fi_role(organization_id)='deputy' and assigned_to=(select auth.uid())));
drop policy if exists "leaders delete tasks" on public.tasks;
create policy "leaders delete tasks" on public.tasks for delete to authenticated
  using (public.is_fi_leader(organization_id));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.organizations, public.user_roles, public.fi_members,
  public.fi_events, public.attendance, public.follow_ups, public.tasks to authenticated;

-- ════════════════ 002_auth_invitations.sql ════════════════
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

-- ════════════════ 003_tuteurs_photos_notifications.sql ════════════════
-- FI Espace V1 — 003 : tuteurs, photos de profil, préférences et journal des rappels e-mail.
-- À appliquer APRÈS 002, dans Supabase → SQL Editor. Ré-exécutable.

-- 1) « Référent » devient « tuteur ».
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'fi_members' and column_name = 'referent_user_id') then
    alter table public.fi_members rename column referent_user_id to tutor_user_id;
  end if;
end $$;

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
    if new.tutor_user_id is not null then
      if tg_op = 'INSERT' then
        if not public.is_org_user(new.organization_id, new.tutor_user_id) then
          raise exception 'Le tuteur doit être un responsable actif de cette organisation';
        end if;
      elsif new.tutor_user_id is distinct from old.tutor_user_id
            and not public.is_org_user(new.organization_id, new.tutor_user_id) then
        raise exception 'Le tuteur doit être un responsable actif de cette organisation';
      end if;
    end if;
  elsif tg_table_name = 'follow_ups' then
    if new.owner_user_id is not null then
      if tg_op = 'INSERT' then
        if not public.is_org_user(new.organization_id, new.owner_user_id) then
          raise exception 'Le tuteur du suivi doit être un responsable actif de cette organisation';
        end if;
      elsif new.owner_user_id is distinct from old.owner_user_id
            and not public.is_org_user(new.organization_id, new.owner_user_id) then
        raise exception 'Le tuteur du suivi doit être un responsable actif de cette organisation';
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

-- 2) Photo de profil des membres (fichier dans le stockage privé « member-photos »).
--    Chemin imposé : <organization_id>/<member_id>.jpg — lisible uniquement par les responsables de la FI.
alter table public.fi_members add column if not exists photo_path text;
alter table public.fi_members drop constraint if exists fi_members_photo_path;
alter table public.fi_members add constraint fi_members_photo_path
  check (photo_path is null or photo_path = organization_id::text || '/' || id::text || '.jpg');

create or replace function public.try_uuid(t text)
returns uuid language plpgsql immutable
as $$ begin return t::uuid; exception when others then return null; end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-photos', 'member-photos', false, 524288, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 524288, allowed_mime_types = array['image/jpeg'];

drop policy if exists "fi leaders read member photos" on storage.objects;
create policy "fi leaders read member photos" on storage.objects for select to authenticated
  using (bucket_id = 'member-photos' and public.is_fi_leader(public.try_uuid((storage.foldername(name))[1])));
drop policy if exists "fi leaders add member photos" on storage.objects;
create policy "fi leaders add member photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'member-photos' and public.is_fi_leader(public.try_uuid((storage.foldername(name))[1])));
drop policy if exists "fi leaders replace member photos" on storage.objects;
create policy "fi leaders replace member photos" on storage.objects for update to authenticated
  using (bucket_id = 'member-photos' and public.is_fi_leader(public.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'member-photos' and public.is_fi_leader(public.try_uuid((storage.foldername(name))[1])));
drop policy if exists "fi leaders delete member photos" on storage.objects;
create policy "fi leaders delete member photos" on storage.objects for delete to authenticated
  using (bucket_id = 'member-photos' and public.is_fi_leader(public.try_uuid((storage.foldername(name))[1])));

-- 3) Préférences de rappels par e-mail (chacun gère les siennes ; absence de ligne = tout activé).
create table if not exists public.notification_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_reminders boolean not null default true,
  task_reminders boolean not null default true,
  weekly_digest boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, organization_id)
);
alter table public.notification_prefs enable row level security;
drop trigger if exists notification_prefs_touch on public.notification_prefs;
create trigger notification_prefs_touch before update on public.notification_prefs
  for each row execute function public.touch_updated_at();

drop policy if exists "own notification prefs" on public.notification_prefs;
create policy "own notification prefs" on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid()) and public.current_fi_role(organization_id) is not null)
  with check (user_id = (select auth.uid()) and public.current_fi_role(organization_id) is not null);

-- 4) Journal des rappels envoyés (évite les doublons ; écrit uniquement par la fonction serveur).
create table if not exists public.reminder_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('event','task','followup','digest','manual','test')),
  ref_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  sent_at timestamptz not null default now(),
  unique (kind, ref_key, user_id)
);
create index if not exists reminder_log_org_idx on public.reminder_log(organization_id, sent_at desc);
alter table public.reminder_log enable row level security;
drop policy if exists "admins read reminder log" on public.reminder_log;
create policy "admins read reminder log" on public.reminder_log for select to authenticated
  using (public.is_fi_admin(organization_id));

grant select, insert, update, delete on public.notification_prefs to authenticated;
grant select on public.reminder_log to authenticated;
revoke all on public.notification_prefs, public.reminder_log from anon;

-- ════════════════ 004_roles_membres_evenements.sql ════════════════
-- FI Espace V1 — 004 : rôles personnalisables (façon Discord), comptes membres, événements ciblés,
-- création du premier administrateur. À appliquer APRÈS 003, dans Supabase → SQL Editor. Ré-exécutable.
--
-- Principe : chaque compte d'une FI (table user_roles = appartenance) reçoit un ou plusieurs rôles (org_roles).
-- Chaque rôle a une couleur, une position et une liste de permissions. Les droits d'un compte sont l'union
-- des permissions de ses rôles ; « administrator » donne tout. Toutes les règles RLS s'appuient sur has_perm().

-- ───────── 1) Rôles et attribution ─────────
create table if not exists public.org_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  color text not null default '#8a918b',
  position integer not null default 0,
  permissions text[] not null default '{}',
  system_key text,
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id),
  constraint org_roles_name_len check (char_length(btrim(name)) between 1 and 40),
  constraint org_roles_color check (color ~ '^#[0-9a-fA-F]{6}$'),
  constraint org_roles_perms check (permissions <@ array['administrator','manage_members','manage_attendance',
    'manage_followups','manage_events','manage_tasks','view_all_events','view_stats','send_reminders']::text[]),
  constraint org_roles_system_key check (system_key is null or system_key in ('admin','fi_leader','deputy','member'))
);
create unique index if not exists org_roles_system_uniq on public.org_roles(organization_id, system_key) where system_key is not null;

create table if not exists public.account_roles (
  user_id uuid not null,
  organization_id uuid not null,
  role_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id),
  foreign key (user_id, organization_id) references public.user_roles(user_id, organization_id) on delete cascade,
  foreign key (role_id, organization_id) references public.org_roles(id, organization_id) on delete cascade
);
create index if not exists account_roles_org_idx on public.account_roles(organization_id, user_id);

-- ───────── 2) Fonctions de droits ─────────
create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles ur
                 where ur.user_id = (select auth.uid()) and ur.organization_id = target_org and ur.active)
$$;

create or replace function public.my_permissions(target_org uuid)
returns text[] language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(distinct p order by p), '{}')
  from public.user_roles ur
  join public.account_roles ar on ar.user_id = ur.user_id and ar.organization_id = ur.organization_id
  join public.org_roles r on r.id = ar.role_id
  cross join lateral unnest(r.permissions) as p
  where ur.user_id = (select auth.uid()) and ur.organization_id = target_org and ur.active
$$;

create or replace function public.has_perm(target_org uuid, perm text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.account_roles ar on ar.user_id = ur.user_id and ar.organization_id = ur.organization_id
    join public.org_roles r on r.id = ar.role_id
    where ur.user_id = (select auth.uid()) and ur.organization_id = target_org and ur.active
      and ('administrator' = any(r.permissions) or perm = any(r.permissions)))
$$;

-- Fonctions des migrations précédentes, désormais fondées sur les permissions.
create or replace function public.current_fi_role(target_org uuid)
returns text language sql stable security definer set search_path = public
as $$
  select case when not public.is_org_member(target_org) then null
              when public.has_perm(target_org, 'administrator') then 'admin'
              when cardinality(public.my_permissions(target_org)) > 0 then 'staff'
              else 'member' end
$$;
create or replace function public.is_fi_admin(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select public.has_perm(target_org, 'administrator') $$;
create or replace function public.is_fi_leader(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select public.has_perm(target_org, 'manage_members') $$;
-- Voir la liste des membres : nécessaire pour gérer membres, présences, suivis ou statistiques.
create or replace function public.can_see_members(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select public.has_perm(target_org, 'manage_members') or public.has_perm(target_org, 'manage_attendance')
          or public.has_perm(target_org, 'manage_followups') or public.has_perm(target_org, 'view_stats') $$;
create or replace function public.is_staff(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select cardinality(public.my_permissions(target_org)) > 0 $$;

-- ───────── 3) Comptes membres et événements ciblés ─────────
alter table public.fi_members add column if not exists user_id uuid references auth.users(id) on delete set null;
create unique index if not exists fi_members_org_user_uniq on public.fi_members(organization_id, user_id) where user_id is not null;

alter table public.fi_events add column if not exists audience text not null default 'all';
alter table public.fi_events drop constraint if exists fi_events_audience;
alter table public.fi_events add constraint fi_events_audience check (audience in ('all', 'team', 'selected'));

create table if not exists public.event_participants (
  event_id uuid not null references public.fi_events(id) on delete cascade,
  member_id uuid not null references public.fi_members(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  primary key (event_id, member_id)
);
create index if not exists event_participants_member_idx on public.event_participants(member_id);

create or replace function public.is_event_participant(target_event uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.event_participants ep
                 join public.fi_members m on m.id = ep.member_id
                 join public.user_roles ur on ur.user_id = m.user_id and ur.organization_id = m.organization_id and ur.active
                 where ep.event_id = target_event and m.user_id = (select auth.uid()))
$$;

-- Intégrité inter-organisations (ajoute les participants et le lien compte ↔ membre).
create or replace function public.check_org_refs()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_table_name in ('attendance', 'event_participants') then
    if not exists (select 1 from public.fi_events e where e.id = new.event_id and e.organization_id = new.organization_id)
       or not exists (select 1 from public.fi_members m where m.id = new.member_id and m.organization_id = new.organization_id) then
      raise exception 'Rencontre ou membre hors de cette organisation';
    end if;
  elsif tg_table_name = 'fi_members' then
    if new.tutor_user_id is not null and (tg_op = 'INSERT' or new.tutor_user_id is distinct from old.tutor_user_id)
       and not public.is_org_user(new.organization_id, new.tutor_user_id) then
      raise exception 'Le tuteur doit être un responsable actif de cette organisation';
    end if;
    if (tg_op = 'INSERT' and new.user_id is not null) or (tg_op = 'UPDATE' and new.user_id is distinct from old.user_id) then
      if auth.uid() is not null and not public.has_perm(new.organization_id, 'administrator') then
        raise exception 'Seul un administrateur peut lier un compte à un membre';
      end if;
      if new.user_id is not null and not exists (select 1 from public.user_roles ur
                                                  where ur.user_id = new.user_id and ur.organization_id = new.organization_id) then
        raise exception 'Le compte lié doit appartenir à cette organisation';
      end if;
    end if;
  elsif tg_table_name = 'follow_ups' then
    if new.owner_user_id is not null and (tg_op = 'INSERT' or new.owner_user_id is distinct from old.owner_user_id)
       and not public.is_org_user(new.organization_id, new.owner_user_id) then
      raise exception 'Le tuteur du suivi doit être un responsable actif de cette organisation';
    end if;
  elsif tg_table_name = 'tasks' then
    if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
       and not public.is_org_user(new.organization_id, new.assigned_to) then
      raise exception 'La tâche doit être attribuée à un compte actif de cette organisation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists event_participants_org_refs on public.event_participants;
create trigger event_participants_org_refs before insert or update on public.event_participants
  for each row execute function public.check_org_refs();

-- Sans la permission « gérer les tâches », on ne peut changer que l'avancement de ses propres tâches.
create or replace function public.guard_deputy_task_update()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.has_perm(old.organization_id, 'manage_tasks') then
    if old.assigned_to is distinct from (select auth.uid())
      or new.organization_id is distinct from old.organization_id
      or new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.assigned_to is distinct from old.assigned_to
      or new.due_at is distinct from old.due_at
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'Vous ne pouvez modifier que l''avancement de vos propres tâches';
    end if;
  end if;
  return new;
end $$;

-- ───────── 4) Rôles par défaut, reprise des anciens rôles, premier administrateur ─────────
create or replace function public.create_default_roles(target_org uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  insert into public.org_roles (organization_id, name, color, position, permissions, system_key) values
    (target_org, 'Administrateur', '#d9932b', 40, array['administrator'], 'admin'),
    (target_org, 'Responsable FI', '#0f7a55', 30, array['manage_members','manage_attendance','manage_followups',
      'manage_events','manage_tasks','view_all_events','view_stats','send_reminders'], 'fi_leader'),
    (target_org, 'Responsable adjoint', '#1798a8', 20, array['view_all_events'], 'deputy'),
    (target_org, 'Membre', '#8a918b', 10, '{}', 'member')
  on conflict do nothing;
end $$;
revoke execute on function public.create_default_roles(uuid) from public, anon, authenticated;

create or replace function public.organizations_default_roles()
returns trigger language plpgsql security definer set search_path = public
as $$ begin perform public.create_default_roles(new.id); return new; end $$;
drop trigger if exists organizations_default_roles on public.organizations;
create trigger organizations_default_roles after insert on public.organizations
  for each row execute function public.organizations_default_roles();

do $$
declare o record;
begin
  for o in select id from public.organizations loop perform public.create_default_roles(o.id); end loop;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'user_roles' and column_name = 'role') then
    execute $q$
      insert into public.account_roles (user_id, organization_id, role_id)
      select ur.user_id, ur.organization_id, r.id from public.user_roles ur
      join public.org_roles r on r.organization_id = ur.organization_id and r.system_key = ur.role
      on conflict do nothing $q$;
  end if;
end $$;

drop trigger if exists user_roles_guard_last_admin on public.user_roles;
drop function if exists public.guard_last_admin();
alter table public.user_roles drop column if exists role;

-- Création du premier administrateur (à lancer UNE fois dans le SQL Editor, jamais depuis le site) :
--   select public.bootstrap_first_admin('votre@adresse.fr', 'Nom de votre FI', 'Votre prénom');
create or replace function public.bootstrap_first_admin(admin_email text, org_name text, admin_name text default null)
returns uuid language plpgsql security definer set search_path = public
as $$
declare uid uuid; org uuid;
begin
  select id into uid from auth.users where lower(email) = lower(btrim(admin_email));
  if uid is null then
    raise exception 'Aucun compte pour % : créez-le d''abord dans Authentication → Users', admin_email;
  end if;
  insert into public.organizations (name) values (btrim(org_name)) returning id into org;
  insert into public.user_roles (user_id, organization_id, display_name, email)
    values (uid, org, coalesce(nullif(btrim(admin_name), ''), split_part(admin_email, '@', 1)), lower(btrim(admin_email)));
  insert into public.account_roles (user_id, organization_id, role_id)
    select uid, org, r.id from public.org_roles r where r.organization_id = org and r.system_key = 'admin';
  return org;
end $$;
revoke execute on function public.bootstrap_first_admin(text, text, text) from public, anon, authenticated;

-- ───────── 5) Toujours au moins un administrateur actif ─────────
create or replace function public.org_has_admin(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles ur
                 join public.account_roles ar on ar.user_id = ur.user_id and ar.organization_id = ur.organization_id
                 join public.org_roles r on r.id = ar.role_id
                 where ur.organization_id = target_org and ur.active and 'administrator' = any(r.permissions))
$$;

create or replace function public.guard_org_admin()
returns trigger language plpgsql security definer set search_path = public
as $$
declare org uuid;
begin
  if auth.uid() is null then return null; end if; -- tableau de bord Supabase / fonctions serveur
  org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  if exists (select 1 from public.organizations where id = org) and not public.org_has_admin(org) then
    raise exception 'Il doit toujours rester au moins un administrateur actif dans la FI';
  end if;
  return null;
end $$;
drop trigger if exists user_roles_guard_admin on public.user_roles;
create trigger user_roles_guard_admin after update or delete on public.user_roles
  for each row execute function public.guard_org_admin();
drop trigger if exists account_roles_guard_admin on public.account_roles;
create trigger account_roles_guard_admin after update or delete on public.account_roles
  for each row execute function public.guard_org_admin();
drop trigger if exists org_roles_guard_admin on public.org_roles;
create trigger org_roles_guard_admin after update or delete on public.org_roles
  for each row execute function public.guard_org_admin();

-- ───────── 6) Annuaire (rôles inclus) ─────────
drop function if exists public.list_org_people(uuid);
create function public.list_org_people(target_org uuid)
returns table (user_id uuid, display_name text, email text, active boolean, role_ids uuid[], member_id uuid)
language sql stable security definer set search_path = public
as $$
  select ur.user_id,
         coalesce(nullif(ur.display_name, ''), 'Compte'),
         case when public.is_fi_admin(target_org) then ur.email end,
         ur.active,
         coalesce((select array_agg(ar.role_id) from public.account_roles ar
                   where ar.user_id = ur.user_id and ar.organization_id = target_org), '{}'),
         (select m.id from public.fi_members m where m.organization_id = target_org and m.user_id = ur.user_id limit 1)
  from public.user_roles ur
  where ur.organization_id = target_org
    and (public.can_see_members(target_org) or public.has_perm(target_org, 'manage_tasks'))
    and (ur.active or public.is_fi_admin(target_org))
  order by ur.active desc, ur.display_name
$$;
revoke execute on function public.list_org_people(uuid) from public, anon;
grant execute on function public.list_org_people(uuid) to authenticated;

-- ───────── 7) Règles d'accès (RLS) par permission ─────────
alter table public.org_roles enable row level security;
alter table public.account_roles enable row level security;
alter table public.event_participants enable row level security;

drop policy if exists "members read roles" on public.org_roles;
create policy "members read roles" on public.org_roles for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists "admins create roles" on public.org_roles;
create policy "admins create roles" on public.org_roles for insert to authenticated
  with check (public.is_fi_admin(organization_id) and system_key is null);
drop policy if exists "admins edit roles" on public.org_roles;
create policy "admins edit roles" on public.org_roles for update to authenticated
  using (public.is_fi_admin(organization_id)) with check (public.is_fi_admin(organization_id));
drop policy if exists "admins delete custom roles" on public.org_roles;
create policy "admins delete custom roles" on public.org_roles for delete to authenticated
  using (public.is_fi_admin(organization_id) and system_key is null);

create or replace function public.guard_system_role_key()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.system_key is distinct from old.system_key or new.organization_id is distinct from old.organization_id then
    raise exception 'Ce champ d''un rôle ne peut pas être modifié';
  end if;
  return new;
end $$;
drop trigger if exists org_roles_guard_key on public.org_roles;
create trigger org_roles_guard_key before update on public.org_roles
  for each row execute function public.guard_system_role_key();

drop policy if exists "read own or admin reads account roles" on public.account_roles;
create policy "read own or admin reads account roles" on public.account_roles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_fi_admin(organization_id));
drop policy if exists "admins assign roles" on public.account_roles;
create policy "admins assign roles" on public.account_roles for insert to authenticated
  with check (public.is_fi_admin(organization_id));
drop policy if exists "admins remove roles" on public.account_roles;
create policy "admins remove roles" on public.account_roles for delete to authenticated
  using (public.is_fi_admin(organization_id));

-- Membres
drop policy if exists "leaders manage members" on public.fi_members;
drop policy if exists "read members" on public.fi_members;
create policy "read members" on public.fi_members for select to authenticated
  using (public.can_see_members(organization_id) or (user_id = (select auth.uid()) and public.is_org_member(organization_id)));
drop policy if exists "manage members insert" on public.fi_members;
create policy "manage members insert" on public.fi_members for insert to authenticated
  with check (public.has_perm(organization_id, 'manage_members'));
drop policy if exists "manage members update" on public.fi_members;
create policy "manage members update" on public.fi_members for update to authenticated
  using (public.has_perm(organization_id, 'manage_members')) with check (public.has_perm(organization_id, 'manage_members'));
drop policy if exists "manage members delete" on public.fi_members;
create policy "manage members delete" on public.fi_members for delete to authenticated
  using (public.has_perm(organization_id, 'manage_members'));

-- Événements : l'équipe (« voir tous les événements ») voit tout ; un membre voit les événements
-- ouverts à tous et ceux où il est invité.
drop policy if exists "leaders manage events" on public.fi_events;
drop policy if exists "organization reads events" on public.fi_events;
drop policy if exists "read events" on public.fi_events;
create policy "read events" on public.fi_events for select to authenticated
  using (public.has_perm(organization_id, 'view_all_events') or public.has_perm(organization_id, 'manage_events')
         or (public.is_org_member(organization_id)
             and (audience = 'all' or (audience = 'selected' and public.is_event_participant(id)))));
drop policy if exists "manage events insert" on public.fi_events;
create policy "manage events insert" on public.fi_events for insert to authenticated
  with check (public.has_perm(organization_id, 'manage_events'));
drop policy if exists "manage events update" on public.fi_events;
create policy "manage events update" on public.fi_events for update to authenticated
  using (public.has_perm(organization_id, 'manage_events')) with check (public.has_perm(organization_id, 'manage_events'));
drop policy if exists "manage events delete" on public.fi_events;
create policy "manage events delete" on public.fi_events for delete to authenticated
  using (public.has_perm(organization_id, 'manage_events'));

drop policy if exists "read participants" on public.event_participants;
create policy "read participants" on public.event_participants for select to authenticated
  using (public.has_perm(organization_id, 'view_all_events') or public.has_perm(organization_id, 'manage_events')
         or exists (select 1 from public.fi_members m where m.id = member_id and m.user_id = (select auth.uid())));
drop policy if exists "manage participants" on public.event_participants;
create policy "manage participants" on public.event_participants for all to authenticated
  using (public.has_perm(organization_id, 'manage_events')) with check (public.has_perm(organization_id, 'manage_events'));

-- Présences
drop policy if exists "leaders manage attendance" on public.attendance;
drop policy if exists "read attendance" on public.attendance;
create policy "read attendance" on public.attendance for select to authenticated
  using (public.has_perm(organization_id, 'manage_attendance') or public.has_perm(organization_id, 'view_stats'));
drop policy if exists "manage attendance" on public.attendance;
create policy "manage attendance" on public.attendance for all to authenticated
  using (public.has_perm(organization_id, 'manage_attendance')) with check (public.has_perm(organization_id, 'manage_attendance'));

-- Suivis
drop policy if exists "leaders manage followups" on public.follow_ups;
drop policy if exists "manage followups" on public.follow_ups;
create policy "manage followups" on public.follow_ups for all to authenticated
  using (public.has_perm(organization_id, 'manage_followups')) with check (public.has_perm(organization_id, 'manage_followups'));

-- Tâches
drop policy if exists "leaders manage all tasks; deputies read assigned" on public.tasks;
drop policy if exists "leaders create tasks" on public.tasks;
drop policy if exists "leaders or assigned deputy update tasks" on public.tasks;
drop policy if exists "leaders delete tasks" on public.tasks;
drop policy if exists "read tasks" on public.tasks;
create policy "read tasks" on public.tasks for select to authenticated
  using (public.has_perm(organization_id, 'manage_tasks')
         or (assigned_to = (select auth.uid()) and public.is_org_member(organization_id)));
drop policy if exists "create tasks" on public.tasks;
create policy "create tasks" on public.tasks for insert to authenticated
  with check (public.has_perm(organization_id, 'manage_tasks'));
drop policy if exists "update tasks" on public.tasks;
create policy "update tasks" on public.tasks for update to authenticated
  using (public.has_perm(organization_id, 'manage_tasks') or (assigned_to = (select auth.uid()) and public.is_org_member(organization_id)))
  with check (public.has_perm(organization_id, 'manage_tasks') or (assigned_to = (select auth.uid()) and public.is_org_member(organization_id)));
drop policy if exists "delete tasks" on public.tasks;
create policy "delete tasks" on public.tasks for delete to authenticated
  using (public.has_perm(organization_id, 'manage_tasks'));

-- Photos des membres
drop policy if exists "fi leaders read member photos" on storage.objects;
create policy "fi leaders read member photos" on storage.objects for select to authenticated
  using (bucket_id = 'member-photos' and public.can_see_members(public.try_uuid((storage.foldername(name))[1])));
drop policy if exists "fi leaders add member photos" on storage.objects;
create policy "fi leaders add member photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'member-photos' and public.has_perm(public.try_uuid((storage.foldername(name))[1]), 'manage_members'));
drop policy if exists "fi leaders replace member photos" on storage.objects;
create policy "fi leaders replace member photos" on storage.objects for update to authenticated
  using (bucket_id = 'member-photos' and public.has_perm(public.try_uuid((storage.foldername(name))[1]), 'manage_members'))
  with check (bucket_id = 'member-photos' and public.has_perm(public.try_uuid((storage.foldername(name))[1]), 'manage_members'));
drop policy if exists "fi leaders delete member photos" on storage.objects;
create policy "fi leaders delete member photos" on storage.objects for delete to authenticated
  using (bucket_id = 'member-photos' and public.has_perm(public.try_uuid((storage.foldername(name))[1]), 'manage_members'));

grant select, insert, update, delete on public.org_roles, public.account_roles, public.event_participants to authenticated;
revoke all on public.org_roles, public.account_roles, public.event_participants from anon;

-- ════════════════ 005_abonnement_agenda.sql ════════════════
-- FI Espace V1 — 005 : abonnement d'agenda personnel (iPhone, Android, Google Agenda, Outlook).
-- Chaque compte peut obtenir un lien secret ; l'agenda du téléphone l'interroge régulièrement et affiche
-- automatiquement les événements que ce compte a le droit de voir. À appliquer APRÈS 004. Ré-exécutable.

create table if not exists public.calendar_tokens (
  user_id uuid not null,
  organization_id uuid not null,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  primary key (user_id, organization_id),
  foreign key (user_id, organization_id) references public.user_roles(user_id, organization_id) on delete cascade
);
alter table public.calendar_tokens enable row level security;

drop policy if exists "own calendar token" on public.calendar_tokens;
create policy "own calendar token" on public.calendar_tokens for select to authenticated
  using (user_id = (select auth.uid()) and public.is_org_member(organization_id));
drop policy if exists "delete own calendar token" on public.calendar_tokens;
create policy "delete own calendar token" on public.calendar_tokens for delete to authenticated
  using (user_id = (select auth.uid()));

-- Renvoie le lien secret du compte connecté (le crée au besoin) ; renew = true en génère un nouveau
-- (l'ancien lien cesse alors de fonctionner).
create or replace function public.my_calendar_token(target_org uuid, renew boolean default false)
returns uuid language plpgsql volatile security definer set search_path = public
as $$
declare t uuid;
begin
  if not public.is_org_member(target_org) then raise exception 'Accès refusé'; end if;
  if renew then
    delete from public.calendar_tokens where user_id = (select auth.uid()) and organization_id = target_org;
  end if;
  insert into public.calendar_tokens (user_id, organization_id) values ((select auth.uid()), target_org)
    on conflict (user_id, organization_id) do nothing;
  select token into t from public.calendar_tokens where user_id = (select auth.uid()) and organization_id = target_org;
  return t;
end $$;
revoke execute on function public.my_calendar_token(uuid, boolean) from public, anon;
grant execute on function public.my_calendar_token(uuid, boolean) to authenticated;

-- Événements visibles pour le titulaire d'un lien (utilisée uniquement par la fonction serveur calendar-feed).
create or replace function public.calendar_feed_events(feed_token uuid)
returns table (id uuid, title text, starts_at timestamptz, ends_at timestamptz, location text, notes text, org_name text)
language sql stable security definer set search_path = public
as $$
  with holder as (
    select ct.user_id, ct.organization_id from public.calendar_tokens ct
    join public.user_roles ur on ur.user_id = ct.user_id and ur.organization_id = ct.organization_id and ur.active
    where ct.token = feed_token
  ), perms as (
    select coalesce(array_agg(distinct p), '{}') as list from holder h
    join public.account_roles ar on ar.user_id = h.user_id and ar.organization_id = h.organization_id
    join public.org_roles r on r.id = ar.role_id
    cross join lateral unnest(r.permissions) p
  )
  select e.id, e.title, e.starts_at, e.ends_at, e.location, e.notes, o.name
  from holder h
  join public.fi_events e on e.organization_id = h.organization_id
  join public.organizations o on o.id = h.organization_id
  cross join perms
  where e.starts_at >= now() - interval '30 days' and e.starts_at <= now() + interval '365 days'
    and ( perms.list && array['administrator','view_all_events','manage_events']
          or e.audience = 'all'
          or (e.audience = 'selected' and exists (
                select 1 from public.event_participants ep join public.fi_members m on m.id = ep.member_id
                where ep.event_id = e.id and m.user_id = h.user_id)) )
  order by e.starts_at
$$;
revoke execute on function public.calendar_feed_events(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.calendar_feed_events(uuid) to service_role;
  end if;
end $$;

grant select, delete on public.calendar_tokens to authenticated;
revoke all on public.calendar_tokens from anon;

commit;
