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
