CREATE TABLE IF NOT EXISTS public.providers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  key TEXT NOT NULL,
  website_url TEXT,
  provider_type TEXT,
  provider_vendor_id BIGINT,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMPTZ
);
