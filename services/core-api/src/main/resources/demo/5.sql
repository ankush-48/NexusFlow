INSERT INTO workflow_rules(id,org_id,title,trigger,priority,message,active) VALUES
  ('00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000001','Notify on task completion','task.completed','Any','A task has been completed.',true),
  ('00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000001','Flag high-priority work','task.created','High','A high-priority task needs attention.',true),
  ('00000000-0000-4000-8000-000000000903','00000000-0000-4000-8000-000000000001','Remind on overdue tasks','task.overdue','Any','An assigned task is overdue.',false);
