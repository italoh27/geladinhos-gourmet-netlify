import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Loading } from "./components/Loading";
import { StorePage } from "./pages/StorePage";

const AdminLoginPage = lazy(() => import("./pages/AdminLoginPage").then((module) => ({ default: module.AdminLoginPage })));
const AdminPage = lazy(() => import("./pages/AdminPage").then((module) => ({ default: module.AdminPage })));
const CartPage = lazy(() => import("./pages/CartPage").then((module) => ({ default: module.CartPage })));
const CustomerAccessPage = lazy(() => import("./pages/CustomerAccessPage").then((module) => ({ default: module.CustomerAccessPage })));
const MyOrdersPage = lazy(() => import("./pages/MyOrdersPage").then((module) => ({ default: module.MyOrdersPage })));
const OrderPage = lazy(() => import("./pages/OrderPage").then((module) => ({ default: module.OrderPage })));

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<Loading label="Abrindo página" />}>
        <Routes>
          <Route path="/" element={<StorePage />} />
          <Route path="/carrinho" element={<CartPage />} />
          <Route path="/cliente" element={<CustomerAccessPage />} />
          <Route path="/meus-pedidos" element={<MyOrdersPage />} />
          <Route path="/pedido/:id" element={<OrderPage />} />
          <Route path="/pedido/:id/retorno" element={<OrderPage />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
