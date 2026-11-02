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
  env: LaunchEnvironment = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    ATOM_REGISTRATION_ACCESS_MODE: process.env.ATOM_REGISTRATION_ACCESS_MODE,
    ATOM_REGISTRATION_PILOT_EMAIL_ALLOWLIST: process.env.ATOM_REGISTRATION_PILOT_EMAIL_ALLOWLIST,
  },
): 'allowed' | 'closed' | 'not_in_pilot' {
  // Only explicit Vercel Preview/Development environments bypass the production gate.
  // Missing or unknown environment metadata must fail closed.
  if (env.VERCEL_ENV === 'preview' || env.VERCEL_ENV === 'development') return 'allowed'

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
