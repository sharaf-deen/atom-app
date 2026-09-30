import 'server-only'

export type MemberLegalComplianceMissingDocument = {
  id: string
  document_key: string
  title: string
  version_label: string
  published_url: string
}

export type MemberLegalCompliance = {
  complete: boolean
  requiredCount: number
  acceptedCount: number
  missingDocuments: MemberLegalComplianceMissingDocument[]
}

export async function getMemberLegalCompliance(
  admin: any,
  memberUserId: string,
): Promise<MemberLegalCompliance> {
  const { data: requiredData, error: requiredError } = await admin
    .from('legal_document_versions')
    .select('id,document_key,title,version_label,published_url')
    .eq('status', 'active')
    .eq('is_required', true)

  if (requiredError) {
    throw new Error(`LEGAL_DOCUMENT_LOOKUP_FAILED: ${requiredError.message}`)
  }

  const required = (requiredData ?? []) as MemberLegalComplianceMissingDocument[]
  if (required.length === 0) {
    return {
      complete: true,
      requiredCount: 0,
      acceptedCount: 0,
      missingDocuments: [],
    }
  }

  const requiredIds = required.map((doc) => doc.id)

  const { data: acceptedData, error: acceptedError } = await admin
    .from('member_legal_acceptances')
    .select('document_version_id')
    .eq('member_user_id', memberUserId)
    .in('document_version_id', requiredIds)

  if (acceptedError) {
    throw new Error(`LEGAL_ACCEPTANCE_LOOKUP_FAILED: ${acceptedError.message}`)
  }

  const acceptedIds = new Set(
    (acceptedData ?? [])
      .map((row: any) => String(row.document_version_id || '').trim())
      .filter(Boolean),
  )

  const missingDocuments = required.filter((doc) => !acceptedIds.has(doc.id))

  return {
    complete: missingDocuments.length === 0,
    requiredCount: required.length,
    acceptedCount: required.length - missingDocuments.length,
    missingDocuments,
  }
}
