import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { AdminPage } from "./pages/AdminPage";
import { CartPage } from "./pages/CartPage";
import { CustomerAccessPage } from "./pages/CustomerAccessPage";
import { MyOrdersPage } from "./pages/MyOrdersPage";
import { OrderPage } from "./pages/OrderPage";
import { StorePage } from "./pages/StorePage";

export default function App() {
  return (
    <AppShell>
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
    </AppShell>
  );
}
