-- CRM UX 1B — Follow-up Workflow & Message Templates
-- Service-role-backed internal CRM tables. RLS enabled with no direct client policies.

create table if not exists public.crm_member_followups (
  member_id uuid primary key,
  status text not null default 'to_contact'
    check (status in ('to_contact','contacted','awaiting_reply','follow_up','resolved')),
  assigned_to uuid null,
  next_follow_up_at timestamptz null,
  last_contacted_at timestamptz null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_member_followups_status_idx
  on public.crm_member_followups(status);
create index if not exists crm_member_followups_assigned_idx
  on public.crm_member_followups(assigned_to);
create index if not exists crm_member_followups_next_idx
  on public.crm_member_followups(next_follow_up_at);

alter table public.crm_member_followups enable row level security;

create table if not exists public.crm_member_activities (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null,
  activity_type text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  actor_user_id uuid null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists crm_member_activities_member_idx
  on public.crm_member_activities(member_id, occurred_at desc);

alter table public.crm_member_activities enable row level security;

create table if not exists public.crm_message_templates (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp','email')),
  template_key text not null
    check (template_key in ('general_follow_up','renewal','payment_due','attendance_follow_up')),
  language text not null check (language in ('en','ar')),
  label text not null,
  subject_template text null,
  body_template text not null,
  is_active boolean not null default true,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel, template_key, language)
);

alter table public.crm_message_templates enable row level security;

insert into public.crm_message_templates
  (channel,template_key,language,label,subject_template,body_template)
values
  ('whatsapp','general_follow_up','en','General follow-up',null,'Hi {{first_name}}, this is ATOM Jiu-Jitsu. We are following up about your training and membership. Please let us know if you need any help.'),
  ('whatsapp','general_follow_up','ar','متابعة عامة',null,'أهلاً {{first_name}}، معاك ATOM Jiu-Jitsu. بنتابع معاك بخصوص التمرين والاشتراك. لو محتاج أي مساعدة كلّمنا في أي وقت.'),
  ('email','general_follow_up','en','General follow-up','ATOM Jiu-Jitsu — Follow-up','Hi {{first_name}},\n\nThis is ATOM Jiu-Jitsu. We are following up about your training and membership. Please let us know if you need any help.\n\nATOM Jiu-Jitsu'),
  ('email','general_follow_up','ar','متابعة عامة','ATOM Jiu-Jitsu — متابعة','أهلاً {{first_name}}،\n\nمعاك ATOM Jiu-Jitsu. بنتابع معاك بخصوص التمرين والاشتراك. لو محتاج أي مساعدة كلّمنا في أي وقت.\n\nATOM Jiu-Jitsu'),

  ('whatsapp','renewal','en','Renewal',null,'Hi {{first_name}}, this is ATOM Jiu-Jitsu. Your {{plan}} ends on {{expiry_date}}. Would you like us to help you renew it?'),
  ('whatsapp','renewal','ar','تجديد الاشتراك',null,'أهلاً {{first_name}}، معاك ATOM Jiu-Jitsu. اشتراك {{plan}} بينتهي يوم {{expiry_date}}. تحب نساعدك في التجديد؟'),
  ('email','renewal','en','Renewal','ATOM Jiu-Jitsu — Membership renewal','Hi {{first_name}},\n\nYour {{plan}} ends on {{expiry_date}}. Would you like us to help you renew it?\n\nATOM Jiu-Jitsu'),
  ('email','renewal','ar','تجديد الاشتراك','ATOM Jiu-Jitsu — تجديد الاشتراك','أهلاً {{first_name}}،\n\nاشتراك {{plan}} بينتهي يوم {{expiry_date}}. تحب نساعدك في التجديد؟\n\nATOM Jiu-Jitsu'),

  ('whatsapp','payment_due','en','Payment due',null,'Hi {{first_name}}, this is ATOM Jiu-Jitsu. There is a remaining balance of {{due_amount}} on your membership. Please contact reception so we can help you settle it.'),
  ('whatsapp','payment_due','ar','مبلغ متبقي',null,'أهلاً {{first_name}}، معاك ATOM Jiu-Jitsu. فيه مبلغ متبقي على اشتراكك بقيمة {{due_amount}}. من فضلك تواصل مع الريسبشن علشان نساعدك في التسوية.'),
  ('email','payment_due','en','Payment due','ATOM Jiu-Jitsu — Remaining membership balance','Hi {{first_name}},\n\nThere is a remaining balance of {{due_amount}} on your membership. Please contact reception so we can help you settle it.\n\nATOM Jiu-Jitsu'),
  ('email','payment_due','ar','مبلغ متبقي','ATOM Jiu-Jitsu — مبلغ متبقي','أهلاً {{first_name}}،\n\nفيه مبلغ متبقي على اشتراكك بقيمة {{due_amount}}. من فضلك تواصل مع الريسبشن علشان نساعدك في التسوية.\n\nATOM Jiu-Jitsu'),

  ('whatsapp','attendance_follow_up','en','Attendance follow-up',null,'Hi {{first_name}}, this is ATOM Jiu-Jitsu. We have not seen you in training recently. Your last recorded attendance was {{last_attendance}}. We hope everything is well — let us know if we can help.'),
  ('whatsapp','attendance_follow_up','ar','متابعة الحضور',null,'أهلاً {{first_name}}، معاك ATOM Jiu-Jitsu. لاحظنا إنك ماجتش التمرين من فترة وآخر حضور مسجل كان {{last_attendance}}. إن شاء الله تكون بخير، ولو محتاج أي مساعدة كلّمنا.'),
  ('email','attendance_follow_up','en','Attendance follow-up','ATOM Jiu-Jitsu — We missed you on the mats','Hi {{first_name}},\n\nWe have not seen you in training recently. Your last recorded attendance was {{last_attendance}}. We hope everything is well — let us know if we can help.\n\nATOM Jiu-Jitsu'),
  ('email','attendance_follow_up','ar','متابعة الحضور','ATOM Jiu-Jitsu — متابعة الحضور','أهلاً {{first_name}}،\n\nلاحظنا إنك ماجتش التمرين من فترة وآخر حضور مسجل كان {{last_attendance}}. إن شاء الله تكون بخير، ولو محتاج أي مساعدة كلّمنا.\n\nATOM Jiu-Jitsu')
on conflict (channel,template_key,language) do nothing;
