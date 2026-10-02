-- Prospects Message Templates 1G

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.prospect_message_templates'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%template_key%'
  loop
    execute format(
      'alter table public.prospect_message_templates drop constraint %I',
      constraint_row.conname
    );
  end loop;
end $$;

alter table public.prospect_message_templates
  add constraint prospect_message_templates_template_key_chk
  check (
    template_key in (
      'first_contact',
      'follow_up',
      'trial_reminder',
      'pricing_membership',
      'schedule_info',
      'trial_invitation',
      'needs_time',
      'no_response_follow_up',
      'trial_reschedule',
      'post_trial_follow_up',
      'final_follow_up'
    )
  );

insert into public.prospect_message_templates
(channel,template_key,language,label,subject_template,body_template)
values
('whatsapp','pricing_membership','en','Pricing / Membership',null,'Hi {{first_name}}, Thanks for your interest in ATOM Jiu-Jitsu. Membership is organized by training level rather than paying per class. Your first trial session is free, and after the trial we can help you choose the most suitable membership option.'),
('email','pricing_membership','en','Pricing / Membership','ATOM Jiu-Jitsu — Pricing / Membership','Hi {{first_name}}, 

Thanks for your interest in ATOM Jiu-Jitsu. Membership is organized by training level rather than paying per class. Your first trial session is free, and after the trial we can help you choose the most suitable membership option.

ATOM Jiu-Jitsu'),
('whatsapp','pricing_membership','ar','الأسعار والاشتراك',null,'أهلاً {{first_name}}، شكراً لاهتمامك بـ ATOM Jiu-Jitsu. الاشتراك بيكون حسب مستوى التدريب وليس بالدفع لكل حصة. أول حصة تجريبية مجانية، وبعد التجربة نقدر نساعدك تختار الاشتراك الأنسب ليك.'),
('email','pricing_membership','ar','الأسعار والاشتراك','ATOM Jiu-Jitsu — الأسعار والاشتراك','أهلاً {{first_name}}، 

شكراً لاهتمامك بـ ATOM Jiu-Jitsu. الاشتراك بيكون حسب مستوى التدريب وليس بالدفع لكل حصة. أول حصة تجريبية مجانية، وبعد التجربة نقدر نساعدك تختار الاشتراك الأنسب ليك.

ATOM Jiu-Jitsu'),
('whatsapp','schedule_info','en','Schedule / Class Times',null,'Hi {{first_name}}, For {{requested_class}}, we can help you identify the correct class according to age and experience level. Tell us which days usually work best for you and we will guide you to the most suitable session.'),
('email','schedule_info','en','Schedule / Class Times','ATOM Jiu-Jitsu — Schedule / Class Times','Hi {{first_name}}, 

For {{requested_class}}, we can help you identify the correct class according to age and experience level. Tell us which days usually work best for you and we will guide you to the most suitable session.

ATOM Jiu-Jitsu'),
('whatsapp','schedule_info','ar','مواعيد التمرين',null,'أهلاً {{first_name}}، بالنسبة لـ {{requested_class}} نقدر نحدد لك المجموعة المناسبة حسب السن ومستوى الخبرة. قول لنا الأيام الأنسب ليك وإحنا نوجّهك للحصة المناسبة.'),
('email','schedule_info','ar','مواعيد التمرين','ATOM Jiu-Jitsu — مواعيد التمرين','أهلاً {{first_name}}، 

بالنسبة لـ {{requested_class}} نقدر نحدد لك المجموعة المناسبة حسب السن ومستوى الخبرة. قول لنا الأيام الأنسب ليك وإحنا نوجّهك للحصة المناسبة.

ATOM Jiu-Jitsu'),
('whatsapp','trial_invitation','en','Invite to Free Trial',null,'Hi {{first_name}}, You are welcome to come for a free trial of {{requested_class}} at ATOM Jiu-Jitsu. Registration is required before the trial so we can prepare the correct group for you. Would you like us to arrange a trial date?'),
('email','trial_invitation','en','Invite to Free Trial','ATOM Jiu-Jitsu — Invite to Free Trial','Hi {{first_name}}, 

You are welcome to come for a free trial of {{requested_class}} at ATOM Jiu-Jitsu. Registration is required before the trial so we can prepare the correct group for you. Would you like us to arrange a trial date?

ATOM Jiu-Jitsu'),
('whatsapp','trial_invitation','ar','دعوة لحصة تجريبية',null,'أهلاً {{first_name}}، تقدر تيجي حصة تجريبية مجانية لـ {{requested_class}} في ATOM Jiu-Jitsu. التسجيل مطلوب قبل التجربة علشان نحدد لك المجموعة المناسبة. تحب نرتب لك موعد للتجربة؟'),
('email','trial_invitation','ar','دعوة لحصة تجريبية','ATOM Jiu-Jitsu — دعوة لحصة تجريبية','أهلاً {{first_name}}، 

تقدر تيجي حصة تجريبية مجانية لـ {{requested_class}} في ATOM Jiu-Jitsu. التسجيل مطلوب قبل التجربة علشان نحدد لك المجموعة المناسبة. تحب نرتب لك موعد للتجربة؟

ATOM Jiu-Jitsu'),
('whatsapp','needs_time','en','Needs Time / Thinking',null,'Hi {{first_name}}, Of course, no problem. Take your time. If you have any questions about the training, schedule or membership, feel free to message us. We will be happy to help whenever you are ready.'),
('email','needs_time','en','Needs Time / Thinking','ATOM Jiu-Jitsu — Needs Time / Thinking','Hi {{first_name}}, 

Of course, no problem. Take your time. If you have any questions about the training, schedule or membership, feel free to message us. We will be happy to help whenever you are ready.

ATOM Jiu-Jitsu'),
('whatsapp','needs_time','ar','محتاج وقت للتفكير',null,'أهلاً {{first_name}}، طبعاً مفيش مشكلة. خُد وقتك، ولو عندك أي سؤال عن التمرين أو المواعيد أو الاشتراك ابعت لنا في أي وقت. هنكون مبسوطين نساعدك لما تكون جاهز.'),
('email','needs_time','ar','محتاج وقت للتفكير','ATOM Jiu-Jitsu — محتاج وقت للتفكير','أهلاً {{first_name}}، 

طبعاً مفيش مشكلة. خُد وقتك، ولو عندك أي سؤال عن التمرين أو المواعيد أو الاشتراك ابعت لنا في أي وقت. هنكون مبسوطين نساعدك لما تكون جاهز.

ATOM Jiu-Jitsu'),
('whatsapp','no_response_follow_up','en','No Response Follow-Up',null,'Hi {{first_name}}, Just following up on your enquiry about {{requested_class}}. I wanted to make sure you received our previous message. If you are still interested, we can help you with the next step or arrange your free trial.'),
('email','no_response_follow_up','en','No Response Follow-Up','ATOM Jiu-Jitsu — No Response Follow-Up','Hi {{first_name}}, 

Just following up on your enquiry about {{requested_class}}. I wanted to make sure you received our previous message. If you are still interested, we can help you with the next step or arrange your free trial.

ATOM Jiu-Jitsu'),
('whatsapp','no_response_follow_up','ar','متابعة بدون رد',null,'أهلاً {{first_name}}، بنتابع معاك بخصوص استفسارك عن {{requested_class}} وحبينا نتأكد إن رسالتنا السابقة وصلتك. لو لسه مهتم نقدر نساعدك في الخطوة الجاية أو نرتب لك الحصة التجريبية المجانية.'),
('email','no_response_follow_up','ar','متابعة بدون رد','ATOM Jiu-Jitsu — متابعة بدون رد','أهلاً {{first_name}}، 

بنتابع معاك بخصوص استفسارك عن {{requested_class}} وحبينا نتأكد إن رسالتنا السابقة وصلتك. لو لسه مهتم نقدر نساعدك في الخطوة الجاية أو نرتب لك الحصة التجريبية المجانية.

ATOM Jiu-Jitsu'),
('whatsapp','trial_reschedule','en','Trial Reschedule',null,'Hi {{first_name}}, No problem if you could not make your trial. We can reschedule it for another suitable day. Send us the days that work best for you and we will confirm the next available option.'),
('email','trial_reschedule','en','Trial Reschedule','ATOM Jiu-Jitsu — Trial Reschedule','Hi {{first_name}}, 

No problem if you could not make your trial. We can reschedule it for another suitable day. Send us the days that work best for you and we will confirm the next available option.

ATOM Jiu-Jitsu'),
('whatsapp','trial_reschedule','ar','إعادة تحديد موعد التجربة',null,'أهلاً {{first_name}}، مفيش مشكلة لو ماقدرتش تحضر الحصة التجريبية. نقدر نحدد لك موعد جديد في يوم أنسب. ابعت لنا الأيام المناسبة ليك وإحنا نأكد لك أقرب موعد متاح.'),
('email','trial_reschedule','ar','إعادة تحديد موعد التجربة','ATOM Jiu-Jitsu — إعادة تحديد موعد التجربة','أهلاً {{first_name}}، 

مفيش مشكلة لو ماقدرتش تحضر الحصة التجريبية. نقدر نحدد لك موعد جديد في يوم أنسب. ابعت لنا الأيام المناسبة ليك وإحنا نأكد لك أقرب موعد متاح.

ATOM Jiu-Jitsu'),
('whatsapp','post_trial_follow_up','en','Post-Trial Follow-Up',null,'Hi {{first_name}}, We hope you enjoyed your trial at ATOM Jiu-Jitsu. How did the session go for you? If you would like to continue, we can help you with the appropriate membership and next class.'),
('email','post_trial_follow_up','en','Post-Trial Follow-Up','ATOM Jiu-Jitsu — Post-Trial Follow-Up','Hi {{first_name}}, 

We hope you enjoyed your trial at ATOM Jiu-Jitsu. How did the session go for you? If you would like to continue, we can help you with the appropriate membership and next class.

ATOM Jiu-Jitsu'),
('whatsapp','post_trial_follow_up','ar','متابعة بعد الحصة التجريبية',null,'أهلاً {{first_name}}، نتمنى تكون استمتعت بالحصة التجريبية في ATOM Jiu-Jitsu. إيه رأيك في الحصة؟ لو حابب تكمل نقدر نساعدك في اختيار الاشتراك المناسب والحصة الجاية.'),
('email','post_trial_follow_up','ar','متابعة بعد الحصة التجريبية','ATOM Jiu-Jitsu — متابعة بعد الحصة التجريبية','أهلاً {{first_name}}، 

نتمنى تكون استمتعت بالحصة التجريبية في ATOM Jiu-Jitsu. إيه رأيك في الحصة؟ لو حابب تكمل نقدر نساعدك في اختيار الاشتراك المناسب والحصة الجاية.

ATOM Jiu-Jitsu'),
('whatsapp','final_follow_up','en','Final Follow-Up',null,'Hi {{first_name}}, This is our final follow-up regarding your enquiry about {{requested_class}}. We will close the follow-up for now so we do not keep disturbing you. If you decide to start later, you are always welcome to contact ATOM Jiu-Jitsu.'),
('email','final_follow_up','en','Final Follow-Up','ATOM Jiu-Jitsu — Final Follow-Up','Hi {{first_name}}, 

This is our final follow-up regarding your enquiry about {{requested_class}}. We will close the follow-up for now so we do not keep disturbing you. If you decide to start later, you are always welcome to contact ATOM Jiu-Jitsu.

ATOM Jiu-Jitsu'),
('whatsapp','final_follow_up','ar','آخر متابعة',null,'أهلاً {{first_name}}، دي آخر متابعة بخصوص استفسارك عن {{requested_class}}. هنوقف المتابعة حالياً علشان ما نزعجكش. لو قررت تبدأ في وقت لاحق، تقدر تتواصل مع ATOM Jiu-Jitsu في أي وقت.'),
('email','final_follow_up','ar','آخر متابعة','ATOM Jiu-Jitsu — آخر متابعة','أهلاً {{first_name}}، 

دي آخر متابعة بخصوص استفسارك عن {{requested_class}}. هنوقف المتابعة حالياً علشان ما نزعجكش. لو قررت تبدأ في وقت لاحق، تقدر تتواصل مع ATOM Jiu-Jitsu في أي وقت.

ATOM Jiu-Jitsu')
on conflict (channel,template_key,language) do nothing;
