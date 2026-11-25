package com.nexusflow.core;

import jakarta.persistence.*;
import java.util.UUID;

@Entity
@Table(name = "tasks")
public class TaskEntity {
    @Id
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Version
    private long version;

    protected TaskEntity() {}
}
