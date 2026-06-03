export default function KPICard({ titulo, valor, icono, color = 'blue', alerta = false }) {
  const colores = {
    blue:   'bg-blue-50 border-blue-200 text-blue-700',
    green:  'bg-green-50 border-green-200 text-green-700',
    red:    'bg-red-50 border-red-200 text-red-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  }

  return (
    <div className={`rounded-xl border p-5 ${colores[alerta ? 'red' : color]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-4xl">{icono}</span>
        {alerta && <span className="text-xs font-bold bg-red-500 text-white px-2 py-0.5 rounded-full">!</span>}
      </div>
      <p className="text-base font-medium opacity-70">{titulo}</p>
      <p className="text-3xl font-bold mt-1">{valor}</p>
    </div>
  )
}
