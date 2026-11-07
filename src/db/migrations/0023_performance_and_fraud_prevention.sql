-- Performance and Fraud Prevention Indexes
CREATE INDEX IF NOT EXISTS idx_product_details_barcode_sku 
ON product_details (barcode, sku_id) 
WHERE is_sellable = true;

CREATE INDEX IF NOT EXISTS idx_transactions_branch_type_date 
ON transactions (branch_id, type, date DESC);

CREATE INDEX IF NOT EXISTS idx_stocks_prod_warehouse 
ON stocks (product_id, warehouse_id);

CREATE INDEX IF NOT EXISTS idx_transactions_pos_session 
ON transactions (pos_session_id) 
WHERE pos_session_id IS NOT NULL;

