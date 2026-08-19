import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Notice } from "../components/Loading";
import { PasswordField } from "../components/PasswordField";
import { api, post } from "../lib/api";

export function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    api<{ admin: boolean }>("/auth/me").then((result) => {
      if (result.admin) navigate("/admin", { replace: true });
    }).catch(() => {});
  }, [navigate]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setLoading(true);
    try { await post("/auth/admin-login", { password }); navigate("/admin"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível entrar."); }
    finally { setLoading(false); }
  }
  return (
    <section className="auth-page glass-card admin-login">
      <div className="auth-heading"><span>Painel protegido</span><h1>Login do Admin</h1><p>Gerencie pedidos, sabores, estoque e configurações.</p></div>
      {error && <Notice kind="error">{error}</Notice>}
      <form className="auth-form" onSubmit={submit}><label>Senha administrativa<PasswordField value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required autoFocus /></label><button className="primary-button" disabled={loading}>{loading ? "Entrando…" : "Entrar no painel"}</button></form>
      <Link className="ghost-button" to="/">← Voltar para loja</Link>
    </section>
  );
}
