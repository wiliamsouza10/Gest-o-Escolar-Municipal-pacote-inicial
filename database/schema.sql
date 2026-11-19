-- GESTÃO ESCOLAR MUNICIPAL — esquema inicial para Supabase/PostgreSQL
-- Execute no SQL Editor de um projeto Supabase novo.
-- ATENÇÃO: revise bases legais, retenção, perfis e políticas com a equipe técnica/jurídica antes de usar dados reais.

create extension if not exists pgcrypto;

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  inep_code text,
  address text,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('secretaria','gestor','secretario_escolar','professor')),
  school_id uuid references public.schools(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  full_name text not null,
  birth_date date,
  guardian_name text,
  guardian_phone text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  name text not null,
  grade_level text not null,
  shift text not null check (shift in ('Matutino','Vespertino','Noturno','Integral')),
  school_year integer not null,
  teacher_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  class_id uuid not null references public.classes(id),
  school_year integer not null,
  status text not null default 'ativa' check (status in ('ativa','aguardando','transferida','cancelada')),
  created_at timestamptz not null default now(),
  unique(student_id,class_id,school_year)
);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id),
  teacher_id uuid not null references public.profiles(id),
  lesson_date date not null,
  subject text not null,
  content text not null,
  activity text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id),
  student_id uuid not null references public.students(id),
  attendance_date date not null,
  status text not null check (status in ('presente','falta','justificada')),
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(class_id,student_id,attendance_date)
);

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id),
  teacher_id uuid not null references public.profiles(id),
  student_id uuid not null references public.students(id),
  assessment_date date not null,
  title text not null,
  score numeric(5,2) check (score >= 0),
  notes text,
  created_at timestamptz not null default now()
);

-- Funções auxiliares usadas nas políticas RLS.
create or replace function public.current_role()
returns text language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() and active=true $$;

create or replace function public.current_school_id()
returns uuid language sql stable security definer set search_path=public
as $$ select school_id from public.profiles where id=auth.uid() and active=true $$;

create or replace function public.is_secretaria()
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce(public.current_role()='secretaria',false) $$;

create or replace function public.can_access_school(target_school uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select public.is_secretaria() or (public.current_school_id() is not null and public.current_school_id()=target_school) $$;

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.classes enable row level security;
alter table public.enrollments enable row level security;
alter table public.lessons enable row level security;
alter table public.attendance enable row level security;
alter table public.assessments enable row level security;
-- Escolas: Secretaria gerencia todas; usuários escolares visualizam sua unidade.
DROP POLICY IF EXISTS "schools_select_scope" ON public.schools;
CREATE POLICY "schools_select_scope" ON public.schools for select to authenticated using (public.can_access_school(id));
DROP POLICY IF EXISTS "schools_insert_secretaria" ON public.schools;
CREATE POLICY "schools_insert_secretaria" ON public.schools for insert to authenticated with check (public.is_secretaria());
DROP POLICY IF EXISTS "schools_update_secretaria" ON public.schools;
CREATE POLICY "schools_update_secretaria" ON public.schools for update to authenticated using (public.is_secretaria()) with check (public.is_secretaria());

-- Perfis: usuário lê seu perfil; Secretaria administra perfis; gestor consulta perfis da unidade.
DROP POLICY IF EXISTS "profiles_select_scope" ON public.profiles;
CREATE POLICY "profiles_select_scope" ON public.profiles for select to authenticated
using (id=auth.uid() or public.is_secretaria() or (school_id is not null and school_id=public.current_school_id()));
DROP POLICY IF EXISTS "profiles_insert_secretaria" ON public.profiles;
CREATE POLICY "profiles_insert_secretaria" ON public.profiles for insert to authenticated with check (public.is_secretaria());
DROP POLICY IF EXISTS "profiles_update_secretaria" ON public.profiles;
CREATE POLICY "profiles_update_secretaria" ON public.profiles for update to authenticated using (public.is_secretaria()) with check (public.is_secretaria());

-- Alunos: Secretaria vê toda a rede; escola vê somente sua unidade.
DROP POLICY IF EXISTS "students_select_scope" ON public.students;
CREATE POLICY "students_select_scope" ON public.students for select to authenticated using (
  public.can_access_school(school_id) or exists (
    select 1 from public.enrollments e join public.classes c on c.id=e.class_id
    where e.student_id=students.id and c.teacher_id=auth.uid()
  ));
DROP POLICY IF EXISTS "students_insert_scope" ON public.students;
CREATE POLICY "students_insert_scope" ON public.students for insert to authenticated with check (
  public.can_access_school(school_id) and public.current_role() in ('secretaria','gestor','secretario_escolar'));
DROP POLICY IF EXISTS "students_update_scope" ON public.students;
CREATE POLICY "students_update_scope" ON public.students for update to authenticated
using (public.can_access_school(school_id) and public.current_role() in ('secretaria','gestor','secretario_escolar'))
with check (public.can_access_school(school_id));

-- Turmas: professores veem apenas suas turmas; perfis da escola veem as turmas da unidade.
DROP POLICY IF EXISTS "classes_select_scope" ON public.classes;
CREATE POLICY "classes_select_scope" ON public.classes for select to authenticated using (
  public.is_secretaria() or school_id=public.current_school_id() or teacher_id=auth.uid());
DROP POLICY IF EXISTS "classes_insert_scope" ON public.classes;
CREATE POLICY "classes_insert_scope" ON public.classes for insert to authenticated with check (
  public.can_access_school(school_id) and public.current_role() in ('secretaria','gestor','secretario_escolar'));
DROP POLICY IF EXISTS "classes_update_scope" ON public.classes;
CREATE POLICY "classes_update_scope" ON public.classes for update to authenticated
using (public.can_access_school(school_id) and public.current_role() in ('secretaria','gestor'))
with check (public.can_access_school(school_id));

-- Matrículas: escopo é derivado da escola da turma.
DROP POLICY IF EXISTS "enrollments_select_scope" ON public.enrollments;
CREATE POLICY "enrollments_select_scope" ON public.enrollments for select to authenticated using (
  exists(select 1 from public.classes c where c.id=class_id and (public.can_access_school(c.school_id) or c.teacher_id=auth.uid())));
DROP POLICY IF EXISTS "enrollments_insert_scope" ON public.enrollments;
CREATE POLICY "enrollments_insert_scope" ON public.enrollments for insert to authenticated with check (
  public.current_role() in ('secretaria','gestor','secretario_escolar') and
  exists(select 1 from public.classes c where c.id=class_id and public.can_access_school(c.school_id)));
DROP POLICY IF EXISTS "enrollments_update_scope" ON public.enrollments;
CREATE POLICY "enrollments_update_scope" ON public.enrollments for update to authenticated using (
  public.current_role() in ('secretaria','gestor','secretario_escolar') and
  exists(select 1 from public.classes c where c.id=class_id and public.can_access_school(c.school_id)))
with check (exists(select 1 from public.classes c where c.id=class_id and public.can_access_school(c.school_id)));

-- Diário: professor somente nas próprias turmas; Secretaria/gestão acompanha a unidade/rede.
DROP POLICY IF EXISTS "lessons_select_scope" ON public.lessons;
CREATE POLICY "lessons_select_scope" ON public.lessons for select to authenticated using (
  public.is_secretaria() or teacher_id=auth.uid() or exists(select 1 from public.classes c where c.id=class_id and c.school_id=public.current_school_id()));
DROP POLICY IF EXISTS "lessons_insert_scope" ON public.lessons;
CREATE POLICY "lessons_insert_scope" ON public.lessons for insert to authenticated with check (
  teacher_id=auth.uid() and exists(select 1 from public.classes c where c.id=class_id and
    (c.teacher_id=auth.uid() or (public.current_role() in ('secretaria','gestor','secretario_escolar') and public.can_access_school(c.school_id)))));
DROP POLICY IF EXISTS "lessons_update_scope" ON public.lessons;
CREATE POLICY "lessons_update_scope" ON public.lessons for update to authenticated using (
  teacher_id=auth.uid() or public.is_secretaria()) with check (teacher_id=auth.uid() or public.is_secretaria());

-- Frequência: mesmo escopo da turma; professor registra apenas em turma atribuída.
DROP POLICY IF EXISTS "attendance_select_scope" ON public.attendance;
CREATE POLICY "attendance_select_scope" ON public.attendance for select to authenticated using (
  public.is_secretaria() or exists(select 1 from public.classes c where c.id=class_id and
  (c.school_id=public.current_school_id() or c.teacher_id=auth.uid())));
DROP POLICY IF EXISTS "attendance_insert_scope" ON public.attendance;
CREATE POLICY "attendance_insert_scope" ON public.attendance for insert to authenticated with check (
  recorded_by=auth.uid() and exists(select 1 from public.classes c where c.id=class_id and
  (c.teacher_id=auth.uid() or (public.current_role() in ('secretaria','gestor','secretario_escolar') and public.can_access_school(c.school_id)))));
DROP POLICY IF EXISTS "attendance_update_scope" ON public.attendance;
CREATE POLICY "attendance_update_scope" ON public.attendance for update to authenticated using (
  public.is_secretaria() or recorded_by=auth.uid()) with check (recorded_by=auth.uid() or public.is_secretaria());

DROP POLICY IF EXISTS "assessments_select_scope" ON public.assessments;

CREATE POLICY "assessments_select_scope" ON public.assessments for select to authenticated using (
  public.is_secretaria() or teacher_id=auth.uid() or exists(select 1 from public.classes c where c.id=class_id and c.school_id=public.current_school_id()));
DROP POLICY IF EXISTS "assessments_insert_scope" ON public.assessments;
CREATE POLICY "assessments_insert_scope" ON public.assessments for insert to authenticated with check (
  teacher_id=auth.uid() and exists(select 1 from public.classes c where c.id=class_id and
  (c.teacher_id=auth.uid() or public.is_secretaria() or c.school_id=public.current_school_id())));

-- Grants básicos para usuários autenticados (RLS continua controlando cada linha).
grant usage on schema public to authenticated;
grant select,insert,update on public.schools,public.profiles,public.students,public.classes,
  public.enrollments,public.lessons,public.attendance,public.assessments to authenticated;