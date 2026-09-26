-- Virtual locations are structural: stock enters from Vendors, leaves to Customers,
-- and count corrections balance against Inventory Adjustment.
INSERT INTO locations (name, type) VALUES
  ('Vendors', 'vendor'),
  ('Customers', 'customer'),
  ('Inventory Adjustment', 'adjustment');
