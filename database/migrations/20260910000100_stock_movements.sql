-- Registra somente entradas de estoque para o indicador diário do painel.
CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGSERIAL PRIMARY KEY,
  flavor_id BIGINT REFERENCES flavors(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stock_movements_created_at_idx ON stock_movements (created_at DESC);
