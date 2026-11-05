import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Notice } from "../components/Loading";
import { PasswordField } from "../components/PasswordField";
import { api, post } from "../lib/api";

export function AdminLoginPage() {
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [resetStep, setResetStep] = useState<"request" | "confirm">("request");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
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
    event.preventDefault(); setError(""); setMessage(""); setLoading(true);
    try {
      if (mode === "reset") {
        if (resetStep === "request") {
          const result = await post<{ message: string }>("/auth/admin-password-reset/request", { email });
          setMessage(result.message); setResetStep("confirm"); return;
        }
        if (password !== confirmPassword) throw new Error("A confirmação da senha não confere.");
        const result = await post<{ message: string }>("/auth/admin-password-reset/confirm", { email, code, password });
        setMessage(result.message); setMode("login"); setResetStep("request"); setPassword(""); setConfirmPassword(""); setCode(""); return;
      }
      await post("/auth/admin-login", { password }); navigate("/admin");
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível entrar."); }
    finally { setLoading(false); }
  }
  return (
    <section className="auth-page glass-card admin-login">
      <div className="auth-heading"><span>Painel protegido</span><h1>{mode === "login" ? "Login do Admin" : "Recuperar senha do Admin"}</h1><p>{mode === "login" ? "Gerencie pedidos, sabores, estoque e configurações." : "Receba um código no e-mail administrativo."}</p></div>
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <form className="auth-form" onSubmit={submit}>{mode === "reset" && <label>E-mail administrativo<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required autoFocus /></label>}{mode === "reset" && resetStep === "confirm" && <label>Código de 6 números<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required /></label>}{(mode === "login" || resetStep === "confirm") && <label>{mode === "login" ? "Senha administrativa" : "Nova senha"}<PasswordField value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={6} required autoFocus={mode === "login"} /></label>}{mode === "reset" && resetStep === "confirm" && <label>Confirme a nova senha<PasswordField value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={6} required /></label>}<button className="primary-button" disabled={loading}>{loading ? "Aguarde…" : mode === "login" ? "Entrar no painel" : resetStep === "request" ? "Enviar código" : "Alterar senha"}</button></form>
      <div className="auth-links">{mode === "login" ? <button type="button" className="text-button" onClick={() => { setMode("reset"); setResetStep("request"); setError(""); setMessage(""); setPassword(""); }}>Esqueci minha senha</button> : <button type="button" className="text-button" onClick={() => { setMode("login"); setResetStep("request"); setError(""); setMessage(""); }}>← Voltar ao login</button>}<Link to="/">← Voltar para loja</Link></div>
    </section>
  );
}
