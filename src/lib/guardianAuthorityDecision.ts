import 'server-only'

/** Latest append-only decision for this precise guardian + child, not the whole family. */
export async function guardianAuthorityDecision(
  admin: any, familyId: string, guardianAuthUserId: string, childMemberUserId: string,
): Promise<'verified' | 'rejected' | 'requires_review'> {
  const { data, error } = await admin.from('atom_guardian_authority_reviews')
    .select('decision')
    .eq('family_id', familyId)
    .eq('guardian_auth_user_id', guardianAuthUserId)
    .eq('member_user_id', childMemberUserId)
    .order('reviewed_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
  if (error || !Array.isArray(data) || data.length !== 1) return 'requires_review'
  return data[0].decision === 'verified' ? 'verified'
    : data[0].decision === 'rejected' ? 'rejected' : 'requires_review'
}
