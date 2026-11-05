import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Notice } from "../components/Loading";
import { PasswordField } from "../components/PasswordField";
import { api, post } from "../lib/api";

export function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();
  useEffect(() => {
    api<{ admin: boolean }>("/auth/me").then((result) => {
      if (result.admin) {
        navigate("/admin", { replace: true });
        return;
      }
      setChecking(false);
    }).catch(() => setChecking(false));
  }, [navigate]);
  if (checking) return <section className="auth-page glass-card"><div className="auth-heading"><span>Painel protegido</span><h1>Entrando no admin</h1><p>Verificando sua sessão salva.</p></div></section>;
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setLoading(true);
    try { await post("/auth/admin-login", { email, password }); navigate("/admin"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível entrar."); }
    finally { setLoading(false); }
  }
  return (
    <section className="auth-page glass-card admin-login">
      <div className="auth-heading"><span>Painel protegido</span><h1>Login do Admin</h1><p>Gerencie pedidos, sabores, estoque e configurações.</p></div>
      {error && <Notice kind="error">{error}</Notice>}
      <form className="auth-form" onSubmit={submit}><label>E-mail administrativo<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required autoFocus /></label><label>Senha administrativa<PasswordField value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label><button className="primary-button" disabled={loading}>{loading ? "Entrando…" : "Entrar no painel"}</button></form>
      <Link className="ghost-button" to="/">← Voltar para loja</Link>
    </section>
  );
}
