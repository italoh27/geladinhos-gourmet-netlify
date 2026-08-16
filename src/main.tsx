import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { CartProvider } from "./lib/cart";
import { StoreProvider } from "./lib/store";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <CartProvider><App /></CartProvider>
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
);
