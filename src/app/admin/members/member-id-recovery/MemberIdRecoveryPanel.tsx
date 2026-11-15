'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

type Evidence = {
  audit_logs?: number
  scan_audit?: number
  store_sales?: number
  coach_incidents?: number
  staff_attendance?: number
  family_recovery?: number
  deletion_events?: number
}
type Gap = {
  member_id:string
  classification:string
  evidence:Evidence
  approved_at:string|null
  last_scanned_at:string
}
type Archived = {user_id:string;member_id:string|null;first_name:string|null;last_name:string|null;archive_reason:string|null}
const reasons:Record<string,string>={
  historical_do_not_reissue:'Historical use detected — blocked',
  manual_review:'No evidence found — Super Admin review required',
  queued:'Approved — waiting for a genuine new registration',
  consumed:'Number already reissued',
  no_longer_missing:'Currently assigned'
}

export default function MemberIdRecoveryPanel({initialGaps,archived}:{
  initialGaps:Gap[];archived:Archived[]
}){
  const router=useRouter()
  const [checked,setChecked]=React.useState<string[]>([])
  const [reason,setReason]=React.useState('')
  const [attested,setAttested]=React.useState(false)
  const [releaseId,setReleaseId]=React.useState('')
  const [releaseReason,setReleaseReason]=React.useState('')
  const [busy,setBusy]=React.useState(false)
  const [message,setMessage]=React.useState('')
  const reviewable=initialGaps.filter(g=>g.classification==='manual_review')
  const historical=initialGaps.filter(g=>g.classification==='historical_do_not_reissue')
  const queued=initialGaps.filter(g=>g.classification==='queued')
  async function post(body:Record<string,unknown>){
    setBusy(true)
    setMessage('')
    try{
      const response=await fetch('/api/admin/members/member-id-recovery',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
      })
      const data=await response.json()
      if(!response.ok||!data.ok)throw new Error(data.error??'Operation blocked')
      setMessage(body.action==='scan'?'Audit refreshed successfully.':
        body.action==='approve'?'Approved IDs queued for one-time reissue.':
        'Archived mistaken profile released safely.')
      setChecked([]);setReason('');setAttested(false);setReleaseId('');setReleaseReason('')
      router.refresh()
    } catch(err){
      setMessage(err instanceof Error?err.message:'Review failed')
    }finally{setBusy(false)}
  }
  return <div className="space-y-6">
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border p-4"><p className="text-sm text-gray-500">Historical — blocked</p><p className="text-3xl font-bold">{historical.length}</p></div>
      <div className="rounded-2xl border p-4"><p className="text-sm text-gray-500">Needs manual review</p><p className="text-3xl font-bold">{reviewable.length}</p></div>
      <div className="rounded-2xl border p-4"><p className="text-sm text-gray-500">Queued for reissue</p><p className="text-3xl font-bold">{queued.length}</p></div>
    </div>
    <p className="text-sm text-gray-600">The audit runs daily and on page load. Detection never releases an ID or deletes a member automatically. An absent ID is not evidence of safety.</p>
    <button type="button" disabled={busy} onClick={()=>void post({action:'scan'})} className="rounded-xl border px-4 py-2 font-medium disabled:opacity-50">Refresh audit</button>
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50"><tr><th className="p-3">Member ID</th><th className="p-3">Status</th><th className="p-3">Historical evidence</th></tr></thead>
        <tbody>{initialGaps.filter(g=>g.classification!=='no_longer_missing').map(g=><tr key={g.member_id} className="border-t">
          <td className="p-3 font-semibold">{g.member_id}</td><td className="p-3">{reasons[g.classification]??g.classification}</td>
          <td className="p-3">{Object.entries(g.evidence??{}).filter(([,n])=>n>0).map(([key,n])=>key+': '+n).join(', ')||'No evidence in checked sources'}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <section className="space-y-3 rounded-2xl border p-5">
      <h2 className="text-lg font-semibold">Super Admin — approve reviewed gaps</h2>
      <p className="text-sm text-gray-600">Only IDs without discovered historical references may be selected. Before approval, independently confirm the number was never used on a printed QR code, invoice, membership card or external record. Once approved, the next eligible new member can receive it.</p>
      <div className="flex flex-wrap gap-3">{reviewable.map(g=><label key={g.member_id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
        <input type="checkbox" checked={checked.includes(g.member_id)} disabled={busy}
          onChange={e=>setChecked(old=>e.target.checked?[...old,g.member_id]:old.filter(x=>x!==g.member_id))}/>
        {g.member_id}
      </label>)}</div>
      <label className="block text-sm font-medium">Review decision and independent evidence
        <textarea rows={3} className="mt-1 w-full rounded-lg border p-3" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Document what external records were checked and why the selected numbers are safe to reuse."/>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={attested} onChange={e=>setAttested(e.target.checked)} />
        I confirm I reviewed the history, QR codes and external records for every selected number. I authorize one-time reassignment.
      </label>
      <button type="button" className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-40"
        disabled={busy||checked.length===0||reason.trim().length<35||!attested}
        onClick={()=>void post({action:'approve',codes:checked,reason,attested:true})}>
        Approve {checked.length} reviewed ID(s)
      </button>
    </section>
    <section className="space-y-3 rounded-2xl border p-5">
      <h2 className="text-lg font-semibold">Future errors — guarded archived profile release</h2>
      <p className="text-sm text-gray-600">Only an archived profile marked CREATED_IN_ERROR, with no login, family link, financial record or other reference, can be released. Any dependency blocks deletion and requires a separate review.</p>
      <select className="w-full rounded-lg border p-3" value={releaseId} onChange={e=>setReleaseId(e.target.value)}>
        <option value="">Select archived mistaken member</option>
        {archived.map(p=><option key={p.user_id} value={p.user_id}>{p.member_id} — {[p.first_name,p.last_name].filter(Boolean).join(' ')}</option>)}
      </select>
      <textarea className="w-full rounded-lg border p-3" rows={3} value={releaseReason}
        onChange={e=>setReleaseReason(e.target.value)} placeholder="Explain the erroneous registration and the verification performed (35+ characters)."/>
      <button type="button" className="rounded-xl border border-red-600 px-4 py-2 font-medium text-red-700 disabled:opacity-40"
        disabled={busy||!releaseId||releaseReason.trim().length<35}
        onClick={()=>{
          if(typeof window!=='undefined'&&window.confirm('Permanently delete this archived profile and queue its Member ID for one-time reissue?')){
            void post({action:'release',profileUserId:releaseId,reason:releaseReason,confirmed:true})
          }
        }}>Confirm deletion and release</button>
    </section>
    {message?<p className="rounded-lg border p-3 text-sm" role="status">{message}</p>:null}
  </div>
}
