'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

type Role = 'admin'|'coach'|'assistant_coach'|'member'|null;
type Member = { user_id:string; email:string; first_name:string|null; last_name:string|null; phone:string|null; role:Role };

export default function MembersPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [q, setQ] = useState('');
  const [role, setRole] = useState<string>('');
  const [rows, setRows] = useState<Member[]>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const u = data.session?.user;
      if (!u?.id) return;
      const { data: prof } = await supabase.from('profiles').select('role').eq('user_id', u.id).maybeSingle();
      setIsAdmin(prof?.role === 'admin');
    })();
  }, []);

  const fetchMembers = async () => {
    setMsg('Loading...');
    const res = await fetch('/api/admin/members', {
      method: 'POST', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ q, role: role || undefined, limit: 100 })
    });
    const json = await res.json();
    if (!json.ok) return setMsg('❌ ' + json.error);
    setRows(json.members); setMsg('');
  };

  useEffect(() => { if (isAdmin) fetchMembers(); }, [isAdmin]);

  if (!isAdmin) return <main className="p-6"><h1 className="text-xl font-bold">Members</h1><p>Access denied.</p></main>;

  return (
    <main className="p-6 space-y-3">
      <h1 className="text-2xl font-bold">Members</h1>
      <div className="flex gap-2 flex-wrap">
        <input className="border px-3 py-2" placeholder="Search name, email, phone" value={q} onChange={e=>setQ(e.target.value)} />
        <select className="border px-3 py-2" value={role} onChange={e=>setRole(e.target.value)}>
          <option value="">All roles</option>
          <option value="member">Member</option>
          <option value="assistant_coach">Assistant Coach</option>
          <option value="coach">Coach</option>
          <option value="admin">Admin</option>
        </select>
        <button onClick={fetchMembers} className="border px-4 py-2 rounded">Search</button>
        <Link href="/admin" className="underline ml-auto">← Admin</Link>
      </div>
      {msg && <p>{msg}</p>}

      <div className="overflow-auto">
        <table className="min-w-full text-sm border">
          <thead className="bg-gray-50">
            <tr>
              <th className="border px-2 py-1 text-left">Name</th>
              <th className="border px-2 py-1 text-left">Email</th>
              <th className="border px-2 py-1 text-left">Phone</th>
              <th className="border px-2 py-1">Role</th>
              <th className="border px-2 py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.user_id}>
                <td className="border px-2 py-1">{m.first_name ?? ''} {m.last_name ?? ''}</td>
                <td className="border px-2 py-1">{m.email}</td>
                <td className="border px-2 py-1">{m.phone ?? ''}</td>
                <td className="border px-2 py-1 text-center">{m.role ?? 'member'}</td>
                <td className="border px-2 py-1 text-center">
                  <Link href="/admin" className="underline">Open in Admin</Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="px-2 py-4 text-center text-gray-500" colSpan={5}>No members found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
