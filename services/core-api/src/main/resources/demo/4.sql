WITH project_order AS (
  SELECT p.*, row_number() OVER (ORDER BY p.id)::int - 1 AS idx FROM projects p
  WHERE p.id BETWEEN '00000000-0000-4000-8000-000000000201' AND '00000000-0000-4000-8000-000000000215'
), entries AS (
  SELECT p.*, n,
    CASE WHEN p.status='Completed' OR (p.status='In progress' AND n<2+p.idx%5) THEN 'Completed'
         WHEN p.status='In progress' AND n<6 THEN 'In progress' ELSE 'Planned' END AS task_status
  FROM project_order p CROSS JOIN generate_series(0,7) AS n
)
INSERT INTO tasks(id,org_id,project_id,title,description,status,priority,due_date,assignee,updated_at,completed_at,created_at)
SELECT ('00000000-0000-4000-8000-' || lpad((401+idx*8+n)::text,12,'0'))::uuid,org_id,id,
  (ARRAY['Confirm release scope','Review implementation details','Prepare test fixtures','Document the onboarding flow','Validate accessibility','Run acceptance checks','Review monitoring and alerts','Share rollout notes'])[n+1],
  'Coordinate with '||team||' and record the outcome in the project.',task_status,
  CASE n WHEN 1 THEN 'High' WHEN 6 THEN 'Low' ELSE 'Medium' END,due_date-n,
  ('00000000-0000-4000-8000-' || lpad((101+CASE WHEN org_id='00000000-0000-4000-8000-000000000001' THEN (idx+n)%6 ELSE 0 END)::text,12,'0'))::uuid,
  now()-(n+1)*interval '1 day',CASE WHEN task_status='Completed' THEN now()-(idx+n+1)*interval '1 day' END,now()-(idx+n+3)*interval '1 day'
FROM entries;
