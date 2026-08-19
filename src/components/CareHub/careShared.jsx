export function chinaDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export function formatDateOnly(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return date || ''
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`
}

export function Panel({ children }) {
  return <div className="rounded-3xl p-4" style={{ background: 'rgba(255,255,255,.72)', border: '1px solid rgba(150,180,220,.2)', boxShadow: '0 8px 30px rgba(70,100,150,.06)' }}>{children}</div>
}
