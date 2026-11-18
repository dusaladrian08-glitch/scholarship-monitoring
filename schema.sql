-- Run in Supabase SQL Editor
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text, role text not null default 'scholar' check (role in ('admin','staff','scholar'))
);
create table scholarship_programs (
  id bigint generated always as identity primary key,
  program_name text not null unique,
  required_gwa numeric(3,2) not null check (required_gwa between 1 and 5),
  min_units int not null check (min_units >= 0),
  allow_failing_grade boolean not null default false,
  active boolean not null default true
);
create table scholars (
  id bigint generated always as identity primary key,
  student_id text not null unique check (length(trim(student_id)) > 0),
  full_name text not null, degree_program text, year_level int,
  scholarship_id bigint not null references scholarship_programs(id),
  status text not null default 'Active'
);
create table grade_submissions (
  id bigint generated always as identity primary key,
  scholar_id bigint not null references scholars(id),
  academic_year text not null, semester text not null,
  gwa numeric(3,2) not null check (gwa between 1 and 5),
  units_enrolled int not null check (units_enrolled >= 0),
  failed_subjects int not null default 0 check (failed_subjects >= 0),
  incomplete_subjects int not null default 0 check (incomplete_subjects >= 0),
  submission_status text not null default 'Pending' check (submission_status in ('Pending','Verified','Returned')),
  evaluation text, remarks text,
  submitted_at timestamptz default now(),
  verified_by uuid references auth.users(id), verified_at timestamptz,
  unique (scholar_id, academic_year, semester)   -- BR-03
);

create or replace function is_staff() returns boolean language sql security definer set search_path = public as
$$ select exists(select 1 from public.profiles where id = auth.uid() and role in ('admin','staff')) $$;

alter table profiles enable row level security;
alter table scholarship_programs enable row level security;
alter table scholars enable row level security;
alter table grade_submissions enable row level security;
create policy p_self on profiles for select using (id = auth.uid() or is_staff());
create policy p_prog on scholarship_programs for all using (is_staff()) with check (is_staff());
create policy p_sch on scholars for all using (is_staff()) with check (is_staff());
create policy p_sub on grade_submissions for all using (is_staff()) with check (is_staff());

-- Auto-create a profile on sign-up (default role: scholar)
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as
$$ begin insert into public.profiles(id, full_name) values (new.id, new.raw_user_meta_data->>'full_name'); return new; end $$;
create trigger on_signup after insert on auth.users for each row execute function handle_new_user();

-- Sample rules (Philippine scale: 1.00 = highest, so lower GWA is better)
insert into scholarship_programs(program_name, required_gwa, min_units, allow_failing_grade) values
 ('University Academic Scholar', 1.75, 15, false),
 ('CHED Merit Scholarship', 2.00, 18, false),
 ('Private Grant', 2.50, 12, true);

-- After creating your first user in Authentication > Users, promote them:
-- update profiles set role = 'admin' where id = '<USER-UUID>';
