type Props = { value: number; min?: number; max: number; onChange: (value: number) => void; label?: string };

export function QuantityControl({ value, min = 0, max, onChange, label = "Quantidade" }: Props) {
  const update = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  return (
    <div className="quantity" role="group" aria-label={label}>
      <button type="button" onClick={() => update(value - 1)} disabled={value <= min} aria-label="Diminuir">−</button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => update(value + 1)} disabled={value >= max} aria-label="Aumentar">+</button>
    </div>
  );
}
