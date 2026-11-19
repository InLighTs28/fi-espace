-- FI Espace — vérification des droits par rôle (RLS + triggers).
-- Utilisation : Supabase → SQL Editor, coller ce fichier et exécuter.
-- Tout se passe dans une transaction annulée à la fin (ROLLBACK) : rien n'est conservé.
-- Le script s'arrête sur la première erreur « ÉCHEC : … ». Sinon la dernière ligne affiche « TOUS LES TESTS RLS SONT PASSÉS ».
-- Les comptes et données ci-dessous sont fictifs.

begin;

-- ───────── Données fictives (exécutées en tant que propriétaire de la base) ─────────
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'admin.a@exemple.test'),
  ('a0000000-0000-4000-8000-000000000002', 'responsable.a@exemple.test'),
  ('a0000000-0000-4000-8000-000000000003', 'adjoint.a@exemple.test'),
  ('a0000000-0000-4000-8000-000000000004', 'adjoint2.a@exemple.test'),
  ('a0000000-0000-4000-8000-000000000005', 'admin.b@exemple.test'),
  ('a0000000-0000-4000-8000-000000000006', 'externe@exemple.test'),
  ('a0000000-0000-4000-8000-000000000007', 'revoque.a@exemple.test');

insert into public.organizations (id, name) values
  ('aa000000-0000-4000-8000-0000000000aa', 'FI test A (fictive)'),
  ('bb000000-0000-4000-8000-0000000000bb', 'FI test B (fictive)');

insert into public.user_roles (user_id, organization_id, role, display_name, email, active) values
  ('a0000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'admin',     'Admin A',     'admin.a@exemple.test', true),
  ('a0000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', 'fi_leader', 'Responsable A','responsable.a@exemple.test', true),
  ('a0000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-0000000000aa', 'deputy',    'Adjoint A',   'adjoint.a@exemple.test', true),
  ('a0000000-0000-4000-8000-000000000004', 'aa000000-0000-4000-8000-0000000000aa', 'deputy',    'Adjoint 2 A', 'adjoint2.a@exemple.test', true),
  ('a0000000-0000-4000-8000-000000000007', 'aa000000-0000-4000-8000-0000000000aa', 'deputy',    'Révoqué A',   'revoque.a@exemple.test', false),
  ('a0000000-0000-4000-8000-000000000005', 'bb000000-0000-4000-8000-0000000000bb', 'admin',     'Admin B',     'admin.b@exemple.test', true);

insert into public.fi_members (id, organization_id, display_name) values
  ('c1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Membre A1'),
  ('c2000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-0000000000bb', 'Membre B1');

insert into public.fi_events (id, organization_id, title, starts_at) values
  ('e1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Rencontre A', now() + interval '2 days'),
  ('e2000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-0000000000bb', 'Rencontre B', now() + interval '2 days');

insert into public.follow_ups (id, organization_id, contact_label, next_action) values
  ('f1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Contact A.', 'Prendre des nouvelles');

insert into public.tasks (id, organization_id, title, assigned_to) values
  ('d1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Tâche adjoint', 'a0000000-0000-4000-8000-000000000003'),
  ('d2000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Tâche adjoint 2', 'a0000000-0000-4000-8000-000000000004'),
  ('d3000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Tâche responsable', 'a0000000-0000-4000-8000-000000000002');

-- ───────── Responsable adjoint (organisation A) ─────────
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int;
begin
  if (select count(*) from public.fi_members) <> 0 then raise exception 'ÉCHEC : un adjoint lit les membres'; end if;
  if (select count(*) from public.follow_ups) <> 0 then raise exception 'ÉCHEC : un adjoint lit les suivis'; end if;
  if (select count(*) from public.attendance) <> 0 then raise exception 'ÉCHEC : un adjoint lit les présences'; end if;
  if (select count(*) from public.user_roles) <> 1 then raise exception 'ÉCHEC : un adjoint lit les rôles des autres'; end if;
  if (select count(*) from public.organizations) <> 1 then raise exception 'ÉCHEC : un adjoint voit une autre organisation'; end if;
  if (select count(*) from public.fi_events) <> 1 then raise exception 'ÉCHEC : un adjoint doit lire les seuls événements de sa FI'; end if;
  if (select count(*) from public.tasks) <> 1 then raise exception 'ÉCHEC : un adjoint doit lire uniquement ses tâches'; end if;
  if (select count(*) from public.list_org_people('aa000000-0000-4000-8000-0000000000aa')) <> 0 then
    raise exception 'ÉCHEC : un adjoint lit l''annuaire des responsables'; end if;

  update public.tasks set status = 'done' where id = 'd1000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ÉCHEC : un adjoint ne peut pas avancer sa tâche'; end if;

  update public.tasks set status = 'done' where id = 'd2000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : un adjoint modifie la tâche d''un autre'; end if;

  update public.user_roles set role = 'admin' where user_id = 'a0000000-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : un adjoint s''attribue un rôle'; end if;

  begin
    update public.tasks set title = 'Renommée' where id = 'd1000000-0000-4000-8000-000000000001';
    raise exception 'ÉCHEC : un adjoint renomme sa tâche';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    update public.tasks set assigned_to = 'a0000000-0000-4000-8000-000000000004' where id = 'd1000000-0000-4000-8000-000000000001';
    raise exception 'ÉCHEC : un adjoint réattribue sa tâche';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.tasks (organization_id, title) values ('aa000000-0000-4000-8000-0000000000aa', 'Nouvelle');
    raise exception 'ÉCHEC : un adjoint crée une tâche';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.fi_events (organization_id, title, starts_at) values ('aa000000-0000-4000-8000-0000000000aa', 'X', now());
    raise exception 'ÉCHEC : un adjoint crée un événement';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.fi_members (organization_id, display_name) values ('aa000000-0000-4000-8000-0000000000aa', 'X');
    raise exception 'ÉCHEC : un adjoint crée un membre';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
end $$;
reset role;

do $$ begin
  if (select completed_at from public.tasks where id = 'd1000000-0000-4000-8000-000000000001') is null then
    raise exception 'ÉCHEC : completed_at non renseigné'; end if;
  if (select status from public.tasks where id = 'd2000000-0000-4000-8000-000000000001') <> 'todo' then
    raise exception 'ÉCHEC : la tâche de l''adjoint 2 a changé'; end if;
end $$;

-- ───────── Responsable FI (organisation A) ─────────
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int; who uuid;
begin
  if (select count(*) from public.fi_members) <> 1 then raise exception 'ÉCHEC : le responsable doit lire les membres de sa seule FI'; end if;
  if (select count(*) from public.follow_ups) <> 1 then raise exception 'ÉCHEC : le responsable doit lire les suivis'; end if;
  if (select count(*) from public.tasks) <> 3 then raise exception 'ÉCHEC : le responsable doit lire toutes les tâches de sa FI'; end if;
  if (select count(*) from public.fi_events) <> 1 then raise exception 'ÉCHEC : le responsable voit les événements d''une autre FI'; end if;
  if (select count(*) from public.list_org_people('aa000000-0000-4000-8000-0000000000aa')) <> 4 then
    raise exception 'ÉCHEC : annuaire attendu = 4 comptes actifs'; end if;
  if exists (select 1 from public.list_org_people('aa000000-0000-4000-8000-0000000000aa') where email is not null) then
    raise exception 'ÉCHEC : un responsable non admin voit les e-mails'; end if;
  if (select count(*) from public.list_org_people('bb000000-0000-4000-8000-0000000000bb')) <> 0 then
    raise exception 'ÉCHEC : annuaire d''une autre organisation lisible'; end if;

  insert into public.fi_members (organization_id, display_name, referent_user_id)
    values ('aa000000-0000-4000-8000-0000000000aa', 'Nouveau membre', 'a0000000-0000-4000-8000-000000000003');

  insert into public.tasks (organization_id, title, assigned_to, created_by)
    values ('aa000000-0000-4000-8000-0000000000aa', 'Tâche créée', 'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001')
    returning created_by into who;
  if who <> 'a0000000-0000-4000-8000-000000000002' then raise exception 'ÉCHEC : created_by falsifiable'; end if;

  insert into public.attendance (organization_id, event_id, member_id, state)
    values ('aa000000-0000-4000-8000-0000000000aa', 'e1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'present')
    returning recorded_by into who;
  if who <> 'a0000000-0000-4000-8000-000000000002' then raise exception 'ÉCHEC : recorded_by non renseigné'; end if;

  update public.user_roles set role = 'admin' where user_id = 'a0000000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : un responsable modifie les rôles'; end if;

  begin
    insert into public.user_roles (user_id, organization_id, role)
      values ('a0000000-0000-4000-8000-000000000006', 'aa000000-0000-4000-8000-0000000000aa', 'deputy');
    raise exception 'ÉCHEC : un responsable ajoute un compte';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.fi_members (organization_id, display_name) values ('bb000000-0000-4000-8000-0000000000bb', 'Intrus');
    raise exception 'ÉCHEC : un responsable écrit dans une autre FI';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.tasks (organization_id, title, assigned_to)
      values ('aa000000-0000-4000-8000-0000000000aa', 'X', 'a0000000-0000-4000-8000-000000000005');
    raise exception 'ÉCHEC : tâche attribuée à un compte d''une autre FI';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.tasks (organization_id, title, assigned_to)
      values ('aa000000-0000-4000-8000-0000000000aa', 'X', 'a0000000-0000-4000-8000-000000000007');
    raise exception 'ÉCHEC : tâche attribuée à un compte révoqué';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.attendance (organization_id, event_id, member_id, state)
      values ('aa000000-0000-4000-8000-0000000000aa', 'e2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'present');
    raise exception 'ÉCHEC : présence liée à un événement d''une autre FI';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    update public.follow_ups set next_action = repeat('x', 400) where id = 'f1000000-0000-4000-8000-000000000001';
    raise exception 'ÉCHEC : texte de suivi trop long accepté';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
end $$;
reset role;

-- ───────── Administrateur (organisation A) ─────────
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int;
begin
  if (select count(*) from public.user_roles) <> 5 then raise exception 'ÉCHEC : l''admin doit voir les 5 comptes de sa FI'; end if;
  if (select count(*) from public.list_org_people('aa000000-0000-4000-8000-0000000000aa') where email is not null) <> 5 then
    raise exception 'ÉCHEC : l''admin doit voir les e-mails et comptes inactifs'; end if;

  update public.user_roles set role = 'fi_leader'
    where user_id = 'a0000000-0000-4000-8000-000000000003' and organization_id = 'aa000000-0000-4000-8000-0000000000aa';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ÉCHEC : l''admin ne peut pas changer un rôle'; end if;

  begin
    update public.user_roles set active = false
      where user_id = 'a0000000-0000-4000-8000-000000000001' and organization_id = 'aa000000-0000-4000-8000-0000000000aa';
    raise exception 'ÉCHEC : le dernier admin peut se désactiver';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.user_roles (user_id, organization_id, role)
      values ('a0000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-0000000000bb', 'admin');
    raise exception 'ÉCHEC : un admin s''ajoute à une autre organisation';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;

  update public.fi_members set display_name = 'Pirate' where organization_id = 'bb000000-0000-4000-8000-0000000000bb';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : un admin modifie une autre organisation'; end if;
end $$;
reset role;

-- ───────── Compte révoqué, compte sans rôle, admin d'une autre FI ─────────
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000007","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.fi_events) + (select count(*) from public.tasks) + (select count(*) from public.organizations) <> 0 then
    raise exception 'ÉCHEC : un compte révoqué lit encore des données'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.fi_events) + (select count(*) from public.tasks) + (select count(*) from public.fi_members)
     + (select count(*) from public.organizations) + (select count(*) from public.user_roles) <> 0 then
    raise exception 'ÉCHEC : un compte sans rôle lit des données'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.fi_members) <> 1 or (select count(*) from public.fi_events) <> 1 then
    raise exception 'ÉCHEC : l''admin B doit voir uniquement la FI B'; end if;
  if exists (select 1 from public.fi_members where organization_id = 'aa000000-0000-4000-8000-0000000000aa') then
    raise exception 'ÉCHEC : l''admin B voit les membres de la FI A'; end if;
end $$;
reset role;

-- ───────── Visiteur non connecté ─────────
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$ begin
  begin
    perform 1 from public.fi_members;
    raise exception 'ÉCHEC : un visiteur anonyme interroge les membres';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    perform 1 from public.tasks;
    raise exception 'ÉCHEC : un visiteur anonyme interroge les tâches';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
end $$;
reset role;

select 'TOUS LES TESTS RLS SONT PASSÉS' as resultat;
rollback;
