package com.nexusflow.core;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import static org.junit.jupiter.api.Assertions.*;

// Point this suite at a migrated disposable database. Each case only changes its own user.
@EnabledIfEnvironmentVariable(named="NEXUS_TEST_CORE_JDBC",matches=".+")
class SessionLifecyclePostgresTest {
    private final UUID user = UUID.randomUUID();
    private final String checkedHash = Sessions.token();
    private JdbcTemplate db;
    private TransactionTemplate tx;
    private Sessions sessions;

    @BeforeEach
    void createAccount() {
        var data = new DriverManagerDataSource(System.getenv("NEXUS_TEST_CORE_JDBC"),
            System.getenv("NEXUS_TEST_CORE_DB_USER"), System.getenv("NEXUS_TEST_CORE_DB_PASSWORD"));
        db = new JdbcTemplate(data);
        tx = new TransactionTemplate(new DataSourceTransactionManager(data));
        sessions = new Sessions(db,true);
        db.update("INSERT INTO users(id,email,name,password_hash,verified) VALUES (?,?,?,?,true)",
            user, user+"@session.example", "Session test", checkedHash);
    }

    @AfterEach
    void removeAccount() {
        db.update("DELETE FROM users WHERE id=?", user);
    }

    @Test
    void rotationHonorsTheOriginalAbsoluteExpiry() {
        var original = sessions.issue(user);
        db.update("UPDATE sessions SET refresh_expires=now()+interval '5 minutes' WHERE user_id=?", user);
        var rotated = sessions.rotate(original.refresh()).orElseThrow();
        assertTrue(sessions.resolve(rotated.access()).isPresent());
        assertEquals(Boolean.TRUE,db.queryForObject(
            "SELECT access_expires=refresh_expires FROM sessions WHERE user_id=?", Boolean.class,user));
        db.update("UPDATE sessions SET refresh_expires=now()-interval '1 second' WHERE user_id=?",user);
        assertTrue(sessions.resolve(rotated.access()).isEmpty());
        assertTrue(sessions.rotate(rotated.refresh()).isEmpty());
    }

    @Test
    void credentialChangeWinsAgainstAnInFlightLogin() throws Exception {
        assertTrue(tx.execute(s -> sessions.issueAfterLogin(user,checkedHash)).isPresent());
        var changed = new CompletableFuture<Void>();
        var mayCommit = new CompletableFuture<Void>();
        try (var workers = Executors.newFixedThreadPool(2)) {
            var reset = workers.submit(() -> tx.executeWithoutResult(s -> {
                db.update("UPDATE users SET password_hash=? WHERE id=?",Sessions.token(),user);
                db.update("DELETE FROM sessions WHERE user_id=?",user);
                changed.complete(null);
                mayCommit.orTimeout(10,TimeUnit.SECONDS).join();
            }));
            changed.get(10,TimeUnit.SECONDS);
            var login = workers.submit(() -> tx.execute(s -> sessions.issueAfterLogin(user,checkedHash)));
            mayCommit.complete(null);
            reset.get(10,TimeUnit.SECONDS);
            assertTrue(login.get(10,TimeUnit.SECONDS).isEmpty());
            assertEquals(0,db.queryForObject("SELECT count(*) FROM sessions WHERE user_id=?",Integer.class,user));
        } finally {
            mayCommit.complete(null);
        }
    }
}
