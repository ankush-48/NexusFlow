CREATE TABLE subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  task_id uuid NOT NULL,
  title varchar(120) NOT NULL,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,task_id) REFERENCES tasks(org_id,id) ON DELETE CASCADE
);
CREATE INDEX subtasks_task_idx ON subtasks(org_id,task_id,created_at);
CREATE TABLE task_dependencies (
  org_id uuid NOT NULL,
  task_id uuid NOT NULL,
  prerequisite_id uuid NOT NULL,
  CHECK (task_id<>prerequisite_id),
  PRIMARY KEY (org_id,task_id,prerequisite_id),
  FOREIGN KEY (org_id,task_id) REFERENCES tasks(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,prerequisite_id) REFERENCES tasks(org_id,id) ON DELETE CASCADE
);
CREATE TABLE labels (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(30) NOT NULL,
  PRIMARY KEY (org_id,name)
);
CREATE TABLE task_labels (
  org_id uuid NOT NULL,
  task_id uuid NOT NULL,
  name varchar(30) NOT NULL,
  PRIMARY KEY (org_id,task_id,name),
  FOREIGN KEY (org_id,task_id) REFERENCES tasks(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,name) REFERENCES labels(org_id,name) ON DELETE CASCADE
);
CREATE TABLE milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  title varchar(120) NOT NULL,
  due_date date,
  done boolean NOT NULL DEFAULT false,
  FOREIGN KEY (org_id,project_id) REFERENCES projects(org_id,id) ON DELETE CASCADE
);
CREATE INDEX milestones_project_idx ON milestones(org_id,project_id,due_date);
CREATE TABLE task_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  task_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,task_id) REFERENCES tasks(org_id,id) ON DELETE CASCADE
);
CREATE INDEX task_history_task_idx ON task_history(org_id,task_id,created_at DESC);
