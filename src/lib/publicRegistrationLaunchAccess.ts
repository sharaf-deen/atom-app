import 'server-only'

type LaunchEnvironment = {
  VERCEL_ENV?: string
  ATOM_REGISTRATION_ACCESS_MODE?: string
  ATOM_REGISTRATION_PILOT_EMAIL_ALLOWLIST?: string
}

/**
 * Production only: public registration is closed unless an explicit access mode
 * is configured. In pilot mode, only controlled e-mail addresses can submit.
 * The submit feature flag remains a separate mandatory check in the API.
 *
 * Staging (Vercel preview/custom environment) retains the existing E2E flow.
 */
export function registrationLaunchAccess(
  accountEmail: string,
  env: LaunchEnvironment = process.env,
): 'allowed' | 'closed' | 'not_in_pilot' {
  if (env.VERCEL_ENV !== 'production') return 'allowed'

  if (env.ATOM_REGISTRATION_ACCESS_MODE === 'public') return 'allowed'
  if (env.ATOM_REGISTRATION_ACCESS_MODE !== 'pilot') return 'closed'

  const normalizedEmail = accountEmail.trim().toLowerCase()
  if (!normalizedEmail) return 'not_in_pilot'

  const allowlist = (env.ATOM_REGISTRATION_PILOT_EMAIL_ALLOWLIST || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(value => value.length > 0)
  return allowlist.includes(normalizedEmail) ? 'allowed' : 'not_in_pilot'
}
