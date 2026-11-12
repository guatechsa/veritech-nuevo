import { Navigate, Route, Routes } from 'react-router-dom';
import { ProveedorUbicacion, UbicacionTaller } from './contexto';
import LayoutTaller from './Layout';
import { PaginaEntrarSoporte, PaginaIngresar, PaginaRecuperar, PaginaRestablecer } from './paginas/Acceso';
import Clientes from './paginas/Clientes';
import Configuracion from './paginas/Configuracion';
import Equipos from './paginas/Equipos';
import Inicio from './paginas/Inicio';
import MisTrabajos from './paginas/MisTrabajos';
import Ordenes from './paginas/Ordenes';
import { ProveedorSesionTaller } from './Sesion';

/**
 * Aplicación de un taller. Se monta en `/t/<taller>/*` (sitio de pruebas) o en la raíz de `<taller>.<dominio>`; las rutas
 * son relativas, así que son las mismas en los dos casos.
 */
export default function TallerApp({ ubicacion }: { ubicacion: UbicacionTaller }) {
  return (
    <ProveedorUbicacion value={ubicacion}>
      <ProveedorSesionTaller>
        <Routes>
          <Route path="ingresar" element={<PaginaIngresar />} />
          <Route path="recuperar" element={<PaginaRecuperar />} />
          <Route path="restablecer" element={<PaginaRestablecer />} />
          <Route path="entrar-soporte" element={<PaginaEntrarSoporte />} />
          <Route element={<LayoutTaller />}>
            <Route index element={<Inicio />} />
            <Route path="clientes" element={<Clientes />} />
            <Route path="equipos" element={<Equipos />} />
            <Route path="mis-trabajos" element={<MisTrabajos />} />
            <Route path="ordenes" element={<Ordenes />} />
            <Route path="configuracion" element={<Configuracion />} />
          </Route>
          <Route path="*" element={<Navigate to={ubicacion.base || '/'} replace />} />
        </Routes>
      </ProveedorSesionTaller>
    </ProveedorUbicacion>
  );
}
