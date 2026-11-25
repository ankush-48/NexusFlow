# Database ownership and relationships

The core schema is versioned by Flyway in `services/core-api/src/main/resources/db/migration`. The collaboration service applies additive schema setup inside an advisory-locked startup transaction. Dashed business references between core IDs and collaboration data are checked through REST.

```mermaid
erDiagram
    USER ||--o{ SESSION : holds
    USER ||--o{ AUTH_TOKEN : receives
    USER ||--o{ MEMBERSHIP : joins
    ORGANIZATION ||--o{ MEMBERSHIP : contains
    ORGANIZATION ||--o{ INVITATION : issues
    ORGANIZATION ||--o{ DEPARTMENT : contains
    DEPARTMENT o|--o{ TEAM : groups
    TEAM ||--o{ TEAM_MEMBER : includes
    MEMBERSHIP ||--o{ TEAM_MEMBER : assigns
    ORGANIZATION ||--o{ PROJECT : owns
    PROJECT ||--o{ MILESTONE : defines
    PROJECT ||--o{ TASK : contains
    TASK ||--o{ SUBTASK : splits
    TASK ||--o{ TASK_DEPENDENCY : needs
    TASK ||--o{ TASK_LABEL : tagged
    LABEL ||--o{ TASK_LABEL : attaches
    TASK ||--o{ COMMENT : discusses
    TASK ||--o{ ATTACHMENT : references
    TASK ||--o{ TASK_HISTORY : tracks
    ORGANIZATION ||--o{ WORKFLOW_RULE : defines
    WORKFLOW_RULE ||--o{ WORKFLOW_EXECUTION : runs
    ORGANIZATION ||--o{ AUDIT_LOG : records
    ORGANIZATION ||--o{ OUTBOX : publishes
    ORGANIZATION ||--o{ INVOICE : receives
    ORGANIZATION ||--o| STRIPE_SUBSCRIPTION : links
    ORGANIZATION |o..o{ CHANNEL : scopes
    CHANNEL ||--o{ CONVERSATION_MEMBER : restricts
    CHANNEL ||--o{ CONVERSATION_READ : tracks
    CHANNEL ||--o{ MESSAGE : contains
    MESSAGE ||--o{ MESSAGE_REACTION : receives
    MEMBERSHIP |o..o{ NOTIFICATION : receives
```

The core schema indexes tenant and project IDs, due dates, owner assignments, pending outbox rows, and report ordering. The collaboration database indexes messages by workspace, conversation, and creation date. Combined tenant/record foreign keys prevent a valid ID in another workspace from becoming an accidental reference.
