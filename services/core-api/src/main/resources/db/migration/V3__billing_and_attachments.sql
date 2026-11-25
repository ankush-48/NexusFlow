CREATE TABLE stripe_subscriptions (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id text UNIQUE,
  subscription_id text UNIQUE,
  last_event_at bigint NOT NULL DEFAULT 0,
  checkout_url text,
  checkout_expires timestamptz
);
CREATE TABLE stripe_events (
  id text PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE attachments (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  task_id uuid NOT NULL,
  uploader uuid NOT NULL,
  name varchar(160) NOT NULL,
  media_type varchar(100) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,task_id) REFERENCES tasks(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,uploader) REFERENCES memberships(org_id,user_id)
);
CREATE INDEX attachments_task_idx ON attachments(org_id,task_id,created_at DESC);
