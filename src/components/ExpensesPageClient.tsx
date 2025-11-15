'use client'

import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, format } from 'date-fns'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'

type Period = 'month' | 'week' | 'custom'

type Expense = {
  id: string
  date: string
  category_key: string | null   // FK to expense_categories.key
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
  return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(n)
}

export default function ExpensesPageClient({ userRole }: { userRole: string }) {
  const supabase = createSupabaseBrowserClient()

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingCats, setLoadingCats] = useState(true)

  // Filters
  const [period, setPeriod] = useState<Period>('month')
  const [from, setFrom] = useState<string>(() => toDateOnly(startOfMonth(new Date())))
  const [to, setTo] = useState<string>(() => toDateOnly(endOfMonth(new Date())))
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  // Add form
  const [newExpense, setNewExpense] = useState({
    date: '',
    category_key: '',
    description: '',
    amount: ''
  })

  // Only admins can add
  const canAdd = userRole === 'admin' || userRole === 'super_admin'

  // Load active categories
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

  // Adjust range automatically when period changes
  useEffect(() => {
    const today = new Date()
    if (period === 'month') {
      setFrom(toDateOnly(startOfMonth(today)))
      setTo(toDateOnly(endOfMonth(today)))
    } else if (period === 'week') {
      // Egypt-style week: Saturday to Friday
      setFrom(toDateOnly(startOfWeek(today, { weekStartsOn: 6 })))
      setTo(toDateOnly(endOfWeek(today, { weekStartsOn: 6 })))
    }
  }, [period])

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
    } else {
      setExpenses((data || []) as Expense[])
    }
    setLoading(false)
  }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault()
    const amt = parseFloat(newExpense.amount)
    if (Number.isNaN(amt)) {
      alert('Invalid amount')
      return
    }
    if (!newExpense.category_key) {
      alert('Please choose a category')
      return
    }

    const { error } = await supabase.from('expenses').insert([
      {
        date: newExpense.date || new Date().toISOString().slice(0, 10),
        category_key: newExpense.category_key, // store FK
        description: newExpense.description.trim() || null,
        amount: amt
      }
    ])

    if (error) {
      alert(error.message)
      return
    }

    setNewExpense({ date: '', category_key: '', description: '', amount: '' })
    await loadExpenses(from, to)
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

  // Map: key -> label
  const labelByKey = useMemo(() => {
    const m = new Map<string, string>()
    categories.forEach((c) => m.set(c.key, c.label))
    return m
  }, [categories])

  // Category filter (client-side)
  const filteredExpenses = useMemo(() => {
    if (categoryFilter === 'all') return expenses
    return expenses.filter((e) => (e.category_key || '') === categoryFilter)
  }, [expenses, categoryFilter])

  // Totals (respecte les filtres)
  const total = useMemo(
    () =>
      filteredExpenses.reduce(
        (sum, e) => sum + (typeof e.amount === 'number' ? e.amount : Number(e.amount || 0)),
        0
      ),
    [filteredExpenses]
  )

  /** ⬇️ Mini-report: agrégé **à partir de filteredExpenses** (période + catégorie) */
  const totalsByCategorySorted = useMemo(() => {
    // 1) agrège depuis les données filtrées
    const acc = new Map<string, number>()
    filteredExpenses.forEach((e) => {
      const key = e.category_key || 'other'
      const amount = typeof e.amount === 'number' ? e.amount : Number(e.amount || 0)
      acc.set(key, (acc.get(key) || 0) + amount)
    })

    // 2) convertit en tableau pour trier par sort_order des catégories
    const entries = Array.from(acc.entries())

    // helper pour l'ordre
    const indexOfKey = (k: string) => {
      const i = categories.findIndex((c) => c.key === k)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }

    entries.sort((a, b) => indexOfKey(a[0]) - indexOfKey(b[0]))
    return entries
  }, [filteredExpenses, categories])

  // Category options for filter
  const categoryOptions = useMemo(() => ['all', ...categories.map((c) => c.key)], [categories])

  return (
    <div className="space-y-6">

      {/* Add form (admins only) */}
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
                  label="Category"
                >
                  <option value="">Select a category…</option>
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
                placeholder="Description"
                value={newExpense.description}
                onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                label="Description"
              />

              <div className="flex justify-end">
                <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-4 py-2 rounded-md w-full transition-colors sm:w-auto">Add Expense</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Filters</h2>
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Select
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              label="Period"
            >
              <option value="month">Current Month</option>
              <option value="week">Current Week</option>
              <option value="custom">Custom Range</option>
            </Select>

            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              disabled={period !== 'custom'}
              label="From"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={period !== 'custom'}
              label="To"
            />

            <Select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              disabled={loadingCats}
              label="Category"
            >
              {categoryOptions.map((key) => (
                <option key={key} value={key}>
                  {key === 'all' ? 'All Categories' : labelByKey.get(key) || key}
                </option>
              ))}
            </Select>
          </div>

          <div className="mt-2 text-sm text-[hsl(var(--muted))]">
            Period: <span className="font-medium">{from}</span> →{' '}
            <span className="font-medium">{to}</span>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent>
          {loading ? (
            <p className="text-sm text-[hsl(var(--muted))]">Loading…</p>
          ) : (
              <table className="w-full text-sm">
                <thead className="bg-[hsl(var(--card))]">
                  <tr className="text-left border-b border-[hsl(var(--border))]">
                    <th className="p-2">Date</th>
                    <th className="p-2">Category</th>
                    <th className="p-2">Description</th>
                    <th className="p-2 text-right">Amount (EGP)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExpenses.map((ex) => {
                    const label = ex.category_key
                      ? labelByKey.get(ex.category_key) || ex.category_key
                      : '-'
                    return (
                      <tr key={ex.id} className="border-b border-[hsl(var(--border))]">
                        <td className="p-2">
                          {ex.date ? format(new Date(ex.date), 'yyyy-MM-dd') : '-'}
                        </td>
                        <td className="p-2">{label}</td>
                        <td className="p-2">{ex.description || '-'}</td>
                        <td className="p-2 text-right">
                          {typeof ex.amount === 'number' ? ex.amount.toFixed(2) : ex.amount}
                        </td>
                      </tr>
                    )
                  })}
                  {filteredExpenses.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-3 text-center text-[hsl(var(--muted))]">
                        No expenses for the selected period/filter.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-[hsl(var(--card))] font-semibold">
                    <td className="p-2" colSpan={3}>
                      Total ({categoryFilter === 'all' ? 'All Categories' : labelByKey.get(categoryFilter) || categoryFilter})
                    </td>
                    <td className="p-2 text-right">{total.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
          )}
        </CardContent>
      </Card>

      {/* Mini report: total by category — suit les filtres */}
      {!loading && (
        <Card>
          <CardContent>
            <h2 className="text-lg font-semibold mb-2">Total by Category</h2>
            <ul className="space-y-1">
              {totalsByCategorySorted.map(([key, amt]) => (
                <li key={key} className="flex justify-between text-sm">
                  <span>{labelByKey.get(key) || key}</span>
                  <span className="font-medium">{formatEGP(amt)}</span>
                </li>
              ))}
              {totalsByCategorySorted.length === 0 && (
                <li className="text-sm text-[hsl(var(--muted))]">No data.</li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}