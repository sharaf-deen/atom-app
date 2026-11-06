#!/usr/bin/env node
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261106132000_security_hardening_1f_assert_client_privileges.sql','utf8')
test('1F DB assertion verifies both client denial and server access', () => {
  assert.match(sql,/has_table_privilege\('anon','public\.admin_income_events_open_v1','SELECT'\)/)
  assert.match(sql,/has_table_privilege\('authenticated','public\.admin_income_events_open_v1','SELECT'\)/)
  assert.match(sql,/has_function_privilege\('anon','public\.staff_payroll_save_task_minimum_rates\(date,jsonb,jsonb,uuid\)','EXECUTE'\)/)
  assert.match(sql,/has_function_privilege\('authenticated','public\.staff_payroll_save_task_minimum_rates\(date,jsonb,jsonb,uuid\)','EXECUTE'\)/)
  assert.match(sql,/NOT has_function_privilege\('service_role'/)
  assert.doesNotMatch(sql,/DROP\s+(?:TABLE|FUNCTION)|DELETE\s+FROM|TRUNCATE/i)
})
