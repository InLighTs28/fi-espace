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
