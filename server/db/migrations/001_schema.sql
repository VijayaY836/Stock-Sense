-- StockSense schema
-- Core idea: every stock change is a MOVE of a quantity from one location to another.
--   Receipt    = Vendors            -> WH/Stock
--   Delivery   = WH/Stock           -> Customers
--   Transfer   = WH/Rack A          -> WH/Rack B
--   Adjustment = WH/Stock          <-> Inventory Adjustment (virtual)
-- stock_moves is the immutable ledger (source of truth).
-- stock_quants caches on-hand quantity per product per INTERNAL location,
-- and is only ever written inside the same transaction as the move.

CREATE TYPE user_role        AS ENUM ('manager', 'staff');
CREATE TYPE location_type    AS ENUM ('internal', 'vendor', 'customer', 'adjustment');
CREATE TYPE operation_type   AS ENUM ('receipt', 'delivery', 'internal', 'adjustment');
CREATE TYPE operation_status AS ENUM ('draft', 'waiting', 'ready', 'done', 'canceled');

-- ---------------------------------------------------------------- users & auth
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(80)  NOT NULL CHECK (length(trim(name)) >= 2),
  email         VARCHAR(160) NOT NULL,
  password_hash TEXT         NOT NULL,
  role          user_role    NOT NULL DEFAULT 'staff',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE password_resets (
  id         SERIAL PRIMARY KEY,
  user_id    INT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash   TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INT         NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id, created_at DESC);

-- ---------------------------------------------------------------- warehouses & locations
CREATE TABLE warehouses (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(80) NOT NULL,
  code       VARCHAR(8)  NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2,8}$'),
  address    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(80)   NOT NULL,
  type         location_type NOT NULL,
  warehouse_id INT REFERENCES warehouses(id) ON DELETE RESTRICT,
  is_default   BOOLEAN       NOT NULL DEFAULT false,   -- the warehouse's main "Stock" location
  active       BOOLEAN       NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- internal locations always belong to a warehouse; virtual ones never do
  CONSTRAINT internal_needs_warehouse CHECK (
    (type = 'internal' AND warehouse_id IS NOT NULL) OR (type <> 'internal' AND warehouse_id IS NULL)
  )
);
CREATE UNIQUE INDEX locations_name_per_wh_uq ON locations (COALESCE(warehouse_id, 0), lower(name));
-- exactly one default stock location per warehouse
CREATE UNIQUE INDEX locations_one_default_uq ON locations (warehouse_id) WHERE is_default;
-- exactly one location of each virtual type
CREATE UNIQUE INDEX locations_one_virtual_uq ON locations (type) WHERE type <> 'internal';

-- ---------------------------------------------------------------- products
CREATE TABLE categories (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(60) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_name_uq ON categories (lower(name));

CREATE TABLE products (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL CHECK (length(trim(name)) >= 2),
  sku         VARCHAR(40)  NOT NULL CHECK (sku ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  uom         VARCHAR(12)  NOT NULL DEFAULT 'Units',
  unit_cost   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  active      BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX products_sku_uq ON products (upper(sku));
CREATE INDEX products_name_idx ON products (lower(name));

CREATE TABLE reorder_rules (
  id           SERIAL PRIMARY KEY,
  product_id   INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id INT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  min_qty      NUMERIC(14,3) NOT NULL CHECK (min_qty >= 0),
  max_qty      NUMERIC(14,3) NOT NULL,
  CONSTRAINT reorder_max_gte_min CHECK (max_qty >= min_qty),
  CONSTRAINT reorder_one_per_product_wh UNIQUE (product_id, warehouse_id)
);

-- ---------------------------------------------------------------- stock
CREATE TABLE stock_quants (
  product_id  INT NOT NULL REFERENCES products(id)  ON DELETE RESTRICT,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  quantity    NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),  -- stock can never go negative
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, location_id)
);
CREATE INDEX stock_quants_location_idx ON stock_quants (location_id);

-- per-warehouse, per-type reference counters: WH/IN/0001, WH/OUT/0001 ...
CREATE TABLE operation_sequences (
  warehouse_id INT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  type         operation_type NOT NULL,
  last_value   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (warehouse_id, type)
);

CREATE TABLE operations (
  id                 SERIAL PRIMARY KEY,
  reference          VARCHAR(32) NOT NULL UNIQUE,
  type               operation_type   NOT NULL,
  status             operation_status NOT NULL DEFAULT 'draft',
  warehouse_id       INT NOT NULL REFERENCES warehouses(id),
  source_location_id INT NOT NULL REFERENCES locations(id),
  dest_location_id   INT NOT NULL REFERENCES locations(id),
  partner            VARCHAR(120),          -- supplier for receipts, customer for deliveries
  scheduled_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  notes              TEXT,
  return_of_id       INT REFERENCES operations(id),
  created_by         INT REFERENCES users(id),
  validated_by       INT REFERENCES users(id),
  validated_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT op_distinct_locations CHECK (type = 'adjustment' OR source_location_id <> dest_location_id),
  CONSTRAINT op_done_has_validation CHECK ((status = 'done') = (validated_at IS NOT NULL))
);
CREATE INDEX operations_type_status_idx ON operations (type, status);
CREATE INDEX operations_wh_idx ON operations (warehouse_id);

CREATE TABLE operation_lines (
  id           SERIAL PRIMARY KEY,
  operation_id INT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  product_id   INT NOT NULL REFERENCES products(id),
  -- receipts/deliveries/transfers: quantity to move (> 0)
  -- adjustments: the physically COUNTED quantity (>= 0)
  quantity     NUMERIC(14,3) NOT NULL CHECK (quantity >= 0),
  -- adjustments only: system quantity captured at validation time, for audit
  system_qty   NUMERIC(14,3),
  CONSTRAINT line_one_product_per_op UNIQUE (operation_id, product_id)
);

-- the ledger
CREATE TABLE stock_moves (
  id               BIGSERIAL PRIMARY KEY,
  operation_id     INT NOT NULL REFERENCES operations(id),
  product_id       INT NOT NULL REFERENCES products(id),
  from_location_id INT NOT NULL REFERENCES locations(id),
  to_location_id   INT NOT NULL REFERENCES locations(id),
  quantity         NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  created_by       INT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT move_distinct_locations CHECK (from_location_id <> to_location_id)
);
CREATE INDEX stock_moves_product_idx ON stock_moves (product_id, created_at, id);
CREATE INDEX stock_moves_op_idx ON stock_moves (operation_id);

-- The ledger is append-only. Corrections are made with new moves (returns / adjustments), never edits.
CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_moves is append-only; create a return or adjustment instead'
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_moves_immutable
  BEFORE UPDATE OR DELETE ON stock_moves
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
