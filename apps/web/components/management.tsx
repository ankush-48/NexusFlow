"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CircleUser,
  CreditCard,
  History,
  Plus,
  Search,
  Settings,
  Shield,
  UserRoundPlus,
  Users,
} from "lucide-react";
import {
  formatDate,
  type Invitation,
  type Org,
  type Person,
  type Snapshot,
} from "../lib/model";
import {
  Avatar,
  Empty,
  errorText,
  Field,
  Modal,
  type Notify,
  type Request,
} from "./common";
import { Directory } from "./directory";
import { PlanCards } from "./public";
import { Button } from "./ui/button";

const roles = ["Admin", "Project Manager", "Member", "Viewer"];
export function Team({
  org,
  snapshot,
  user,
  request,
  notify,
  refresh,
  demo,
}: {
  org: Org;
  snapshot: Snapshot;
  user: Person;
  request: Request;
  notify: Notify;
  refresh: () => Promise<void>;
  demo: boolean;
}) {
  const [search, setSearch] = useState("");
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const admin = org.role === "Owner" || org.role === "Admin";
  const path = "orgs/" + org.id + "/invitations";
  const invitations = useQuery({
    queryKey: [path],
    queryFn: () => request<Invitation[]>(path),
    enabled: admin,
  });
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await request<Invitation & { token?: string }>(
        path,
        "POST",
        Object.fromEntries(new FormData(event.currentTarget)),
      );
      await invitations.refetch();
      if (result.token)
        setLink(
          location.origin +
            "/onboarding?invite=" +
            encodeURIComponent(result.token),
        );
      else {
        notify("Invitation created");
        setInviting(false);
      }
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setBusy(false);
    }
  }
  async function changeRole(id: string, role: string) {
    try {
      await request("orgs/" + org.id + "/members/" + id, "PATCH", { role });
      await refresh();
      notify("Role updated");
    } catch (error) {
      notify(errorText(error), true);
    }
  }
  async function revoke(id: string) {
    try {
      await request(path + "/" + id, "DELETE");
      await invitations.refetch();
      notify("Invitation revoked");
    } catch (error) {
      notify(errorText(error), true);
    }
  }
  const visible = snapshot.team.filter((person) =>
    (person.name + " " + person.email)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">
            <Users size={14} /> WORKSPACE ACCESS
          </div>
          <h1>Team</h1>
          <p>Manage who has access to {org.name}.</p>
        </div>
        {admin && (
          <Button
            className="primary"
            onClick={() => {
              setLink("");
              setInviting(true);
            }}
          >
            <UserRoundPlus size={17} /> Invite member
          </Button>
        )}
      </section>
      <div className="view-toolbar">
        <label className="input-search">
          <Search size={15} />
          <input
            aria-label="Search members"
            placeholder="Search members…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((person) => (
              <tr key={person.id}>
                <td>
                  <button
                    className="text-button inline"
                    onClick={() => setPerson(person)}
                  >
                    <Avatar name={person.name} small />
                    {person.name}
                  </button>
                </td>
                <td>{person.email}</td>
                <td>
                  {admin &&
                  user.id !== person.id &&
                  person.role !== "Owner" &&
                  (org.role === "Owner" || person.role !== "Admin") ? (
                    <select
                      aria-label={"Role for " + person.name}
                      value={person.role}
                      onChange={(event) =>
                        void changeRole(person.id, event.target.value)
                      }
                    >
                      {roles
                        .filter(
                          (role) => role !== "Admin" || org.role === "Owner",
                        )
                        .map((role) => (
                          <option key={role}>{role}</option>
                        ))}
                    </select>
                  ) : (
                    person.role
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && <Empty>No members match.</Empty>}
      </div>
      {admin && (
        <div className="panel section-panel">
          <h2>Pending invitations</h2>
          <div className="record-list">
            {invitations.data?.map((item) => (
              <div className="record" key={item.id}>
                <div>
                  <strong>{item.email}</strong>
                  <small>
                    {item.role} · Expires {formatDate(item.expiresAt)}
                  </small>
                </div>
                <Button onClick={() => void revoke(item.id)}>Revoke</Button>
              </div>
            ))}
            {!invitations.data?.length && (
              <Empty>
                {invitations.isError
                  ? "Invitations could not be loaded."
                  : "No pending invitations."}
              </Empty>
            )}
          </div>
        </div>
      )}
      <Directory
        org={org}
        people={snapshot.team}
        request={request}
        notify={notify}
      />
      {person && (
        <Modal title="Member profile" close={() => setPerson(null)}>
          <div className="profile-card">
            <Avatar name={person.name} />
            <h3>{person.name}</h3>
            <span>{person.email}</span>
            <span>{person.role}</span>
          </div>
        </Modal>
      )}
      {inviting && (
        <Modal
          title={link ? "Invitation link" : "Invite a member"}
          close={() => setInviting(false)}
        >
          {link ? (
            <div className="form">
              <Field label="Invitation link">
                <input
                  value={link}
                  readOnly
                  onFocus={(event) => event.target.select()}
                />
              </Field>
              <Button
                onClick={() =>
                  void navigator.clipboard
                    .writeText(link)
                    .then(() => notify("Invitation link copied"))
                    .catch(() => notify("Select the link to copy it.", true))
                }
              >
                Copy link
              </Button>
            </div>
          ) : (
            <form onSubmit={invite} className="form">
              <Field label="Email">
                <input type="email" name="email" required />
              </Field>
              <Field label="Role">
                <select name="role" defaultValue="Member">
                  {roles
                    .filter((role) => role !== "Admin" || org.role === "Owner")
                    .map((role) => (
                      <option key={role}>{role}</option>
                    ))}
                </select>
              </Field>
              {demo && (
                <p className="muted">
                  Invitations are stored in this browser for the demo.
                </p>
              )}
              <Button className="primary" type="submit" disabled={busy}>
                Create invitation
              </Button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}

export function Billing({
  org,
  snapshot,
  request,
  notify,
  refresh,
}: {
  org: Org;
  snapshot: Snapshot;
  request: Request;
  notify: Notify;
  refresh: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [next, setNext] = useState("");
  const providerPath = "orgs/" + org.id + "/billing-provider";
  const providerQuery = useQuery({
    queryKey: [providerPath],
    queryFn: () => request<{ provider: string }>(providerPath),
  });
  const provider = providerQuery.data?.provider;
  async function update() {
    setPending(true);
    try {
      if (provider === "stripe-test") {
        const reply = await request<{ url: string }>(
          "orgs/" + org.id + "/stripe-checkout",
          "POST",
          { plan: next },
        );
        location.assign(reply.url);
        return;
      }
      await request("orgs/" + org.id + "/billing", "PATCH", { plan: next });
      await refresh();
      setNext("");
      notify("Plan updated");
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">
            <CreditCard size={14} /> SUBSCRIPTION
          </div>
          <h1>Billing</h1>
          <p>
            {org.name} · {org.plan} plan ·{" "}
            {provider === "mock"
              ? "Mock billing"
              : provider === "stripe-test"
                ? "Stripe test mode"
                : provider === "disabled"
                  ? "Billing disabled"
                  : "Loading provider"}
          </p>
        </div>
      </section>
      <PlanCards
        current={org.plan}
        select={
          org.role === "Owner" &&
          (provider === "mock" || provider === "stripe-test")
            ? setNext
            : undefined
        }
        pending={pending}
      />
      <div className="panel section-panel">
        <h2>Invoice history</h2>
        <div className="record-list">
          {snapshot.invoices.map((invoice) => (
            <div className="record" key={invoice.id}>
              <div>
                <strong>{invoice.plan}</strong>
                <small>{formatDate(invoice.createdAt)}</small>
              </div>
              <span>
                {(invoice.amount / 100).toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                })}
              </span>
            </div>
          ))}
          {!snapshot.invoices.length && <Empty>No demo invoices yet.</Empty>}
        </div>
      </div>
      {next && (
        <Modal
          title={"Switch to " + next}
          close={() => !pending && setNext("")}
        >
          <p>
            {provider === "stripe-test"
              ? "Continue to Stripe test billing to manage this plan."
              : "This updates your workspace plan through the local mock billing provider."}
          </p>
          <div className="form-actions">
            <Button disabled={pending} onClick={() => setNext("")}>
              Cancel
            </Button>
            <Button
              className="primary"
              disabled={pending}
              onClick={() => void update()}
            >
              Confirm change
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

type Session = {
  id: string;
  current: boolean;
  createdAt: string;
  expiresAt: string;
};
export function SettingsView({
  org,
  user,
  request,
  notify,
  refresh,
  demo,
}: {
  org: Org;
  user: Person;
  request: Request;
  notify: Notify;
  refresh: () => Promise<void>;
  demo: boolean;
}) {
  const [pending, setPending] = useState(false);
  const sessions = useQuery({
    queryKey: ["auth/sessions"],
    queryFn: () => request<Session[]>("auth/sessions"),
    enabled: !demo,
  });
  async function save(event: FormEvent<HTMLFormElement>, path: string) {
    event.preventDefault();
    setPending(true);
    try {
      await request(
        path,
        "PATCH",
        Object.fromEntries(new FormData(event.currentTarget)),
      );
      await refresh();
      notify("Settings saved");
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">
            <Settings size={14} /> PREFERENCES
          </div>
          <h1>Settings</h1>
          <p>Update your account and workspace details.</p>
        </div>
      </section>
      <section className="settings-grid">
        <form
          className="panel form section-panel"
          onSubmit={(event) => void save(event, "auth/profile")}
        >
          <h2>
            <CircleUser size={18} /> Profile
          </h2>
          <Field label="Display name">
            <input
              name="name"
              defaultValue={user.name}
              maxLength={100}
              required
            />
          </Field>
          <Field label="Email">
            <input value={user.email} readOnly />
          </Field>
          <Button type="submit" className="primary" disabled={pending}>
            Save profile
          </Button>
        </form>
        {(org.role === "Owner" || org.role === "Admin") && (
          <form
            className="panel form section-panel"
            onSubmit={(event) =>
              void save(event, "orgs/" + org.id + "/settings")
            }
          >
            <h2>
              <Settings size={18} /> Workspace
            </h2>
            <Field label="Workspace name">
              <input
                name="name"
                defaultValue={org.name}
                maxLength={100}
                required
              />
            </Field>
            <Button type="submit" className="primary" disabled={pending}>
              Save workspace
            </Button>
          </form>
        )}
      </section>
      {!demo && (
        <section className="panel section-panel">
          <h2>Active sessions</h2>
          <div className="record-list">
            {sessions.data?.map((session) => (
              <div className="record" key={session.id}>
                <div>
                  <strong>
                    {session.current ? "Current session" : "Other session"}
                  </strong>
                  <small>Expires {formatDate(session.expiresAt)}</small>
                </div>
                {!session.current && (
                  <Button
                    onClick={() =>
                      void request("auth/sessions/" + session.id, "DELETE")
                        .then(() => sessions.refetch())
                        .catch((error) => notify(errorText(error), true))
                    }
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))}
            {sessions.isError && <Empty>Sessions could not be loaded.</Empty>}
          </div>
        </section>
      )}
    </>
  );
}

export function AuditView({ snapshot }: { snapshot: Snapshot }) {
  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">
            <History size={14} /> WORKSPACE HISTORY
          </div>
          <h1>Audit logs</h1>
          <p>Review administrative and delivery activity.</p>
        </div>
      </section>
      <div className="panel">
        <div className="record-list">
          {snapshot.audit.map((item) => (
            <div className="record" key={item.id}>
              <History size={17} />
              <div>
                <strong>{item.target}</strong>
                <small>{item.action}</small>
              </div>
              <time>{formatDate(item.createdAt)}</time>
            </div>
          ))}
          {!snapshot.audit.length && <Empty>No workspace activity yet.</Empty>}
        </div>
      </div>
    </>
  );
}

type AdminData = {
  organizations: { id: string; name: string; plan: string }[];
  users: { id: string; name: string; email: string; suspended: boolean }[];
  health: { pending: number; total: number };
};
export function AdminView({
  request,
  notify,
}: {
  request: Request;
  notify: Notify;
}) {
  const admin = useQuery({
    queryKey: ["admin"],
    queryFn: () => request<AdminData>("admin"),
  });
  const [target, setTarget] = useState<AdminData["users"][number] | null>(null);
  const [pending, setPending] = useState(false);
  async function update() {
    if (!target) return;
    setPending(true);
    try {
      await request("admin/users/" + target.id, "PATCH", {
        suspended: !target.suspended,
      });
      await admin.refetch();
      setTarget(null);
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">
            <Shield size={14} /> PLATFORM OPERATIONS
          </div>
          <h1>Administration</h1>
          <p>Review organizations, accounts, and event delivery.</p>
        </div>
      </section>
      {admin.isError && <Empty>{errorText(admin.error)}</Empty>}
      {admin.data && (
        <div className="settings-grid">
          <section className="panel section-panel">
            <h2>Organizations</h2>
            <div className="record-list">
              {admin.data.organizations.map((item) => (
                <div className="record" key={item.id}>
                  <div>{item.name}</div>
                  <span>{item.plan}</span>
                </div>
              ))}
            </div>
            <p className="muted">
              {admin.data.health.pending} pending events ·{" "}
              {admin.data.health.total} recorded
            </p>
          </section>
          <section className="panel section-panel">
            <h2>Accounts</h2>
            <div className="record-list">
              {admin.data.users.map((item) => (
                <div className="record" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.email}</small>
                  </div>
                  <Button onClick={() => setTarget(item)}>
                    {item.suspended ? "Restore" : "Suspend"}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
      {target && (
        <Modal
          title={(target.suspended ? "Restore " : "Suspend ") + target.name}
          close={() => !pending && setTarget(null)}
        >
          <div className="form-actions">
            <Button onClick={() => setTarget(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              className="primary"
              onClick={() => void update()}
              disabled={pending}
            >
              Confirm
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function Onboarding({
  notify,
  create,
  accept,
}: {
  notify: Notify;
  create: (name: string) => Promise<void>;
  accept: (token: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const params = useSearchParams();
  const [invite, setInvite] = useState(() => params.get("invite") ?? "");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent, join = false) {
    event.preventDefault();
    setBusy(true);
    try {
      if (join) await accept(invite.trim());
      else await create(name.trim());
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="public auth">
      <div className="panel auth-card">
        <h1>Set up a workspace</h1>
        <form className="form" onSubmit={(event) => void submit(event)}>
          <Field label="Workspace name">
            <input
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Button type="submit" className="primary" disabled={busy}>
            <Plus size={16} /> Create workspace
          </Button>
        </form>
        <form
          className="form join-form"
          onSubmit={(event) => void submit(event, true)}
        >
          <Field label="Invitation token">
            <input
              value={invite}
              onChange={(event) => setInvite(event.target.value)}
              required
            />
          </Field>
          <Button type="submit" disabled={busy}>
            Join workspace
          </Button>
        </form>
        <Link href="/projects">Browse your workspaces</Link>
      </div>
    </main>
  );
}
