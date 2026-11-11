import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './Layout';
import { PaginaIngresar, PaginaRecuperar, PaginaRestablecer } from './paginas/Acceso';
import Auditoria from './paginas/Auditoria';
import Dashboard from './paginas/Dashboard';
import Empresas from './paginas/Empresas';
import Usuarios from './paginas/Usuarios';
import { ProveedorSesion } from './Sesion';

/** Panel de administración de la plataforma (estándar de superadmin): 4 secciones fijas. Vive bajo /admin. */
export default function Panel() {
  return (
    <ProveedorSesion>
      <Routes>
        <Route path="ingresar" element={<PaginaIngresar />} />
        <Route path="recuperar" element={<PaginaRecuperar />} />
        <Route path="restablecer" element={<PaginaRestablecer />} />
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="empresas" element={<Empresas />} />
          <Route path="usuarios" element={<Usuarios />} />
          <Route path="auditoria" element={<Auditoria />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </ProveedorSesion>
  );
}
