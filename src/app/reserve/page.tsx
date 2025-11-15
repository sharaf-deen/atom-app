export const dynamic = 'force-dynamic'
export const revalidate = 0

import React from 'react'
import { reserveEquipment } from './actions'

export default async function ReserveEquipmentPage({
  searchParams,
}: {
  searchParams?: { ok?: string }
}) {
  const ok = searchParams?.ok === '1'

  return (
    <main className="space-y-4 p-6 max-w-xl">
      <h1 className="text-xl font-bold">Reserve Equipment (advance)</h1>

      {ok && (
        <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm">
          Reservation created!
        </div>
      )}

      <form action={reserveEquipment} className="space-y-3">
        <div className="space-y-1">
          <label htmlFor="item_name" className="block text-sm font-medium">
            Item name
          </label>
          <input
            id="item_name"
            name="item_name"
            defaultValue="Kimono"
            required
            className="border px-3 py-2 w-full rounded"
            placeholder="e.g. Kimono"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="advance" className="block text-sm font-medium">
            Advance (EGP)
          </label>
          <input
            id="advance"
            name="advance"
            type="number"
            min={0}
            step="1"
            defaultValue={500}
            className="border px-3 py-2 w-full rounded"
          />
        </div>

        <button
          type="submit"
          className="px-4 py-2 border rounded hover:bg-gray-50"
        >
          Confirm Reservation
        </button>
      </form>

      <p className="text-xs text-gray-500">
        You must be logged in to create a reservation.
      </p>
    </main>
  )
}
