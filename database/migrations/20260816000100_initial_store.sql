-- Banco PostgreSQL independente usado pela cópia da loja no Netlify.
CREATE TABLE store_config (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  store_name TEXT NOT NULL DEFAULT 'Geladinhos Gourmet',
  store_open BOOLEAN NOT NULL DEFAULT TRUE,
  require_registration BOOLEAN NOT NULL DEFAULT FALSE,
  require_address BOOLEAN NOT NULL DEFAULT TRUE,
  infinitepay_active BOOLEAN NOT NULL DEFAULT TRUE,
  payment_before_order BOOLEAN NOT NULL DEFAULT FALSE,
  manual_pix_active BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_support_active BOOLEAN NOT NULL DEFAULT TRUE,
  loyalty_active BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  free_delivery BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  whatsapp_number TEXT NOT NULL DEFAULT '',
  closed_message TEXT NOT NULL DEFAULT 'Estamos fechados agora. Você pode conhecer os sabores e voltar quando a loja abrir.',
  pix_key TEXT NOT NULL DEFAULT '',
  pix_name TEXT NOT NULL DEFAULT '',
  pix_bank TEXT NOT NULL DEFAULT 'InfinitePay',
  admin_password_hash TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO store_config (id) VALUES (1);

CREATE TABLE flavors (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  image_url TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE customers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX customers_email_lower_unique ON customers (LOWER(email));

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE CASCADE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((customer_id IS NOT NULL) OR is_admin)
);

CREATE TABLE password_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  public_token TEXT NOT NULL UNIQUE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  number TEXT NOT NULL DEFAULT '',
  neighborhood TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  complement TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_preparacao','saiu_entrega','entregue','cancelado')),
  payment_status TEXT NOT NULL DEFAULT 'aguardando_pagamento' CHECK (payment_status IN ('aguardando_pagamento','pago','cancelado','expirado')),
  payment_method TEXT NOT NULL DEFAULT '',
  payment_link TEXT NOT NULL DEFAULT '',
  payment_id TEXT NOT NULL DEFAULT '',
  transaction_nsu TEXT NOT NULL DEFAULT '',
  payment_slug TEXT NOT NULL DEFAULT '',
  subtotal NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0),
  delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  total NUMERIC(10,2) NOT NULL CHECK (total >= 0),
  visible_to_admin BOOLEAN NOT NULL DEFAULT TRUE,
  stock_returned BOOLEAN NOT NULL DEFAULT FALSE,
  loyalty_counted BOOLEAN NOT NULL DEFAULT FALSE,
  reservation_expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  flavor_id BIGINT REFERENCES flavors(id) ON DELETE SET NULL,
  flavor_name TEXT NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total NUMERIC(10,2) NOT NULL CHECK (line_total >= 0)
);

CREATE TABLE payment_logs (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE,
  payment_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  raw_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE loyalty_balances (
  customer_id BIGINT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  progress_5 INTEGER NOT NULL DEFAULT 0 CHECK (progress_5 BETWEEN 0 AND 9),
  progress_7 INTEGER NOT NULL DEFAULT 0 CHECK (progress_7 BETWEEN 0 AND 9),
  rewards_5 INTEGER NOT NULL DEFAULT 0 CHECK (rewards_5 >= 0),
  rewards_7 INTEGER NOT NULL DEFAULT 0 CHECK (rewards_7 >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE loyalty_movements (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  tier INTEGER NOT NULL CHECK (tier IN (5,7)),
  quantity INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('purchase','adjustment','reversal','reward_delivered')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE loyalty_notifications (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tier INTEGER NOT NULL CHECK (tier IN (5,7)),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  delivered BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX auth_sessions_token_hash_idx ON auth_sessions (token_hash);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions (expires_at);
CREATE INDEX password_reset_active_idx ON password_reset_tokens (customer_id, expires_at DESC) WHERE used_at IS NULL;
CREATE INDEX orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX orders_status_created_at_idx ON orders (status, created_at DESC);
CREATE INDEX orders_payment_created_at_idx ON orders (payment_status, created_at DESC);
CREATE INDEX orders_customer_id_idx ON orders (customer_id, created_at DESC);
CREATE INDEX orders_reservation_idx ON orders (reservation_expires_at) WHERE payment_status = 'aguardando_pagamento' AND stock_returned = FALSE;
CREATE INDEX order_items_order_id_idx ON order_items (order_id);
CREATE INDEX payment_logs_order_id_idx ON payment_logs (order_id, created_at DESC);
CREATE UNIQUE INDEX orders_transaction_nsu_unique ON orders (transaction_nsu) WHERE transaction_nsu <> '';
CREATE INDEX loyalty_notifications_pending_idx ON loyalty_notifications (delivered, created_at DESC);

INSERT INTO flavors (name, price, stock, image_url) VALUES
  ('Ninho com Nutella', 7.00, 0, '/sabores/card_ninho_com_nutela_gourmet.webp'),
  ('Ninho com Morango', 7.00, 0, '/sabores/card_ninho_com_morango_gourmet.webp'),
  ('Romeu e Julieta', 5.00, 0, '/sabores/card_romeu_julieta_gourmet.webp'),
  ('Maracujá Trufado', 5.00, 0, '/sabores/card_maracuja_trufado_gourmet_v2.webp'),
  ('Paçoca', 5.00, 0, '/sabores/card_pacoca_gourmet.webp'),
  ('Pudim', 5.00, 0, '/sabores/card_pudim_gourmet.webp'),
  ('Cocada', 5.00, 0, '/sabores/card_cocada_gourmet.webp'),
  ('Delícia de Abacaxi', 5.00, 0, '/sabores/card_delicia_de_abacaxi_gourmet.webp'),
  ('Prestígio', 5.00, 0, '/sabores/card_prestigio_gourmet.webp'),
  ('Ninho', 5.00, 0, '/sabores/card_ninho_gourmet.webp'),
  ('Maracujá', 5.00, 0, '/sabores/card_maracuja_gourmet_v2.webp'),
  ('Morango com Chocolate', 5.00, 0, '/sabores/card_morango_com_chocolate_gourmet.webp');
