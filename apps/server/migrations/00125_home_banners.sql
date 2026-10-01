-- +goose Up
CREATE TABLE home_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text NOT NULL DEFAULT '',
  image_url text NOT NULL,
  link_url text NOT NULL DEFAULT '',
  button_text text NOT NULL DEFAULT '',
  new_tab boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 5000 CHECK (duration_ms BETWEEN 3000 AND 20000),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX home_banners_display_idx ON home_banners (sort_order, created_at DESC) WHERE active;

-- +goose Down
DROP TABLE home_banners;
