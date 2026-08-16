import { useState, type InputHTMLAttributes } from "react";

export function PasswordField(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="password-field">
      <input {...props} type={visible ? "text" : "password"} />
      <button type="button" className="password-eye" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Ocultar senha" : "Mostrar senha"} aria-pressed={visible}>
        {visible ? "◉" : "◌"}
      </button>
    </span>
  );
}
