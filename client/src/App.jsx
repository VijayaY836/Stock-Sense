import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import { Login, Signup, ForgotPassword } from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { ProductsList, ProductDetail } from './pages/Products.jsx';
import OperationsList from './pages/OperationsList.jsx';
import Operation from './pages/Operation.jsx';
import Moves from './pages/Moves.jsx';
import { Reordering, Warehouses, Categories, Profile } from './pages/Settings.jsx';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Signing you in" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

/** /operations/receipts shows a list; /operations/42 shows one operation */
function OperationsRoute() {
  const { kind } = useParams();
  return /^\d+$/.test(kind) ? <Operation key={kind} /> : <OperationsList />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/products" element={<ProductsList />} />
        <Route path="/products/:id" element={<ProductDetail />} />
        <Route path="/reordering" element={<Reordering />} />
        <Route path="/operations/new/:type" element={<Operation />} />
        <Route path="/operations/:kind" element={<OperationsRoute />} />
        <Route path="/moves" element={<Moves />} />
        <Route path="/settings/warehouses" element={<Warehouses />} />
        <Route path="/settings/categories" element={<Categories />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
