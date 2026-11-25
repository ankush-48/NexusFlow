package com.nexusflow.core;

import org.springframework.data.repository.Repository;
import java.util.UUID;

interface TaskRepository extends Repository<TaskEntity, UUID> {
    boolean existsByIdAndOrgId(UUID id, UUID orgId);
}
