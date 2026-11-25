CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(254) NOT NULL UNIQUE CHECK (email = lower(email)),
  name varchar(100) NOT NULL,
  password_hash text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  platform_admin boolean NOT NULL DEFAULT false,
  suspended boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  plan text NOT NULL DEFAULT 'Free' CHECK (plan IN ('Free','Professional','Enterprise')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('Owner','Admin','Project Manager','Member','Viewer')),
  PRIMARY KEY (org_id,user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id,org_id);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_hash text NOT NULL UNIQUE,
  refresh_hash text NOT NULL UNIQUE,
  access_expires timestamptz NOT NULL,
  refresh_expires timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry_idx ON sessions(refresh_expires);
CREATE TABLE auth_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify','reset')),
  expires_at timestamptz NOT NULL
);
CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email varchar(254) NOT NULL,
  role text NOT NULL CHECK (role IN ('Admin','Project Manager','Member','Viewer')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  UNIQUE (org_id,email)
);
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title varchar(120) NOT NULL,
  description varchar(2000) NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('Planned','In progress','Completed')),
  priority text NOT NULL CHECK (priority IN ('Low','Medium','High','Urgent')),
  team varchar(80) NOT NULL,
  start_date date,
  due_date date,
  owner uuid,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id,id),
  FOREIGN KEY (org_id, owner) REFERENCES memberships(org_id,user_id),
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date)
);
CREATE INDEX projects_org_status_idx ON projects(org_id,archived,status);
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  title varchar(120) NOT NULL,
  description varchar(2000) NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('Planned','In progress','Completed')),
  priority text NOT NULL CHECK (priority IN ('Low','Medium','High','Urgent')),
  due_date date,
  assignee uuid,
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  overdue_event_date date,
  UNIQUE (org_id,id),
  FOREIGN KEY (org_id,project_id) REFERENCES projects(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,assignee) REFERENCES memberships(org_id,user_id)
);
CREATE INDEX tasks_org_project_idx ON tasks(org_id,project_id,status);
CREATE INDEX tasks_assignee_idx ON tasks(org_id,assignee,status);
CREATE INDEX tasks_due_idx ON tasks(due_date) WHERE status <> 'Completed';
CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  task_id uuid NOT NULL,
  author_id uuid NOT NULL,
  body varchar(2000) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,task_id) REFERENCES tasks(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,author_id) REFERENCES memberships(org_id,user_id)
);
CREATE INDEX comments_task_idx ON comments(org_id,task_id,created_at);
CREATE TABLE workflow_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title varchar(120) NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('task.created','task.completed','task.overdue','project.completed','member.joined')),
  priority text NOT NULL CHECK (priority IN ('Any','Low','Medium','High','Urgent')),
  message varchar(500) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (org_id,id)
);
CREATE INDEX workflow_match_idx ON workflow_rules(org_id,trigger) WHERE active;
CREATE TABLE workflow_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  event_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  FOREIGN KEY (org_id,rule_id) REFERENCES workflow_rules(org_id,id),
  UNIQUE (rule_id,event_id)
);
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  target text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org_time_idx ON audit_logs(org_id,created_at DESC);
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan text NOT NULL,
  amount integer NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL,
  correlation_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox(created_at,id) WHERE published_at IS NULL;
