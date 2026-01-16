'use client'

import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, format, subDays } from 'date-fns'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'

type Period = 'month' | 'week' | 'custom'

type Expense = {
  id: string
  date: string
  category_key: string | null
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

const HISTORY_PAGE_SIZE = 5

function toDateOnly(d: Date) {
  return format(d, 'yyyy-MM-dd')
}

function formatEGP(n: number) {
  return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(n)
}

export default function ExpensesPageClient({ userRole }: { userRole: string }) {
  const supabase = createSupabaseBrowserClient()

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingCats, setLoadingCats] = useState(true)
  const [msg, setMsg] = useState<string>('')

  // Filters
  const [period, setPeriod] = useState<Period>('month')
  const [from, setFrom] = useState<string>(() => toDateOnly(startOfMonth(new Date())))
  const [to, setTo] = useState<string>(() => toDateOnly(endOfMonth(new Date())))
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  // History pagination
  const [histPage, setHistPage] = useState(1)

  // Add form
  const [newExpense, setNewExpense] = useState({
    date: '',
    category_key: '',
    description: '',
    amount: '',
  })

  const canAdd = ['reception', 'admin', 'super_admin'].includes(userRole)
  const canDelete = ['admin', 'super_admin'].includes(userRole)

  async function loadCategories() {
    setLoadingCats(true)
    const { data, error } = await supabase
      .from('expense_categories')
      .select('key,label,group_name,sort_order,is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true })

    if (error) {
      console.error(error)
      setCategories([])
    } else {
      setCategories((data || []) as ExpenseCategory[])
    }
    setLoadingCats(false)
  }

  async function loadExpenses(rangeFrom?: string, rangeTo?: string) {
    setLoading(true)
    setMsg('Loading…')

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
      setMsg(`❌ ${error.message}`)
    } else {
      setExpenses((data || []) as Expense[])
      setMsg('')
    }
    setLoading(false)
  }

  // Period auto-range
  useEffect(() => {
    const today = new Date()
    if (period === 'month') {
      setFrom(toDateOnly(startOfMonth(today)))
      setTo(toDateOnly(endOfMonth(today)))
    } else if (period === 'week') {
      // Egypt week: Saturday->Friday
      setFrom(toDateOnly(startOfWeek(today, { weekStartsOn: 6 })))
      setTo(toDateOnly(endOfWeek(today, { weekStartsOn: 6 })))
    }
  }, [period])

  // Initial
  useEffect(() => {
    loadCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadExpenses(from, to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  // Reset pagination when filters change
  useEffect(() => {
    setHistPage(1)
  }, [from, to, categoryFilter])

  async function addExpense(e: React.FormEvent) {
    e.preventDefault()

    const amt = parseFloat(newExpense.amount)
    if (Number.isNaN(amt)) return alert('Invalid amount')
    if (!newExpense.category_key) return alert('Please choose a product/category')

    const { error } = await supabase.from('expenses').insert([
      {
        date: newExpense.date || new Date().toISOString().slice(0, 10),
        category_key: newExpense.category_key,
        description: newExpense.description.trim() || null,
        amount: amt,
      },
    ])

    if (error) return alert(error.message)

    setNewExpense({ date: '', category_key: '', description: '', amount: '' })
    await loadExpenses(from, to)
  }

  async function deleteExpense(id: string) {
    if (!canDelete) return
    if (!confirm('Delete this expense?')) return
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (error) return alert(error.message)
    await loadExpenses(from, to)
  }

  const labelByKey = useMemo(() => {
    const m = new Map<string, string>()
    categories.forEach((c) => m.set(c.key, c.label))
    return m
  }, [categories])

  const categoryOptions = useMemo(() => ['all', ...categories.map((c) => c.key)], [categories])

  const filteredExpenses = useMemo(() => {
    if (categoryFilter === 'all') return expenses
    return expenses.filter((e) => (e.category_key || '') === categoryFilter)
  }, [expenses, categoryFilter])

  const total = useMemo(() => filteredExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0), [filteredExpenses])

  const totalPages = Math.max(1, Math.ceil(filteredExpenses.length / HISTORY_PAGE_SIZE))
  const pageItems = useMemo(() => {
    const start = (histPage - 1) * HISTORY_PAGE_SIZE
    return filteredExpenses.slice(start, start + HISTORY_PAGE_SIZE)
  }, [filteredExpenses, histPage])

  const totalsByCategorySorted = useMemo(() => {
    const acc = new Map<string, number>()
    filteredExpenses.forEach((e) => {
      const key = e.category_key || 'other'
      acc.set(key, (acc.get(key) || 0) + Number(e.amount || 0))
    })

    const entries = Array.from(acc.entries())
    const indexOfKey = (k: string) => {
      const i = categories.findIndex((c) => c.key === k)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    entries.sort((a, b) => indexOfKey(a[0]) - indexOfKey(b[0]))
    return entries
  }, [filteredExpenses, categories])

  function setToday() {
    const t = new Date()
    setPeriod('custom')
    setFrom(toDateOnly(t))
    setTo(toDateOnly(t))
  }
  function setLast7() {
    const t = new Date()
    setPeriod('custom')
    setFrom(toDateOnly(subDays(t, 6)))
    setTo(toDateOnly(t))
  }
  function setThisMonth() {
    setPeriod('month')
  }
  function clearFilters() {
    setPeriod('month')
    setCategoryFilter('all')
  }
  async function reloadAll() {
    await loadCategories()
    await loadExpenses(from, to)
  }

  return (
    <div className="space-y-6">
      {/* Top summary */}
      <Card>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm text-[hsl(var(--muted))]">Total (current filters)</div>
              <div className="mt-1 text-2xl font-semibold">{formatEGP(total)}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                Period: <span className="font-medium">{from}</span> → <span className="font-medium">{to}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={setToday}>Today</Button>
              <Button variant="outline" onClick={setLast7}>Last 7 days</Button>
              <Button variant="outline" onClick={setThisMonth}>This month</Button>
              <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>
              <Button variant="ghost" onClick={reloadAll}>Reload</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add form */}
      {canAdd && (
        <Card>
          <CardContent>
            <h2 className="text-lg font-semibold">Add expense</h2>
            <form onSubmit={addExpense} className="mt-3 grid gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Input
                  type="date"
                  value={newExpense.date}
                  onChange={(e) => setNewExpense({ ...newExpense, date: e.target.value })}
                  label="Date"
                />

                <Select
                  value={newExpense.category_key}
                  onChange={(e) => setNewExpense({ ...newExpense, category_key: e.target.value })}
                  disabled={loadingCats}
                  required
                  label="Product"
                >
                  <option value="">Select a product…</option>
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
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
                />
              </div>

              <Input
                type="text"
                placeholder="Note / vendor / details…"
                value={newExpense.description}
                onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                label="Note"
              />

              <div className="flex justify-end">
                <Button type="submit" className="w-full sm:w-auto">Add</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters (classic) */}
      <Card>
        <CardContent>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Filters</h2>
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} label="Period">
              <option value="month">Current Month</option>
              <option value="week">Current Week</option>
              <option value="custom">Custom Range</option>
            </Select>

            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={period !== 'custom'} label="From" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={period !== 'custom'} label="To" />

            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} disabled={loadingCats} label="Product">
              {categoryOptions.map((key) => (
                <option key={key} value={key}>
                  {key === 'all' ? 'All products' : labelByKey.get(key) || key}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* History (cards) */}
      <Card>
        <CardContent>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">History</h2>
            <div className="text-sm text-[hsl(var(--muted))]">
              Page <span className="font-medium">{histPage}</span> / <span className="font-medium">{totalPages}</span>
            </div>
          </div>

          {msg && <p className="mt-2 text-sm">{msg}</p>}

          {loading ? (
            <p className="mt-3 text-sm text-[hsl(var(--muted))]">Loading…</p>
          ) : (
            <div className="mt-3 space-y-3">
              {pageItems.map((ex) => {
                const productLabel = ex.category_key ? (labelByKey.get(ex.category_key) || ex.category_key) : '—'
                return (
                  <div key={ex.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted))]">Product</div>
                        <div className="text-lg font-semibold truncate">{productLabel}</div>
                        <div className="mt-1 text-sm text-[hsl(var(--muted))]">{ex.description || '—'}</div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted))]">Amount</div>
                        <div className="text-lg font-semibold">{formatEGP(Number(ex.amount || 0))}</div>
                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                          {ex.date ? format(new Date(ex.date), 'yyyy-MM-dd') : '—'}
                        </div>

                        {canDelete && (
                          <div className="mt-2">
                            <Button variant="ghost" size="sm" onClick={() => deleteExpense(ex.id)}>
                              Delete
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}

              {filteredExpenses.length === 0 && (
                <div className="text-sm text-center text-[hsl(var(--muted))] py-6">
                  No expenses for the selected period/filter.
                </div>
              )}

              {/* Pagination controls */}
              {filteredExpenses.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <div className="text-sm text-[hsl(var(--muted))]">
                    Showing {(histPage - 1) * HISTORY_PAGE_SIZE + 1}–{Math.min(histPage * HISTORY_PAGE_SIZE, filteredExpenses.length)} of{' '}
                    <span className="font-medium">{filteredExpenses.length}</span>
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setHistPage(1)} disabled={histPage <= 1}>
                      First
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setHistPage((p) => Math.max(1, p - 1))} disabled={histPage <= 1}>
                      Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setHistPage((p) => Math.min(totalPages, p + 1))}
                      disabled={histPage >= totalPages}
                    >
                      Next
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setHistPage(totalPages)} disabled={histPage >= totalPages}>
                      Last
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mini report (respects filters) */}
      {!loading && (
        <Card>
          <CardContent>
            <h2 className="text-lg font-semibold mb-2">Total by Product</h2>
            <ul className="space-y-1">
              {totalsByCategorySorted.map(([key, amt]) => (
                <li key={key} className="flex justify-between text-sm">
                  <span>{labelByKey.get(key) || key}</span>
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
