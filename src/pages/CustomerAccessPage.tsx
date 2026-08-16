import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Notice } from "../components/Loading";
import { PasswordField } from "../components/PasswordField";
import { post } from "../lib/api";
import { useStore } from "../lib/store";
import type { Customer } from "../lib/types";

export function CustomerAccessPage() {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [resetStep, setResetStep] = useState<"request" | "confirm">("request");
  const [values, setValues] = useState({ name: "", phone: "", email: "", password: "", confirmPassword: "", code: "" });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const { setCustomer, customer } = useStore();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const destination = search.get("voltar") || "/meus-pedidos";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      if (mode === "reset") {
        if (resetStep === "request") {
          const result = await post<{ message: string }>("/auth/password-reset/request", { phone: values.phone, email: values.email });
          setMessage(result.message);
          setResetStep("confirm");
          return;
        }
        if (values.password !== values.confirmPassword) throw new Error("A confirmação da senha não confere.");
        const result = await post<{ message: string }>("/auth/password-reset/confirm", { phone: values.phone, email: values.email, code: values.code, password: values.password });
        setMessage(result.message);
        setMode("login");
        setResetStep("request");
        setValues((current) => ({ ...current, password: "", confirmPassword: "", code: "" }));
        return;
      }
      const result = await post<{ customer: Customer }>(mode === "login" ? "/auth/login" : "/auth/register", values);
      setCustomer(result.customer);
      navigate(destination);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  if (customer) return (
    <section className="auth-page glass-card empty-state"><span>✓</span><h1>Olá, {customer.name}</h1><p>Sua conta já está conectada.</p><Link className="primary-button" to="/meus-pedidos">Ver meus pedidos</Link></section>
  );

  return (
    <section className="auth-page glass-card">
      <div className="auth-heading"><span>Área do cliente</span><h1>{mode === "login" ? "Entre na sua conta" : mode === "register" ? "Crie sua conta" : "Recupere sua senha"}</h1><p>{mode === "reset" ? "Receba um código automático no e-mail cadastrado." : "Acompanhe pedidos e sua campanha de fidelidade."}</p></div>
      {mode !== "reset" && <div className="segmented-control" role="tablist">
        <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>Entrar</button>
        <button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); }}>Cadastrar</button>
      </div>}
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <form className="auth-form" onSubmit={submit}>
        {mode === "register" && <label>Nome<input value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} autoComplete="name" required autoFocus /></label>}
        <label>Telefone<input value={values.phone} onChange={(event) => setValues({ ...values, phone: event.target.value })} inputMode="tel" autoComplete="tel" required autoFocus={mode === "login"} /></label>
        {(mode === "register" || mode === "reset") && <label>E-mail<input value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} type="email" autoComplete="email" required /></label>}
        {mode === "reset" && resetStep === "confirm" && <label>Código de 6 números<input value={values.code} onChange={(event) => setValues({ ...values, code: event.target.value.replace(/\D/g, "").slice(0, 6) })} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required /></label>}
        {(mode !== "reset" || resetStep === "confirm") && <label>{mode === "reset" ? "Nova senha" : "Senha"}<PasswordField value={values.password} onChange={(event) => setValues({ ...values, password: event.target.value })} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={6} required /></label>}
        {mode === "reset" && resetStep === "confirm" && <label>Confirme a nova senha<PasswordField value={values.confirmPassword} onChange={(event) => setValues({ ...values, confirmPassword: event.target.value })} autoComplete="new-password" minLength={6} required /></label>}
        <button className="primary-button" disabled={loading}>{loading ? "Aguarde…" : mode === "login" ? "Entrar" : mode === "register" ? "Criar conta" : resetStep === "request" ? "Enviar código" : "Alterar senha"}</button>
      </form>
      <div className="auth-links">{mode === "reset" ? <button type="button" className="text-button" onClick={() => { setMode("login"); setResetStep("request"); setError(""); }}>← Voltar ao login</button> : <button type="button" className="text-button" onClick={() => { setMode("reset"); setResetStep("request"); setError(""); setMessage(""); }}>Esqueci minha senha</button>}<Link to="/">← Voltar para loja</Link></div>
    </section>
  );
}
