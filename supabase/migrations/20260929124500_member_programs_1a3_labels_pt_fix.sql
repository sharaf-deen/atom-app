-- Member Programs 1A.3 — Clean labels + PT terminology correction
-- PT means Private Training at ATOM.
-- Keep the official program names concise and prevent UI duplication.

begin;

update public.member_program_catalog
set level = 'Private Training',
    updated_at = now()
where key in ('kids-pt', 'adults-pt')
  and level is distinct from 'Private Training';

-- Keep the requested official display names.
update public.member_program_catalog
set name = case key
      when 'kids-pt' then 'Kids PT'
      when 'adults-pt' then 'Adults PT'
      else name
    end,
    updated_at = now()
where key in ('kids-pt', 'adults-pt');

-- Refresh existing enrollment snapshots for PT records.
update public.member_program_enrollments e
set program_name_snapshot = c.name,
    updated_at = now()
from public.member_program_catalog c
where c.key = e.program_key
  and c.key in ('kids-pt', 'adults-pt')
  and e.program_name_snapshot is distinct from c.name;

commit;
