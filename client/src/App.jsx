import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import BuildingsList from './pages/BuildingsList.jsx';
import BuildingDetail from './pages/BuildingDetail.jsx';
import FloorEditor from './pages/FloorEditor.jsx';
import Wayfind from './pages/Wayfind.jsx';

function RequireAdmin({ children }) {
  const { isAdmin } = useAuth();
  if (isAdmin === null) return <div className="page">Loading...</div>;
  if (!isAdmin) return <Navigate to="/admin/login" replace />;
  return children;
}

function Topbar() {
  const { isAdmin, logout } = useAuth();
  return (
    <header className="topbar">
      <strong>Indoor Wayfinding Admin</strong>
      <nav>
        <NavLink to="/admin/buildings" className={({ isActive }) => (isActive ? 'active' : '')}>
          Buildings
        </NavLink>
      </nav>
      {isAdmin && <button onClick={logout}>Log out</button>}
    </header>
  );
}

export default function App() {
  const location = useLocation();
  const isPublicWayfindRoute = location.pathname.startsWith('/wayfind');

  return (
    <>
      {!isPublicWayfindRoute && <Topbar />}
      <Routes>
        <Route path="/" element={<Navigate to="/admin/buildings" replace />} />
        <Route path="/wayfind/:buildingId" element={<Wayfind />} />
        <Route path="/admin/login" element={<Login />} />
        <Route
          path="/admin/buildings"
          element={
            <RequireAdmin>
              <BuildingsList />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/buildings/:buildingId"
          element={
            <RequireAdmin>
              <BuildingDetail />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/buildings/:buildingId/floors/:floorId"
          element={
            <RequireAdmin>
              <FloorEditor />
            </RequireAdmin>
          }
        />
      </Routes>
    </>
  );
}
