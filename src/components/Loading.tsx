export function Loading({ label = "Carregando" }: { label?: string }) {
  return <div className="loading" role="status"><i />{label}</div>;
}

export function Notice({ children, kind = "info" }: { children: React.ReactNode; kind?: "info" | "error" | "success" }) {
  return <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}
