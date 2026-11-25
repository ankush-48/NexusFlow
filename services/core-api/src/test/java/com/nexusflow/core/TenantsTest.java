package com.nexusflow.core;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class TenantsTest {
    private final JdbcTemplate db=mock(JdbcTemplate.class);
    private final Tenants tenants=new Tenants(db);
    private final Sessions.User user=new Sessions.User(UUID.randomUUID(),"Demo","demo@example.test",false);
    private final UUID org=UUID.randomUUID();

    @Test
    void cannotReadWithoutMembership() {
        when(db.query(anyString(),any(RowMapper.class),eq(org),eq(user.id()))).thenReturn(List.of());
        var denial=assertThrows(ResponseStatusException.class,()->tenants.require(org,user));
        assertEquals(403,denial.getStatusCode().value());
    }

    @Test
    void readerCannotManage() {
        when(db.query(anyString(),any(RowMapper.class),eq(org),eq(user.id()))).thenReturn(List.of("Viewer"));
        assertEquals("Viewer",tenants.require(org,user));
        var denial=assertThrows(ResponseStatusException.class,()->tenants.require(org,user,Tenants.MANAGE));
        assertEquals(403,denial.getStatusCode().value());
    }

    @Test
    void hashesGeneratedTokensWithoutRetainingBearerValues() {
        String token=Sessions.token();
        assertEquals(43,token.length());
        assertNotEquals(token,Sessions.hash(token));
        assertEquals(64,Sessions.hash(token).length());
        assertNotEquals(token,Sessions.token());
    }
}
