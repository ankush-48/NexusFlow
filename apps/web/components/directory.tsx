"use client";

import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Plus, Users } from "lucide-react";
import type { Org, Person } from "../lib/model";
import {
  Empty,
  errorText,
  Field,
  Modal,
  type Notify,
  type Request,
} from "./common";
import { Button } from "./ui/button";

type Unit = { id: string; name: string };
type Team = Unit & { departmentId: string | null; memberIds: string };
type DirectoryData = { departments: Unit[]; teams: Team[] };

export function Directory({
  org,
  people,
  request,
  notify,
}: {
  org: Org;
  people: Person[];
  request: Request;
  notify: Notify;
}) {
  const [editor, setEditor] = useState<"departments" | "teams" | "">("");
  const [team, setTeam] = useState<Team | null>(null);
  const [busy, setBusy] = useState(false);
  const path = "orgs/" + org.id + "/directory";
  const directory = useQuery({
    queryKey: [path],
    queryFn: () => request<DirectoryData>(path),
  });
  const admin = org.role === "Owner" || org.role === "Admin";
  const assigned = team ? (JSON.parse(team.memberIds) as string[]) : [];
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await request(path + "/" + editor, "POST", {
        name: String(values.get("name")).trim(),
        departmentId: values.get("departmentId") || null,
      });
      await directory.refetch();
      setEditor("");
      notify("Directory updated");
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setBusy(false);
    }
  }
  async function assign(userId: string, included: boolean) {
    if (!team) return;
    setBusy(true);
    try {
      await request(path + "/teams/" + team.id + "/members", "PATCH", {
        userId,
        assigned: included,
      });
      const result = await directory.refetch();
      setTeam(result.data?.teams.find((item) => item.id === team.id) ?? null);
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="settings-grid">
        <section className="panel section-panel">
          <div className="report-head">
            <h2>
              <Building2 size={17} /> Departments
            </h2>
            {admin && (
              <Button
                className="icon ghost"
                aria-label="Add department"
                onClick={() => setEditor("departments")}
              >
                <Plus size={16} />
              </Button>
            )}
          </div>
          {directory.data?.departments.map((item) => (
            <div className="record" key={item.id}>
              <div>{item.name}</div>
            </div>
          ))}
          {!directory.data?.departments.length && (
            <Empty>
              {directory.isError
                ? "Departments could not be loaded."
                : "No departments yet."}
            </Empty>
          )}
        </section>
        <section className="panel section-panel">
          <div className="report-head">
            <h2>
              <Users size={17} /> Teams
            </h2>
            {admin && (
              <Button
                className="icon ghost"
                aria-label="Add team"
                onClick={() => setEditor("teams")}
              >
                <Plus size={16} />
              </Button>
            )}
          </div>
          {directory.data?.teams.map((item) => (
            <button
              className="record text-button"
              key={item.id}
              onClick={() => setTeam(item)}
            >
              <div>
                <strong>{item.name}</strong>
                <small>
                  {directory.data?.departments.find(
                    (department) => department.id === item.departmentId,
                  )?.name ?? "Workspace team"}
                </small>
              </div>
              <span>
                {(JSON.parse(item.memberIds) as string[]).length} members
              </span>
            </button>
          ))}
          {!directory.data?.teams.length && (
            <Empty>
              {directory.isError
                ? "Teams could not be loaded."
                : "No teams yet."}
            </Empty>
          )}
        </section>
      </div>
      {editor && (
        <Modal
          title={editor === "teams" ? "New team" : "New department"}
          close={() => setEditor("")}
        >
          <form className="form" onSubmit={add}>
            <Field label="Name">
              <input name="name" required maxLength={80} />
            </Field>
            {editor === "teams" && (
              <Field label="Department">
                <select name="departmentId">
                  <option value="">No department</option>
                  {directory.data?.departments.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Button type="submit" className="primary" disabled={busy}>
              Create {editor === "teams" ? "team" : "department"}
            </Button>
          </form>
        </Modal>
      )}
      {team && (
        <Modal title={team.name + " members"} close={() => setTeam(null)}>
          <div className="record-list">
            {people
              .filter((person) => admin || assigned.includes(person.id))
              .map((person) => (
                <label key={person.id} className="record">
                  <input
                    type="checkbox"
                    checked={assigned.includes(person.id)}
                    disabled={!admin || busy}
                    onChange={(event) =>
                      void assign(person.id, event.target.checked)
                    }
                  />
                  <div>{person.name}</div>
                  <span>{person.role}</span>
                </label>
              ))}
          </div>
        </Modal>
      )}
    </>
  );
}
