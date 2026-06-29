ALTER TABLE public.specs
  ADD COLUMN IF NOT EXISTS system text,
  ADD COLUMN IF NOT EXISTS module text,
  ADD COLUMN IF NOT EXISTS tester text,
  ADD COLUMN IF NOT EXISTS implementer text;