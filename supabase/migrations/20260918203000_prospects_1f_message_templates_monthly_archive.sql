begin;

create table if not exists public.prospect_message_templates (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp', 'email')),
  template_key text not null check (template_key in ('first_contact', 'follow_up', 'trial_reminder')),
  language text not null check (language in ('en', 'ar')),
  label text not null check (char_length(label) between 1 and 120),
  subject_template text null check (subject_template is null or char_length(subject_template) <= 300),
  body_template text not null check (char_length(body_template) between 1 and 4000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null,
  unique (channel, template_key, language),
  check (channel = 'email' or subject_template is null)
);

drop trigger if exists trg_prospect_message_templates_updated_at on public.prospect_message_templates;
create trigger trg_prospect_message_templates_updated_at
before update on public.prospect_message_templates
for each row execute function public.set_updated_at();

alter table public.prospect_message_templates enable row level security;
revoke all on table public.prospect_message_templates from anon, authenticated;
grant select, insert, update, delete on table public.prospect_message_templates to service_role;

insert into public.prospect_message_templates
  (channel, template_key, language, label, subject_template, body_template)
values
  ('whatsapp', 'first_contact', 'en', 'First Contact', null,
   'Hello {{first_name}}, this is ATOM Jiu-Jitsu Cairo. Thank you for contacting us about {{requested_class}}. How can we help you choose the right class and arrange your free trial?'),
  ('whatsapp', 'first_contact', 'ar', 'التواصل الأول', null,
   'أهلاً {{first_name}}، معاك فريق ATOM Jiu-Jitsu Cairo. شكراً لتواصلك معانا بخصوص {{requested_class}}. نقدر نساعدك تختار الحصة المناسبة ونرتب لك التجربة المجانية.'),
  ('whatsapp', 'follow_up', 'en', 'Follow-Up', null,
   'Hello {{first_name}}, we are following up on your enquiry about {{requested_class}}. Would you like us to help you book your free trial at ATOM Jiu-Jitsu Cairo?'),
  ('whatsapp', 'follow_up', 'ar', 'متابعة', null,
   'أهلاً {{first_name}}، بنتابع معاك بخصوص استفسارك عن {{requested_class}}. تحب نساعدك تحجز التجربة المجانية في ATOM Jiu-Jitsu Cairo؟'),
  ('whatsapp', 'trial_reminder', 'en', 'Trial Reminder', null,
   'Hello {{first_name}}, this is a reminder for your free trial at ATOM Jiu-Jitsu Cairo on {{trial_date}}. Please arrive 10 minutes early. Reply to confirm your attendance.'),
  ('whatsapp', 'trial_reminder', 'ar', 'تذكير بالتجربة', null,
   'أهلاً {{first_name}}، ده تذكير بموعد التجربة المجانية في ATOM Jiu-Jitsu Cairo يوم {{trial_date}}. ياريت تيجي قبل الموعد بـ10 دقايق وتأكد لنا حضورك.'),
  ('email', 'first_contact', 'en', 'First Contact', 'Your enquiry — ATOM Jiu-Jitsu Cairo',
   'Hello {{first_name}},\n\nThank you for contacting ATOM Jiu-Jitsu Cairo about {{requested_class}}. We would be happy to help you choose the right class and arrange your free trial.\n\nBest regards,\nATOM Jiu-Jitsu Cairo'),
  ('email', 'first_contact', 'ar', 'التواصل الأول', 'استفسارك — ATOM Jiu-Jitsu Cairo',
   'أهلاً {{first_name}}،\n\nشكراً لتواصلك مع ATOM Jiu-Jitsu Cairo بخصوص {{requested_class}}. يسعدنا نساعدك تختار الحصة المناسبة ونرتب لك التجربة المجانية.\n\nتحياتنا،\nATOM Jiu-Jitsu Cairo'),
  ('email', 'follow_up', 'en', 'Follow-Up', 'Following up — ATOM Jiu-Jitsu Cairo',
   'Hello {{first_name}},\n\nWe are following up on your enquiry about {{requested_class}}. Would you like us to help you book your free trial at ATOM Jiu-Jitsu Cairo?\n\nBest regards,\nATOM Jiu-Jitsu Cairo'),
  ('email', 'follow_up', 'ar', 'متابعة', 'متابعة استفسارك — ATOM Jiu-Jitsu Cairo',
   'أهلاً {{first_name}}،\n\nبنتابع معاك بخصوص استفسارك عن {{requested_class}}. تحب نساعدك تحجز التجربة المجانية في ATOM Jiu-Jitsu Cairo؟\n\nتحياتنا،\nATOM Jiu-Jitsu Cairo'),
  ('email', 'trial_reminder', 'en', 'Trial Reminder', 'Free trial reminder — ATOM Jiu-Jitsu Cairo',
   'Hello {{first_name}},\n\nThis is a reminder for your free trial at ATOM Jiu-Jitsu Cairo on {{trial_date}}. Please arrive 10 minutes early and reply to confirm your attendance.\n\nBest regards,\nATOM Jiu-Jitsu Cairo'),
  ('email', 'trial_reminder', 'ar', 'تذكير بالتجربة', 'تذكير بالتجربة المجانية — ATOM Jiu-Jitsu Cairo',
   'أهلاً {{first_name}}،\n\nده تذكير بموعد التجربة المجانية في ATOM Jiu-Jitsu Cairo يوم {{trial_date}}. ياريت تيجي قبل الموعد بـ10 دقايق وتأكد لنا حضورك.\n\nتحياتنا،\nATOM Jiu-Jitsu Cairo')
on conflict (channel, template_key, language) do nothing;

create index if not exists prospect_submissions_received_at_idx
  on public.prospect_submissions (received_at desc);

create or replace function public.prospect_submission_monthly_summary()
returns table (
  month_start date,
  submissions_count bigint,
  unique_prospects_count bigint,
  contact_us_count bigint,
  visitor_information_count bigint,
  unknown_count bigint,
  gmail_backfill_count bigint,
  website_api_count bigint,
  manual_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    date_trunc('month', received_at at time zone 'Africa/Cairo')::date as month_start,
    count(*)::bigint as submissions_count,
    count(distinct prospect_id)::bigint as unique_prospects_count,
    count(*) filter (where source = 'contact_us')::bigint as contact_us_count,
    count(*) filter (where source = 'visitor_information')::bigint as visitor_information_count,
    count(*) filter (where source = 'unknown')::bigint as unknown_count,
    count(*) filter (where ingest_channel = 'gmail_backfill')::bigint as gmail_backfill_count,
    count(*) filter (where ingest_channel = 'website_api')::bigint as website_api_count,
    count(*) filter (where ingest_channel = 'manual')::bigint as manual_count
  from public.prospect_submissions
  group by 1
  order by 1 desc;
$$;

revoke all on function public.prospect_submission_monthly_summary() from public, anon, authenticated;
grant execute on function public.prospect_submission_monthly_summary() to service_role;

commit;
