CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  UNIQUE (org_id,id),
  UNIQUE (org_id,name)
);
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id uuid,
  name varchar(80) NOT NULL,
  UNIQUE (org_id,id),
  UNIQUE (org_id,name),
  FOREIGN KEY (org_id,department_id) REFERENCES departments(org_id,id)
);
INSERT INTO teams(org_id,name)
SELECT DISTINCT org_id,team FROM projects ON CONFLICT DO NOTHING;
CREATE TABLE team_members (
  org_id uuid NOT NULL,
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY (org_id,team_id,user_id),
  FOREIGN KEY (org_id,team_id) REFERENCES teams(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY (org_id,user_id) REFERENCES memberships(org_id,user_id) ON DELETE CASCADE
);
