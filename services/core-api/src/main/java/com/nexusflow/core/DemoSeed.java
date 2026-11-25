package com.nexusflow.core;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
class DemoSeed implements CommandLineRunner {
    private final JdbcTemplate db;
    private final BCryptPasswordEncoder encoder;
    private final String password;

    DemoSeed(JdbcTemplate db,BCryptPasswordEncoder encoder,@Value("${nexus.demo-password}") String password) {
        this.db=db;this.encoder=encoder;this.password=password;
    }

    @Override
    @Transactional
    public void run(String... args) {
        if (password.isBlank()) return;
        if (password.length()<12) throw new IllegalStateException("NEXUS_DEMO_PASSWORD must contain at least 12 characters");
        AuthController.byteLimit(password);
        db.execute((ConnectionCallback<Void>) connection -> {
            try (var statement=connection.createStatement()) {statement.execute("SELECT pg_advisory_xact_lock(662109)");}
            if (Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS (SELECT 1 FROM organizations WHERE id='00000000-0000-4000-8000-000000000001')",Boolean.class))) return null;
            for (int index=0;index<7;index++) ScriptUtils.executeSqlScript(connection,new ClassPathResource("demo/"+index+".sql"));
            db.update("""
                INSERT INTO departments(org_id,name)
                SELECT organizations.id,names.name FROM organizations CROSS JOIN (VALUES ('Delivery'),('Engineering')) AS names(name)
                WHERE id::text LIKE '00000000-0000-4000-8000-00000000000%' ON CONFLICT DO NOTHING
                """);
            db.update("""
                INSERT INTO teams(org_id,name,department_id)
                SELECT p.org_id,p.team,d.id FROM projects p JOIN departments d ON d.org_id=p.org_id
                WHERE p.id::text LIKE '00000000-0000-4000-8000-0000000002%' AND d.name=CASE WHEN p.team IN ('Engineering','Platform','Data') THEN 'Engineering' ELSE 'Delivery' END
                GROUP BY p.org_id,p.team,d.id ON CONFLICT DO NOTHING
                """);
            db.update("""
                INSERT INTO team_members(org_id,team_id,user_id)
                SELECT DISTINCT p.org_id,t.id,p.owner FROM projects p JOIN teams t ON t.org_id=p.org_id AND t.name=p.team
                WHERE p.id::text LIKE '00000000-0000-4000-8000-0000000002%' AND p.owner IS NOT NULL ON CONFLICT DO NOTHING
                """);
            db.update("UPDATE users SET password_hash=? WHERE password_hash='pending-demo'",encoder.encode(password));
            return null;
        });
    }
}
