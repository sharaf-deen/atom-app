-- Inactive UX 1A — Prospect/CRM-style Follow-up Queue

alter table public.member_inactive_followups
  add column if not exists assigned_to uuid null,
  add column if not exists last_contacted_at timestamptz null;

create index if not exists member_inactive_followups_assigned_idx
  on public.member_inactive_followups(assigned_to);
create index if not exists member_inactive_followups_next_idx
  on public.member_inactive_followups(next_follow_up_at);

create table if not exists public.member_inactive_activities (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null,
  activity_type text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  actor_user_id uuid null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists member_inactive_activities_member_idx
  on public.member_inactive_activities(member_id, occurred_at desc);

alter table public.member_inactive_activities enable row level security;

create table if not exists public.inactive_message_templates (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp','email')),
  template_key text not null check (template_key in ('general_follow_up','renewal','no_membership','cancelled','win_back')),
  language text not null check (language in ('en','ar')),
  label text not null,
  subject_template text null,
  body_template text not null,
  is_active boolean not null default true,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel,template_key,language)
);

alter table public.inactive_message_templates enable row level security;

insert into public.inactive_message_templates
(channel,template_key,language,label,subject_template,body_template)
values
('whatsapp','general_follow_up','en','General follow-up',null,'Hi {{first_name}}, this is ATOM Jiu-Jitsu. We are following up about your training. It has been {{inactive_days}} day(s) since your membership became inactive. Let us know if we can help you return to training.'),
('whatsapp','general_follow_up','ar','متابعة عامة',null,'أهلاً {{first_name}}، معاك ATOM Jiu-Jitsu. بنتابع معاك بخصوص التمرين. بقالك {{inactive_days}} يوم من وقت ما الاشتراك بقى غير نشط. لو حابب ترجع للتمرين كلّمنا ونساعدك.'),
('email','general_follow_up','en','General follow-up','ATOM Jiu-Jitsu — Follow-up','Hi {{first_name}},\n\nWe are following up about your training. It has been {{inactive_days}} day(s) since your membership became inactive. Let us know if we can help you return to training.\n\nATOM Jiu-Jitsu'),
('email','general_follow_up','ar','متابعة عامة','ATOM Jiu-Jitsu — متابعة','أهلاً {{first_name}}،\n\nبنتابع معاك بخصوص التمرين. بقالك {{inactive_days}} يوم من وقت ما الاشتراك بقى غير نشط. لو حابب ترجع للتمرين كلّمنا ونساعدك.\n\nATOM Jiu-Jitsu'),

('whatsapp','renewal','en','Renewal',null,'Hi {{first_name}}, this is ATOM Jiu-Jitsu. Your {{plan}} ended on {{expiry_date}}. Would you like us to help you renew and return to training?'),
('whatsapp','renewal','ar','تجديد الاشتراك',null,'أهلاً {{first_name}}، معاك ATOM Jiu-Jitsu. اشتراك {{plan}} انتهى يوم {{expiry_date}}. تحب نساعدك في التجديد والرجوع للتمرين؟'),
('email','renewal','en','Renewal','ATOM Jiu-Jitsu — Membership renewal','Hi {{first_name}},\n\nYour {{plan}} ended on {{expiry_date}}. Would you like us to help you renew and return to training?\n\nATOM Jiu-Jitsu'),
('email','renewal','ar','تجديد الاشتراك','ATOM Jiu-Jitsu — تجديد الاشتراك','أهلاً {{first_name}}،\n\nاشتراك {{plan}} انتهى يوم {{expiry_date}}. تحب نساعدك في التجديد والرجوع للتمرين؟\n\nATOM Jiu-Jitsu'),

('whatsapp','no_membership','en','No membership yet',null,'Hi {{first_name}}, this is ATOM Jiu-Jitsu. Your account is ready but you do not have an active membership yet. Would you like us to help you choose the right membership?'),
('whatsapp','no_membership','ar','لا يوجد اشتراك بعد',null,'أهلاً {{first_name}}، معاك ATOM Jiu-Jitsu. حسابك جاهز لكن مفيش اشتراك نشط لسه. تحب نساعدك تختار الاشتراك المناسب؟'),
('email','no_membership','en','No membership yet','ATOM Jiu-Jitsu — Membership','Hi {{first_name}},\n\nYour account is ready but you do not have an active membership yet. Would you like us to help you choose the right membership?\n\nATOM Jiu-Jitsu'),
('email','no_membership','ar','لا يوجد اشتراك بعد','ATOM Jiu-Jitsu — الاشتراك','أهلاً {{first_name}}،\n\nحسابك جاهز لكن مفيش اشتراك نشط لسه. تحب نساعدك تختار الاشتراك المناسب؟\n\nATOM Jiu-Jitsu'),

('whatsapp','cancelled','en','Cancelled membership',null,'Hi {{first_name}}, this is ATOM Jiu-Jitsu. We are following up after your previous membership was cancelled. If you would like to return, reception can help you with a new membership.'),
('whatsapp','cancelled','ar','اشتراك ملغي',null,'أهلاً {{first_name}}، معاك ATOM Jiu-Jitsu. بنتابع معاك بعد إلغاء اشتراكك السابق. لو حابب ترجع، الريسبشن يقدر يساعدك تعمل اشتراك جديد.'),
('email','cancelled','en','Cancelled membership','ATOM Jiu-Jitsu — Follow-up','Hi {{first_name}},\n\nWe are following up after your previous membership was cancelled. If you would like to return, reception can help you with a new membership.\n\nATOM Jiu-Jitsu'),
('email','cancelled','ar','اشتراك ملغي','ATOM Jiu-Jitsu — متابعة','أهلاً {{first_name}}،\n\nبنتابع معاك بعد إلغاء اشتراكك السابق. لو حابب ترجع، الريسبشن يقدر يساعدك تعمل اشتراك جديد.\n\nATOM Jiu-Jitsu'),

('whatsapp','win_back','en','Win-back',null,'Hi {{first_name}}, this is ATOM Jiu-Jitsu. We would be happy to see you back on the mats. If you are thinking about returning, let us know and we can help you restart your training.'),
('whatsapp','win_back','ar','العودة للتمرين',null,'أهلاً {{first_name}}، معاك ATOM Jiu-Jitsu. هنكون مبسوطين نشوفك تاني على المات. لو بتفكر ترجع للتمرين كلّمنا ونساعدك تبدأ من جديد.'),
('email','win_back','en','Win-back','ATOM Jiu-Jitsu — Come back to training','Hi {{first_name}},\n\nWe would be happy to see you back on the mats. If you are thinking about returning, let us know and we can help you restart your training.\n\nATOM Jiu-Jitsu'),
('email','win_back','ar','العودة للتمرين','ATOM Jiu-Jitsu — الرجوع للتمرين','أهلاً {{first_name}}،\n\nهنكون مبسوطين نشوفك تاني على المات. لو بتفكر ترجع للتمرين كلّمنا ونساعدك تبدأ من جديد.\n\nATOM Jiu-Jitsu')
on conflict (channel,template_key,language) do nothing;
