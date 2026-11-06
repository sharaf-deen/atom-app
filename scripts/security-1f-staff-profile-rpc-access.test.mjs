#!/usr/bin/env node
// Security 1F source-only permission test; no network/database writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql=readFileSync('supabase/migrations/20261106130000_security_hardening_1f_staff_profile_rpc_revoke.sql','utf8')
const route=readFileSync('src/app/api/staff-payroll/staff-profiles/route.ts','utf8')

test('staff profile mutation requires server-side super admin authorization',()=>{
 assert.match(sql,/REVOKE EXECUTE ON FUNCTION/i)
 assert.match(sql,/staff_payroll_save_staff_profile\(uuid, uuid, text, text\[\], text, date, date, text, uuid\[\], uuid\[\]\)/i)
 assert.match(sql,/FROM PUBLIC, anon, authenticated;/)
 assert.doesNotMatch(sql,/FROM\s+service_role|DROP FUNCTION|TRUNCATE|DELETE FROM/)
 assert.match(route,/actor\.role !== 'super_admin'/)
 assert.match(route,/admin\.rpc\('staff_payroll_save_staff_profile'/)
})
