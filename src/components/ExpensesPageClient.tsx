'use client'

import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import { endOfMonth, format, startOfMonth, subDays } from 'date-fns'
import { toast } from 'sonner'

import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import InlineAlert from '@/components/ui/InlineAlert'

type RangePreset = 'today' | '7d' | 'month' | 'custom'

type Expense = {
  id: string
  date: string
  category_key: string | null // FK to expense_categories.key
  description: string | null
  amount: number
}

type ExpenseCategory = {
  key: string
  label: string
  group_name: string
  sort_order: number
  is_active: boolean
}

function toDateOnly(d: Date) {
  return format(d, 'yyyy-MM-dd')
}

function formatEGP(n: number) {
  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 2,
  }).format(n)
}

export default function ExpensesPageClient({ userRole }: { userRole: string }) {
  const supabase = createSupabaseBrowserClient()

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingCats, setLoadingCats] = useState(true)

  // QoL status (global)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error' | 'info'; msg: string }>({
    kind: '',
    msg: '',
  })

  // Filters
  const [preset, setPreset] = useState<RangePreset>('month')
  const [from, setFrom] = useState<string>(() => toDateOnly(startOfMonth(new Date())))
  const [to, setTo] = useState<string>(() => toDateOnly(endOfMonth(new Date())))
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  // Add form
  const [newExpense, setNewExpense] = useState({
    date: '',
    category_key: '',
    description: '',
    amount: '',
  })
  const [saving, setSaving] = useState(false)

  const canAdd = userRole === 'admin' || userRole === 'super_admin'

  async function loadCategories() {
    setLoadingCats(true)
    const { data, error } = await supabase
      .from('expense_categories')
      .select('key,label,group_name,sort_order,is_active')
      .eq('is_active', true)
      .order('group_name', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true })

    if (error) {
      console.error(error)
      setCategories([])
      setStatus({ kind: 'error', msg: error.message || 'Failed to load categories.' })
    } else {
      setCategories((data || []) as ExpenseCategory[])
    }
    setLoadingCats(false)
  }

  async function loadExpenses(rangeFrom?: string, rangeTo?: string) {
    setLoading(true)
    let query = supabase
      .from('expenses')
      .select('id,date,category_key,description,amount')
      .order('date', { ascending: false })

    if (rangeFrom) query = query.gte('date', rangeFrom)
    if (rangeTo) query = query.lte('date', rangeTo)

    const { data, error } = await query
    if (error) {
      console.error(error)
      setExpenses([])
      setStatus({ kind: 'error', msg: error.message || 'Failed to load expenses.' })
    } else {
      setExpenses((data || []) as Expense[])
    }
    setLoading(false)
  }

  function applyPreset(p: RangePreset) {
    const today = new Date()
    if (p === 'today') {
      const t = toDateOnly(today)
      setFrom(t)
      setTo(t)
      setPreset('today')
      return
    }
    if (p === '7d') {
      const t = toDateOnly(today)
      const f = toDateOnly(subDays(today, 6))
      setFrom(f)
      setTo(t)
      setPreset('7d')
      return
    }
    if (p === 'month') {
      setFrom(toDateOnly(startOfMonth(today)))
      setTo(toDateOnly(endOfMonth(today)))
      setPreset('month')
      return
    }
    setPreset('custom')
  }

  function clearFilters() {
    setCategoryFilter('all')
    applyPreset('month')
  }

  async function reloadAll() {
    setStatus({ kind: 'info', msg: 'Reloading…' })
    try {
      await Promise.all([loadCategories(), loadExpenses(from, to)])
      setStatus({ kind: '', msg: '' })
    } catch (e: any) {
      setStatus({ kind: 'error', msg: String(e?.message || e) })
    }
  }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault()
    setStatus({ kind: '', msg: '' })

    const amt = parseFloat(newExpense.amount)
    if (Number.isNaN(amt)) {
      setStatus({ kind: 'error', msg: 'Invalid amount.' })
      toast.error('Invalid amount')
      return
    }
    if (!newExpense.category_key) {
      setStatus({ kind: 'error', msg: 'Please choose a product.' })
      toast.error('Please choose a product')
      return
    }

    setSaving(true)
    setStatus({ kind: 'info', msg: 'Saving…' })

    const payload = {
      date: newExpense.date || new Date().toISOString().slice(0, 10),
      category_key: newExpense.category_key,
      description: newExpense.description.trim() || null,
      amount: amt,
    }

    const { error } = await supabase.from('expenses').insert([payload])

    if (error) {
      setSaving(false)
      setStatus({ kind: 'error', msg: error.message || 'Save failed.' })
      toast.error('Save failed')
      return
    }

    setNewExpense({ date: '', category_key: '', description: '', amount: '' })
    await loadExpenses(from, to)

    setSaving(false)
    setStatus({ kind: 'success', msg: 'Expense added.' })
    toast.success('Expense added')

    // Option: effacer le message success après 2s
    setTimeout(() => {
      setStatus((s) => (s.kind === 'success' ? { kind: '', msg: '' } : s))
    }, 2000)
  }

  // Initial loads
  useEffect(() => {
    loadCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadExpenses(from, to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  const labelByKey = useMemo(() => {
    const m = new Map<string, string>()
    categories.forEach((c) => m.set(c.key, c.label))
    return m
  }, [categories])

  const groupByKey = useMemo(() => {
    const m = new Map<string, string>()
    categories.forEach((c) => m.set(c.key, c.group_name))
    return m
  }, [categories])

  const categoriesByGroup = useMemo(() => {
    const acc = new Map<string, ExpenseCategory[]>()
    categories.forEach((c) => {
      const g = c.group_name || 'Other'
      acc.set(g, [...(acc.get(g) || []), c])
    })
    return Array.from(acc.entries())
  }, [categories])

  const filteredExpenses = useMemo(() => {
    if (categoryFilter === 'all') return expenses
    return expenses.filter((e) => (e.category_key || '') === categoryFilter)
  }, [expenses, categoryFilter])

  const total = useMemo(() => {
    return filteredExpenses.reduce(
      (sum, e) => sum + (typeof e.amount === 'number' ? e.amount : Number((e as any).amount || 0)),
      0
    )
  }, [filteredExpenses])

  const totalsByCategorySorted = useMemo(() => {
    const acc = new Map<string, number>()
    filteredExpenses.forEach((e) => {
      const key = e.category_key || 'other'
      const amount = typeof e.amount === 'number' ? e.amount : Number((e as any).amount || 0)
      acc.set(key, (acc.get(key) || 0) + amount)
    })

    const entries = Array.from(acc.entries())
    const indexOfKey = (k: string) => {
      const i = categories.findIndex((c) => c.key === k)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    entries.sort((a, b) => indexOfKey(a[0]) - indexOfKey(b[0]))
    return entries
  }, [filteredExpenses, categories])

  const rangeLabel = useMemo(() => {
    if (preset === 'today') return 'Today'
    if (preset === '7d') return 'Last 7 days'
    if (preset === 'month') return 'This month'
    return 'Custom'
  }, [preset])

  return (
    <div className="space-y-6">
      {/* Global status */}
      {status.msg ? (
        <InlineAlert
          variant={
            status.kind === 'error'
              ? 'error'
              : status.kind === 'success'
              ? 'success'
              : status.kind === 'info'
              ? 'info'
              : 'info'
          }
        >
          {status.msg}
        </InlineAlert>
      ) : null}

      {/* Add form (admins only) */}
      {canAdd && (
        <Card>
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Add expense</h2>
              <Button type="button" variant="outline" size="sm" onClick={reloadAll} disabled={loading || loadingCats || saving}>
                Reload
              </Button>
            </div>

            <form onSubmit={addExpense} className="mt-3 grid gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Input
                  type="date"
                  value={newExpense.date}
                  onChange={(e) => setNewExpense({ ...newExpense, date: e.target.value })}
                  label="Date"
                  disabled={saving}
                />

                <Select
                  value={newExpense.category_key}
                  onChange={(e) => setNewExpense({ ...newExpense, category_key: e.target.value })}
                  disabled={loadingCats || saving}
                  required
                  label="Product"
                >
                  <option value="">Select a product…</option>
                  {categoriesByGroup.map(([group, items]) => (
                    <optgroup key={group} label={group}>
                      {items.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>

                <Input
                  type="number"
                  step="0.01"
                  placeholder="Amount (EGP)"
                  value={newExpense.amount}
                  onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
                  required
                  label="Amount (EGP)"
                  disabled={saving}
                />
              </div>

              <Input
                type="text"
                placeholder="Description"
                value={newExpense.description}
                onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                label="Description"
                disabled={saving}
              />

              <div className="flex justify-end">
                <Button type="submit" className="w-full sm:w-auto" disabled={saving}>
                  {saving ? 'Saving…' : 'Add Expense'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters + Summary */}
      <Card>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Filters</h2>
              <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                {rangeLabel}: <span className="font-medium">{from}</span> → <span className="font-medium">{to}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant={preset === 'today' ? 'solid' : 'outline'} size="sm" onClick={() => applyPreset('today')}>
                Today
              </Button>
              <Button type="button" variant={preset === '7d' ? 'solid' : 'outline'} size="sm" onClick={() => applyPreset('7d')}>
                7d
              </Button>
              <Button type="button" variant={preset === 'month' ? 'solid' : 'outline'} size="sm" onClick={() => applyPreset('month')}>
                Month
              </Button>
              <Button type="button" variant={preset === 'custom' ? 'solid' : 'outline'} size="sm" onClick={() => applyPreset('custom')}>
                Custom
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value)
                setPreset('custom')
              }}
              disabled={preset !== 'custom'}
              label="From"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value)
                setPreset('custom')
              }}
              disabled={preset !== 'custom'}
              label="To"
            />
            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} disabled={loadingCats} label="Product">
              <option value="all">All products</option>
              {categoriesByGroup.map(([group, items]) => (
                <optgroup key={group} label={group}>
                  {items.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
              <div className="text-xs text-[hsl(var(--muted))]">Total</div>
              <div className="mt-1 text-lg font-semibold">{formatEGP(total)}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
              <div className="text-xs text-[hsl(var(--muted))]">Entries</div>
              <div className="mt-1 text-lg font-semibold">{filteredExpenses.length}</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
              <div className="text-xs text-[hsl(var(--muted))]">Filter</div>
              <div className="mt-1 text-sm font-semibold truncate">
                {categoryFilter === 'all' ? 'All products' : labelByKey.get(categoryFilter) || categoryFilter}
              </div>
              {categoryFilter !== 'all' && (
                <div className="mt-1 text-xs text-[hsl(var(--muted))] truncate">{groupByKey.get(categoryFilter) || ''}</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardContent>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">History</h2>
            <Button type="button" variant="outline" size="sm" onClick={() => loadExpenses(from, to)} disabled={loading}>
              Reload
            </Button>
          </div>

          {loading ? (
            <p className="mt-3 text-sm text-[hsl(var(--muted))]">Loading…</p>
          ) : (
            <div className="mt-3 grid gap-2">
              {filteredExpenses.map((ex) => {
                const product = ex.category_key ? labelByKey.get(ex.category_key) || ex.category_key : '—'
                const group = ex.category_key ? groupByKey.get(ex.category_key) : null
                return (
                  <div
                    key={ex.id}
                    className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="text-xs text-[hsl(var(--muted))]">
                        {ex.date ? format(new Date(ex.date), 'yyyy-MM-dd') : '—'}
                        {group ? <span className="mx-2">•</span> : null}
                        {group ? group : null}
                      </div>
                      <div className="mt-1 text-base font-semibold truncate">{product}</div>
                      {ex.description ? (
                        <div className="mt-1 text-sm text-[hsl(var(--muted))] break-words">{ex.description}</div>
                      ) : (
                        <div className="mt-1 text-sm text-[hsl(var(--muted))]">—</div>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-base font-semibold">{formatEGP(Number(ex.amount || 0))}</div>
                    </div>
                  </div>
                )
              })}

              {filteredExpenses.length === 0 && (
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-center text-sm text-[hsl(var(--muted))]">
                  No expenses for the selected period/filter.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mini report: total by product — suit les filtres */}
      {!loading && (
        <Card>
          <CardContent>
            <h2 className="text-lg font-semibold mb-2">Total by Product</h2>
            <ul className="space-y-1">
              {totalsByCategorySorted.map(([key, amt]) => (
                <li key={key} className="flex justify-between text-sm">
                  <span className="truncate pr-3">{labelByKey.get(key) || key}</span>
                  <span className="font-medium">{formatEGP(amt)}</span>
                </li>
              ))}
              {totalsByCategorySorted.length === 0 && <li className="text-sm text-[hsl(var(--muted))]">No data.</li>}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
