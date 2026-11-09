-- ATOM CRM — WhatsApp assisted follow-up. No messages are sent from the server.
begin;
alter table public.prospect_message_templates
 drop constraint if exists prospect_message_templates_language_check;
alter table public.prospect_message_templates
 add constraint prospect_message_templates_language_check check(language in ('en','ar','fr'));

create or replace function public.crm_confirm_prospect_whatsapp_sent_v1(
 p_prospect_id uuid,p_actor uuid,p_message text,p_follow_up_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.prospects%rowtype;
 v_activity public.prospect_activities%rowtype;
 v_role text;
 v_now timestamptz:=now();
begin
 select role into v_role from public.profiles where user_id=p_actor;
 if v_role not in ('reception','admin','super_admin') then raise exception 'CRM_PERMISSION_DENIED';end if;
 if p_message is null or length(btrim(p_message)) not between 1 and 4000 then raise exception 'INVALID_MESSAGE';end if;
 if p_follow_up_at is not null and
  (p_follow_up_at < v_now + interval '1 minute' or p_follow_up_at > v_now + interval '30 days') then
  raise exception 'INVALID_FOLLOW_UP_DATE';
 end if;
 select * into v_row from public.prospects where id=p_prospect_id for update;
 if not found then raise exception 'PROSPECT_NOT_FOUND'; end if;
 if v_row.status in ('joined','lost') or v_row.linked_member_id is not null then raise exception 'PROSPECT_ALREADY_CLOSED';end if;
 if v_row.phone_digits is null or length(v_row.phone_digits)<8 then raise exception 'WHATSAPP_PHONE_REQUIRED';end if;
 update public.prospects set
  status=case when status in ('new','contacted','awaiting_reply') then 'awaiting_reply' else status end,
  last_contacted_at=v_now,next_follow_up_at=p_follow_up_at,
  updated_at=v_now,updated_by=p_actor
 where id=p_prospect_id returning * into v_row;
 insert into public.prospect_activities(prospect_id,activity_type,summary,details,actor_user_id,occurred_at)
 values(p_prospect_id,'whatsapp','WhatsApp message manually confirmed as sent',
  jsonb_build_object('mode','assisted','delivery_unverified',true,'message',btrim(p_message),
   'next_follow_up_at',p_follow_up_at),p_actor,v_now)
 returning * into v_activity;
 return jsonb_build_object('prospect',to_jsonb(v_row),'activity',to_jsonb(v_activity));
end $$;
revoke all on function public.crm_confirm_prospect_whatsapp_sent_v1(uuid,uuid,text,timestamptz)
 from public,anon,authenticated;
grant execute on function public.crm_confirm_prospect_whatsapp_sent_v1(uuid,uuid,text,timestamptz) to service_role;

insert into public.prospect_message_templates
(channel,template_key,language,label,subject_template,body_template,is_active)
values
('whatsapp','first_contact','fr','Premier contact',null,'Bonjour {{first_name}}, merci pour votre intérêt pour Atom Jiu-Jitsu Academy. Quels cours recherchez-vous ? Nous serons ravis de vous renseigner.',true),
('whatsapp','follow_up','fr','Relance',null,'Bonjour {{first_name}}, je reviens vers vous concernant votre demande pour les cours de Jiu-Jitsu. Avez-vous des questions ?',true),
('whatsapp','trial_reminder','fr','Rappel séance d’essai',null,'Bonjour {{first_name}}, petit rappel pour la séance d’essai prévue le {{trial_date}} chez Atom. À bientôt inshaAllah !',true),
('whatsapp','pricing_membership','fr','Tarifs et abonnements',null,'Bonjour {{first_name}}, l’abonnement mensuel est de 2 200 EGP. Je peux vous expliquer les autres formules selon vos besoins.',true),
('whatsapp','schedule_info','fr','Horaires des cours',null,'Bonjour {{first_name}}, nous proposons plusieurs groupes de Jiu-Jitsu. Pouvez-vous me préciser l’âge et le niveau du participant pour vous transmettre le planning adapté ?',true),
('whatsapp','trial_invitation','fr','Invitation essai',null,'Bonjour {{first_name}}, vous pouvez venir découvrir un cours de Jiu-Jitsu chez Atom lors d’une séance d’essai gratuite. Quel jour vous conviendrait ?',true),
('whatsapp','needs_time','fr','Besoin de réfléchir',null,'Aucun problème {{first_name}}, prenez le temps nécessaire. Je reste disponible si vous avez des questions.',true),
('whatsapp','no_response_follow_up','fr','Relance sans réponse',null,'Bonjour {{first_name}}, je voulais simplement savoir si vous étiez toujours intéressé par nos cours. N’hésitez pas à me répondre quand vous serez disponible.',true),
('whatsapp','trial_reschedule','fr','Reporter essai',null,'Bonjour {{first_name}}, nous pouvons reporter la séance d’essai. Quel autre jour vous conviendrait ?',true),
('whatsapp','post_trial_follow_up','fr','Après séance d’essai',null,'Bonjour {{first_name}}, j’espère que la séance d’essai chez Atom s’est bien passée. Souhaitez-vous poursuivre avec une inscription ?',true),
('whatsapp','final_follow_up','fr','Dernière relance',null,'Bonjour {{first_name}}, je reste disponible si vous souhaitez reprendre contact avec nous à propos des cours chez Atom. Bonne journée !',true)
on conflict(channel,template_key,language) do nothing;
commit;
