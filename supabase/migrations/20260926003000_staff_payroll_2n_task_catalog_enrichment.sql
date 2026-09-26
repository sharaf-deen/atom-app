-- Staff Payroll 2N — Task Catalog Enrichment & Weighting
-- Purpose:
--   * Classify the original 59 ATOM payroll tasks using the existing 5-level importance model.
--   * Add 29 operational tasks across the existing 18 Areas (88 catalog tasks total).
--   * Preserve historical Monthly Task snapshots: this migration does NOT rewrite staff_monthly_task_logs.
-- Governance:
--   * No Area is added or removed.
--   * No task is hard-deleted.
--   * Existing source keys atom-task-01..59 are updated only for importance.
--   * New source keys atom-task-60..88 are inserted idempotently.

begin;

-- ---------------------------------------------------------------------------
-- 1) Classify the original 59 tasks.
-- ---------------------------------------------------------------------------

with weights(source_key, importance_level, importance_multiplier) as (
  values
    ('atom-task-01', 'responsibility',      1.35::numeric),
    ('atom-task-02', 'high_responsibility',1.60::numeric),
    ('atom-task-03', 'high_responsibility',1.60::numeric),
    ('atom-task-04', 'responsibility',      1.35::numeric),
    ('atom-task-05', 'responsibility',      1.35::numeric),
    ('atom-task-06', 'high_responsibility',1.60::numeric),
    ('atom-task-07', 'responsibility',      1.35::numeric),
    ('atom-task-08', 'responsibility',      1.35::numeric),
    ('atom-task-09', 'standard',            1.00::numeric),
    ('atom-task-10', 'standard',            1.00::numeric),
    ('atom-task-11', 'responsibility',      1.35::numeric),
    ('atom-task-12', 'important',           1.15::numeric),
    ('atom-task-13', 'responsibility',      1.35::numeric),
    ('atom-task-14', 'standard',            1.00::numeric),
    ('atom-task-15', 'standard',            1.00::numeric),
    ('atom-task-16', 'standard',            1.00::numeric),
    ('atom-task-17', 'responsibility',      1.35::numeric),
    ('atom-task-18', 'responsibility',      1.35::numeric),
    ('atom-task-19', 'important',           1.15::numeric),
    ('atom-task-20', 'responsibility',      1.35::numeric),
    ('atom-task-21', 'important',           1.15::numeric),
    ('atom-task-22', 'responsibility',      1.35::numeric),
    ('atom-task-23', 'high_responsibility',1.60::numeric),
    ('atom-task-24', 'responsibility',      1.35::numeric),
    ('atom-task-25', 'high_responsibility',1.60::numeric),
    ('atom-task-26', 'high_responsibility',1.60::numeric),
    ('atom-task-27', 'responsibility',      1.35::numeric),
    ('atom-task-28', 'important',           1.15::numeric),
    ('atom-task-29', 'important',           1.15::numeric),
    ('atom-task-30', 'responsibility',      1.35::numeric),
    ('atom-task-31', 'responsibility',      1.35::numeric),
    ('atom-task-32', 'important',           1.15::numeric),
    ('atom-task-33', 'high_responsibility',1.60::numeric),
    ('atom-task-34', 'responsibility',      1.35::numeric),
    ('atom-task-35', 'high_responsibility',1.60::numeric),
    ('atom-task-36', 'responsibility',      1.35::numeric),
    ('atom-task-37', 'important',           1.15::numeric),
    ('atom-task-38', 'standard',            1.00::numeric),
    ('atom-task-39', 'standard',            1.00::numeric),
    ('atom-task-40', 'important',           1.15::numeric),
    ('atom-task-41', 'standard',            1.00::numeric),
    ('atom-task-42', 'standard',            1.00::numeric),
    ('atom-task-43', 'important',           1.15::numeric),
    ('atom-task-44', 'important',           1.15::numeric),
    ('atom-task-45', 'important',           1.15::numeric),
    ('atom-task-46', 'responsibility',      1.35::numeric),
    ('atom-task-47', 'responsibility',      1.35::numeric),
    ('atom-task-48', 'important',           1.15::numeric),
    ('atom-task-49', 'responsibility',      1.35::numeric),
    ('atom-task-50', 'responsibility',      1.35::numeric),
    ('atom-task-51', 'important',           1.15::numeric),
    ('atom-task-52', 'responsibility',      1.35::numeric),
    ('atom-task-53', 'high_responsibility',1.60::numeric),
    ('atom-task-54', 'high_responsibility',1.60::numeric),
    ('atom-task-55', 'high_responsibility',1.60::numeric),
    ('atom-task-56', 'critical',            2.00::numeric),
    ('atom-task-57', 'critical',            2.00::numeric),
    ('atom-task-58', 'responsibility',      1.35::numeric),
    ('atom-task-59', 'high_responsibility',1.60::numeric)
)
update public.staff_tasks t
set
  importance_level = w.importance_level,
  importance_multiplier = w.importance_multiplier
from weights w
where t.source_key = w.source_key
  and (
    t.importance_level is distinct from w.importance_level
    or t.importance_multiplier is distinct from w.importance_multiplier
  );

-- ---------------------------------------------------------------------------
-- 2) Add 29 ATOM operational tasks to the existing Areas.
--    source_assignment_label remains a planning hint only.
-- ---------------------------------------------------------------------------

insert into public.staff_tasks (
  area_id,
  source_key,
  name,
  frequency_label,
  estimated_time_label,
  estimated_min_hours_per_week,
  estimated_max_hours_per_week,
  unit,
  importance_level,
  importance_multiplier,
  source_assignment_label,
  notes,
  sort_order,
  is_active
)
select
  a.id,
  v.source_key,
  v.task_name,
  v.frequency_label,
  v.estimated_time_label,
  v.estimated_min_hours_per_week,
  v.estimated_max_hours_per_week,
  v.unit,
  v.importance_level,
  v.importance_multiplier,
  v.source_assignment_label,
  v.notes,
  v.sort_order,
  true
from (
  values
    -- General Management
    ('general-management','atom-task-60','Weekly operations review & priorities',
      'Weekly','1–2 h/week',1::numeric,2::numeric,'hour','responsibility',1.35::numeric,
      'Sharaf','Review open operational issues, priorities, blockers and next actions across the academy.',600),
    ('general-management','atom-task-61','Cross-department coordination & follow-up',
      'Weekly','1–2 h/week',1::numeric,2::numeric,'hour','responsibility',1.35::numeric,
      'Sharaf / Admin Staff','Coordinate actions spanning reception, coaching, members, finance, schedule and operations.',610),
    ('general-management','atom-task-62','Policies / SOP creation & updates',
      'As needed','0.5–2 h/week',0.5::numeric,2::numeric,'hour','high_responsibility',1.60::numeric,
      'Sharaf','Create, document and update internal operating procedures, rules and staff workflows.',620),
    ('general-management','atom-task-63','Operational incident / escalation management',
      'As needed','Variable',null::numeric,null::numeric,'hour','high_responsibility',1.60::numeric,
      'Sharaf','Handle significant operational incidents or escalations not already captured by another Area.',630),

    -- Finance
    ('finance','atom-task-64','Monthly cash-flow planning',
      'Monthly','1–2 h/month',0.25::numeric,0.5::numeric,'hour','high_responsibility',1.60::numeric,
      'Sharaf','Review expected cash inflows, liabilities, rent, suppliers and short-term liquidity needs.',640),
    ('finance','atom-task-65','Payroll / staff cost review',
      'Monthly','1–2 h/month',0.25::numeric,0.5::numeric,'hour','high_responsibility',1.60::numeric,
      'Sharaf','Review staff cost, payroll ratios, variable-pool assumptions and monthly payroll affordability.',650),

    -- Member Administration
    ('member-administration','atom-task-66','Member profile / data corrections',
      'As needed','0.5–1.5 h/week',0.5::numeric,1.5::numeric,'hour','important',1.15::numeric,
      'Admin Staff','Correct member identity, contact, family-link, membership or account information after verification.',660),

    -- Member Communication
    ('member-communication','atom-task-67','Complaint / escalation communication',
      'As needed','0.5–1.5 h/week',0.5::numeric,1.5::numeric,'hour','responsibility',1.35::numeric,
      'Sharaf / Admin Staff','Handle sensitive member or parent complaints, escalations and resolution follow-up.',670),

    -- Schedule Management
    ('schedule-management','atom-task-68','Structured schedule maintenance / session setup',
      'Weekly','1–2 h/week',1::numeric,2::numeric,'hour','responsibility',1.35::numeric,
      'Sharaf / Admin Staff','Maintain structured sessions, templates, dates, groups and operational schedule accuracy.',680),

    -- Coaches / Staff
    ('coaches-staff','atom-task-69','Staff onboarding & role setup',
      'As needed','1–2 h/staff',null::numeric,null::numeric,'task','high_responsibility',1.60::numeric,
      'Sharaf','Onboard staff, explain responsibilities, configure access and establish operating expectations.',690),
    ('coaches-staff','atom-task-70','Performance feedback / corrective action',
      'As needed','0.5–1 h/case',null::numeric,null::numeric,'meeting','high_responsibility',1.60::numeric,
      'Sharaf / Shehab','Formal feedback, performance correction, conduct discussion and documented follow-up.',700),

    -- Technical Direction
    ('technical-direction','atom-task-71','Technique library / curriculum update',
      'Monthly','1–2 h/month',0.25::numeric,0.5::numeric,'hour','high_responsibility',1.60::numeric,
      'Sharaf','Maintain the technical curriculum, technique library, tags, situations and progression structure.',710),
    ('technical-direction','atom-task-72','Coach technical briefing / lesson alignment',
      'Weekly','0.5–1 h/week',0.5::numeric,1::numeric,'meeting','responsibility',1.35::numeric,
      'Sharaf / Shehab','Brief coaches on themes, lesson objectives, technical standards and teaching alignment.',720),

    -- Coaching
    ('coaching','atom-task-73','Baby 3–5 classes',
      'According to schedule','~1 h/class',null::numeric,null::numeric,'class','responsibility',1.35::numeric,
      'Coach Staff','Coaching and supervision of the 3–5 years group. Actual class time remains required.',730),
    ('coaching','atom-task-74','Masters 30+ classes',
      'According to schedule','1.5 h/class',null::numeric,null::numeric,'class','important',1.15::numeric,
      'Sharaf','Coaching of the Masters 30+ programme. Actual class time remains required.',740),
    ('coaching','atom-task-75','Competition team classes',
      'According to schedule','1.5–2 h/class',null::numeric,null::numeric,'class','high_responsibility',1.60::numeric,
      'Sharaf / Shehab','Competition-focused coaching requiring athlete preparation, tactical supervision and higher responsibility.',750),
    ('coaching','atom-task-76','Physical preparation sessions',
      'According to schedule','~1 h/session',null::numeric,null::numeric,'class','responsibility',1.35::numeric,
      'Coach Staff','Physical preparation session delivered as part of the academy programme.',760),
    ('coaching','atom-task-77','Open Mat supervision',
      'According to schedule','1.5–2 h/session',null::numeric,null::numeric,'class','important',1.15::numeric,
      'Coach Staff','Supervise safety, mat use and session operation during official ATOM Open Mat periods.',770),

    -- Competition
    ('competition','atom-task-78','Competition travel / logistics coordination',
      'Before events','1–3 h/event',null::numeric,null::numeric,'event','responsibility',1.35::numeric,
      'Sharaf / Admin Staff','Coordinate competition travel, timing, meeting points, documents and operational logistics.',780),

    -- Sales / Prospects
    ('sales-prospects','atom-task-79','Prospect follow-up queue management',
      'Daily','1–2 h/week',1::numeric,2::numeric,'hour','important',1.15::numeric,
      'Admin Staff','Review open prospects, next actions, overdue follow-ups and conversion pipeline hygiene.',790),

    -- Marketing
    ('marketing','atom-task-80','Content planning / editorial calendar',
      'Weekly','1–2 h/week',1::numeric,2::numeric,'hour','responsibility',1.35::numeric,
      'Sharaf / Admin Staff','Plan upcoming academy content, campaigns, competition coverage and publishing priorities.',800),

    -- ATOM Website / App
    ('atom-website-app','atom-task-81','Staging QA / regression testing',
      'By release','1–3 h/release',null::numeric,null::numeric,'project','responsibility',1.35::numeric,
      'Sharaf','Validate new or changed app flows on staging before production release.',810),
    ('atom-website-app','atom-task-82','Production deployment / post-release checks',
      'By release','0.5–1.5 h/release',null::numeric,null::numeric,'project','high_responsibility',1.60::numeric,
      'Sharaf','Coordinate production release and verify critical flows after deployment.',820),

    -- Store / Inventory
    ('store-inventory','atom-task-83','Preorder management',
      'Weekly','0.5–1.5 h/week',0.5::numeric,1.5::numeric,'hour','important',1.15::numeric,
      'Admin Staff','Manage member preorders, status follow-up, collection and operational exceptions.',830),

    -- Facility / Maintenance
    ('facility-maintenance','atom-task-84','Safety / first-aid equipment checks',
      'Monthly','0.5–1 h/month',0.125::numeric,0.25::numeric,'hour','responsibility',1.35::numeric,
      'Admin Staff','Check first-aid supplies and basic safety readiness of the academy.',840),

    -- Federation / External Administration
    ('federation-external-administration','atom-task-85','Federation member registrations / renewals',
      'Periodic','1–3 h/batch',null::numeric,null::numeric,'task','responsibility',1.35::numeric,
      'Sharaf / Admin Staff','Prepare and process federation member registrations or renewals, including required member documents.',850),

    -- Legal / Corporate
    ('legal-corporate','atom-task-86','Company resolutions / shareholder records',
      'As needed','1–3 h/case',null::numeric,null::numeric,'task','critical',2.00::numeric,
      'Sharaf','Prepare, review or coordinate company resolutions, shareholder records and high-impact corporate documentation.',860),

    -- Reporting
    ('reporting','atom-task-87','Payroll / monthly close summary',
      'Monthly','1–2 h/month',0.25::numeric,0.5::numeric,'report','responsibility',1.35::numeric,
      'Sharaf','Review and document monthly payroll outcome, payment closeout and staff-cost summary.',870),

    -- Development
    ('development','atom-task-88','New service / program design',
      'As needed','1–3 h/week',1::numeric,3::numeric,'project','high_responsibility',1.60::numeric,
      'Sharaf','Design and assess new academy services, programmes or operational offerings before launch.',880)
) as v(
  area_slug,
  source_key,
  task_name,
  frequency_label,
  estimated_time_label,
  estimated_min_hours_per_week,
  estimated_max_hours_per_week,
  unit,
  importance_level,
  importance_multiplier,
  source_assignment_label,
  notes,
  sort_order
)
join public.staff_task_areas a
  on a.slug = v.area_slug
on conflict (source_key) do nothing;

-- Make the catalog description reflect the enriched operational model.
comment on table public.staff_tasks is
  'Staff Payroll task catalog. Original 59 ATOM planning tasks plus operational extensions. Importance weights are used for future Monthly Task weighted-hour snapshots.';

commit;
