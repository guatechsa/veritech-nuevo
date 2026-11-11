import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import Badge from '../../components/ui-guatech/Badge.jsx';
import { fechaHoraLocal } from '../../utils/hora';
import { api, ErrorApi } from '../api';
import Tabla, { Columna } from '../componentes/Tabla';
import { PaginaAuditoria, RegistroAuditoria } from '../tipos';

// Verde si es un éxito, rojo si es un fallo o bloqueo, gris en los demás casos (estándar del panel §7).
function variante(accion: string): 'success' | 'danger' | 'default' {
  if (/(_ok|creado|activada|restablecida|iniciado)$/.test(accion) || accion.includes('success')) return 'success';
  if (/(fallido|bloqueado|suspendida)/.test(accion)) return 'danger';
  return 'default';
}

export default function Auditoria() {
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<PaginaAuditoria | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<PaginaAuditoria>(`/auditoria?pagina=${pagina}`).then(setDatos).catch((e: unknown) => setError(e instanceof ErrorApi ? e.message : 'No se pudo cargar'));
  }, [pagina]);

  const columnas: Array<Columna<RegistroAuditoria>> = [
    { clave: 'fecha', etiqueta: 'Fecha', valor: (r) => r.created_at, render: (r) => fechaHoraLocal(r.created_at) },
    { clave: 'usuario', etiqueta: 'Usuario', valor: (r) => r.usuario_nombre ?? '', render: (r) => (r.usuario_nombre ? <span><span className="block">{r.usuario_nombre}</span><span className="block text-xs text-gray-500">{r.usuario_correo}</span></span> : <span className="text-gray-500">—</span>) },
    { clave: 'accion', etiqueta: 'Acción', valor: (r) => r.accion, render: (r) => <Badge variant={variante(r.accion)}>{r.accion}</Badge> },
    { clave: 'descripcion', etiqueta: 'Descripción', valor: (r) => r.descripcion },
    { clave: 'ip', etiqueta: 'IP', valor: (r) => r.ip ?? '', render: (r) => r.ip ?? '—' },
  ];

  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <Tabla columnas={columnas} filas={datos?.registros ?? []} clave={(r) => r.id} vacio={datos ? 'Todavía no hay eventos.' : 'Cargando…'} />
      {datos && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{datos.total} eventos · página {pagina} de {paginas}</span>
          <span className="flex gap-2">
            <button aria-label="Página anterior" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-md border border-gray-300 p-1.5 disabled:opacity-40"><ChevronLeft size={16} /></button>
            <button aria-label="Página siguiente" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)} className="rounded-md border border-gray-300 p-1.5 disabled:opacity-40"><ChevronRight size={16} /></button>
          </span>
        </div>
      )}
    </div>
  );
}
