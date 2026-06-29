ALTER TABLE public.specs ADD COLUMN IF NOT EXISTS monday_item_id TEXT;
CREATE INDEX IF NOT EXISTS specs_monday_item_id_idx ON public.specs(monday_item_id);