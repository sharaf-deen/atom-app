'use client'

import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

type Cat = {
  key: string
  label: string
  group_name: string
  is_active: boolean
  sort_order: number
  created_at?: string
}

type Editing = Partial<Cat> & { key: string }

export default function ExpenseCategoriesClient() {
  const supabase = createSupabaseBrowserClient()

  const [items, setItems] = useState<Cat[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  // Form nouvel item
  const [form, setForm] = useState<Cat>({
    key: '',
    label: '',
    group_name: '',
    is_active: true,
    sort_order: 0,
  })

  // Édition inline
  const [editing, setEditing] = useState<Editing | null>(null)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('expense_categories')
      .select('key,label,group_name,is_active,sort_order,created_at')
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true })

    if (error) {
      console.error(error)
      setItems([])
    } else {
      setItems((data || []) as Cat[])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return items
    return items.filter(
      (c) =>
        c.key.toLowerCase().includes(t) ||
        (c.label || '').toLowerCase().includes(t) ||
        (c.group_name || '').toLowerCase().includes(t)
    )
  }, [items, q])

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.key || !/^[a-z0-9_]+$/.test(form.key)) {
      alert("Key obligatoire (minuscules, chiffres, underscore)")
      return
    }
    if (!form.label) {
      alert('Label obligatoire')
      return
    }
    if (!form.group_name) {
      alert('Group obligatoire')
      return
    }

    // UI optimiste
    const optimistic = [...items, form]
    setItems(optimistic)

    const { error } = await supabase.from('expense_categories').insert([form])
    if (error) {
      // rollback si échec
      setItems(items)
      alert(error.message)
      return
    }
    setForm({ key: '', label: '', group_name: '', is_active: true, sort_order: 0 })
    load()
  }

  function startEdit(c: Cat) {
    setEditing({ ...c })
  }

  function cancelEdit() {
    setEditing(null)
  }

  async function saveEdit() {
    if (!editing) return
    const { key, label, group_name, is_active, sort_order } = editing

    if (!label) return alert('Label obligatoire')
    if (!group_name) return alert('Group obligatoire')

    // UI optimiste
    const prev = items
    const updated = items.map((c) => (c.key === key ? { ...c, label: label!, group_name: group_name!, is_active: !!is_active, sort_order: Number(sort_order || 0) } : c))
    setItems(updated)

    const { error } = await supabase
      .from('expense_categories')
      .update({
        label,
        group_name,
        is_active: !!is_active,
        sort_order: Number(sort_order || 0),
      })
      .eq('key', key)

    if (error) {
      setItems(prev)
      alert(error.message)
      return
    }
    setEditing(null)
  }

  async function toggleActive(c: Cat) {
    const prev = items
    const updated = items.map((x) => (x.key === c.key ? { ...x, is_active: !x.is_active } : x))
    setItems(updated)

    const { error } = await supabase
      .from('expense_categories')
      .update({ is_active: !c.is_active })
      .eq('key', c.key)

    if (error) {
      setItems(prev)
      alert(error.message)
    }
  }

  async function remove(key: string) {
    if (!confirm('Delete this category?')) return
    const prev = items
    const updated = items.filter((c) => c.key !== key)
    setItems(updated)

    const { error } = await supabase.from('expense_categories').delete().eq('key', key)
    if (error) {
      setItems(prev)
      alert(error.message)
    }
  }

  return (
    <div className="space-y-6">
      {/* Barre outils */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <input
          type="search"
          placeholder="Search key/label/group…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border p-2 rounded w-full sm:w-80"
        />
        <button onClick={load} className="border px-3 py-2 rounded">
          Reload
        </button>
      </div>

      {/* Form d'ajout */}
      <form onSubmit={onCreate} className="border p-4 rounded-lg space-y-3">
        <h2 className="text-lg font-semibold">Add Category</h2>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          <input
            type="text"
            placeholder="key (ex: rent)"
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase() })}
            className="border p-2 rounded"
            required
          />
          <input
            type="text"
            placeholder="Label (ex: Rent)"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            className="border p-2 rounded"
            required
          />
          <input
            type="text"
            placeholder="Group (ex: Fixed & Admin)"
            value={form.group_name}
            onChange={(e) => setForm({ ...form, group_name: e.target.value })}
            className="border p-2 rounded"
            required
          />
          <input
            type="number"
            placeholder="Order"
            value={form.sort_order}
            onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
            className="border p-2 rounded"
          />
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="h-4 w-4"
            />
            Active
          </label>
        </div>
        <div className="flex justify-end">
          <button type="submit" className="bg-black text-white px-4 py-2 rounded">
            Add
          </button>
        </div>
      </form>

      {/* Tableau des catégories */}
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="border p-2 text-left">Key</th>
              <th className="border p-2 text-left">Label</th>
              <th className="border p-2 text-left">Group</th>
              <th className="border p-2 text-right">Order</th>
              <th className="border p-2 text-center">Active</th>
              <th className="border p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4" colSpan={6}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td className="p-4" colSpan={6}>No categories</td></tr>
            ) : (
              filtered.map((c) => {
                const isEditing = editing?.key === c.key
                return (
                  <tr key={c.key}>
                    <td className="border p-2 font-mono">{c.key}</td>

                    <td className="border p-2">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editing!.label || ''}
                          onChange={(e) => setEditing({ ...editing!, label: e.target.value })}
                          className="border p-2 rounded w-full"
                        />
                      ) : (
                        c.label
                      )}
                    </td>

                    <td className="border p-2">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editing!.group_name || ''}
                          onChange={(e) => setEditing({ ...editing!, group_name: e.target.value })}
                          className="border p-2 rounded w-full"
                        />
                      ) : (
                        c.group_name
                      )}
                    </td>

                    <td className="border p-2 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editing!.sort_order ?? 0}
                          onChange={(e) => setEditing({ ...editing!, sort_order: Number(e.target.value) })}
                          className="border p-2 rounded w-24 text-right"
                        />
                      ) : (
                        c.sort_order
                      )}
                    </td>

                    <td className="border p-2 text-center">
                      {isEditing ? (
                        <input
                          type="checkbox"
                          checked={!!editing!.is_active}
                          onChange={(e) => setEditing({ ...editing!, is_active: e.target.checked })}
                          className="h-4 w-4"
                        />
                      ) : (
                        <button
                          onClick={() => toggleActive(c)}
                          className={`px-2 py-1 text-xs rounded ${c.is_active ? 'bg-green-100' : 'bg-gray-200'}`}
                          title="Toggle active"
                        >
                          {c.is_active ? 'Active' : 'Inactive'}
                        </button>
                      )}
                    </td>

                    <td className="border p-2 text-right space-x-2">
                      {isEditing ? (
                        <>
                          <button onClick={saveEdit} className="px-3 py-1 rounded bg-black text-white">Save</button>
                          <button onClick={cancelEdit} className="px-3 py-1 rounded border">Cancel</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(c)} className="px-3 py-1 rounded border">Edit</button>
                          <button onClick={() => remove(c.key)} className="px-3 py-1 rounded border">Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
