ALTER TABLE tasks ADD COLUMN reminder_event_date date;
ALTER TABLE tasks ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
UPDATE tasks SET created_at=LEAST(updated_at,COALESCE(completed_at,updated_at))-interval '1 day';
ALTER TABLE workflow_rules DROP CONSTRAINT workflow_rules_trigger_check;
ALTER TABLE workflow_rules ADD CONSTRAINT workflow_rules_trigger_check
  CHECK (trigger IN ('task.created','task.completed','task.overdue','task.due_soon','project.completed','member.joined'));
CREATE TABLE notification_emails (
  id uuid PRIMARY KEY REFERENCES workflow_executions(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now()
);
