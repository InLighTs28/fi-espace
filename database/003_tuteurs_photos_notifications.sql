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
