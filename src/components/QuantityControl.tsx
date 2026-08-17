type Props = {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  label?: string;
  formatValue?: (value: number) => string;
};

export function QuantityControl({ value, min = 0, max = 999, step = 1, onChange, label = "Quantidade", formatValue }: Props) {
  const precision = Math.max(0, String(step).split(".")[1]?.length || 0);
  const update = (next: number) => {
    const rounded = Number(Math.max(min, Math.min(max, next)).toFixed(precision));
    onChange(rounded);
  };
  return (
    <div className="quantity" role="group" aria-label={label}>
      <button type="button" onClick={() => update(value - step)} disabled={value <= min} aria-label={`Diminuir ${label.toLowerCase()}`}>−</button>
      <output aria-live="polite">{formatValue ? formatValue(value) : value}</output>
      <button type="button" onClick={() => update(value + step)} disabled={value >= max} aria-label={`Aumentar ${label.toLowerCase()}`}>+</button>
    </div>
  );
}
