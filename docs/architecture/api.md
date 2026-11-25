# API reference

REST calls use the same browser origin. The Java OpenAPI document is at `/v3/api-docs`, and the interactive UI is at `/swagger-ui.html` on the Compose ingress. Requests use the `nf_access` HttpOnly cookie, and refresh uses a separate cookie scoped to `/api/auth`.

Send explicit JSON booleans for fields such as project `archived`, workflow `active` and account `suspended`. The upgraded Java JSON decoder rejects omitted or null primitive boolean values.

| Routes | Responsibilities |
| --- | --- |
| `/api/auth/*` | Registration, login, verification, password reset, profile, refresh and session revocation |
| `/api/orgs` | List or create workspaces |
| `/api/orgs/{org}/snapshot` | Scoped project, task, directory, workflow, audit and billing data |
| `/api/orgs/{org}/projects`, `/tasks` | Create and update work records and their details |
| `/api/orgs/{org}/directory` | Departments, teams, and team assignments |
| `/api/orgs/{org}/invitations` | Create, list and revoke invitations. Signed-in recipients can accept via `/api/orgs/accept-invitation`. |
| `/api/orgs/{org}/rules`, `/executions` | Workflow configuration and execution history |
| `/api/orgs/{org}/billing`, `/stripe-checkout` | Local mock provider or Stripe test checkout |
| `/api/billing/stripe/webhook` | Signature-verified `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted` |
| `/api/collab/{org}/channels` | Tenant-scoped conversations, message history, receipts and reactions |
| `/api/collab/{org}/search?q=...` | Authorized message search |
| `/api/collab/{org}/notifications` | Current user's notification inbox and read state |
| `/api/admin` | Platform-wide account and organization administration |

Task updates require the last observed `version`. Missing or unauthorized workspace access returns 403. Missing objects in an authorized tenant return 404. A version conflict returns 409. Validation errors carry a message in `detail` or `message`.

Socket clients connect through `/socket.io/`. After successful authentication, emit `workspace.join` with the workspace UUID or `channel.join` with `{ orgId, channelId }`. Check `{ ok }` before subscribing to a room. Events include `task.changed`, `notification.created`, `message.created` and transient `channel.typing`. Mutation events invalidate the relevant query. Persisted message content is fetched through tenant- and conversation-checked REST.
