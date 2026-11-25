"use client";

import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Link2, ListChecks, Tag, X } from "lucide-react";
import { formatDate, type Task } from "../lib/model";
import { Empty, errorText, Field, type Request } from "./common";
import { Button } from "./ui/button";

export type ChecklistItem = { id: string; title: string; done: boolean };
export type Milestone = ChecklistItem & { dueDate: string | null };
export type TaskDetails = {
  subtasks: ChecklistItem[];
  labels: string[];
  dependencies: { id: string; title: string; status: string }[];
  history: {
    id: string;
    name: string;
    action: string;
    status: string;
    createdAt: string;
  }[];
};

export function TaskMetadata({
  task,
  tasks,
  base,
  request,
  manage,
}: {
  task: Task;
  tasks: Task[];
  base: string;
  request: Request;
  manage: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [doing, setDoing] = useState(false);
  const [failure, setFailure] = useState("");
  const [subtask, setSubtask] = useState("");
  const [label, setLabel] = useState("");
  const [dependency, setDependency] = useState("");
  const path = base + "/tasks/" + task.id;
  const details = useQuery({
    queryKey: [path, "details"],
    queryFn: () => request<TaskDetails>(path + "/details"),
    enabled: opened,
  });
  async function change(
    resource: string,
    method: string,
    body?: unknown,
    reset?: () => void,
  ) {
    setDoing(true);
    setFailure("");
    try {
      await request(path + "/" + resource, method, body);
      await details.refetch();
      reset?.();
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setDoing(false);
    }
  }
  const data = details.data;
  return (
    <section className="comments">
      <Button
        className="ghost"
        aria-expanded={opened}
        onClick={() => setOpened(!opened)}
      >
        <ListChecks size={16} /> Task details
      </Button>
      {opened && (
        <div className="task-details">
          {details.isError && (
            <p className="form-error">{errorText(details.error)}</p>
          )}
          {data && (
            <>
              <div>
                <h3>
                  <ListChecks size={15} /> Subtasks
                </h3>
                {data.subtasks.map((item) => (
                  <label className="record" key={item.id}>
                    <input
                      type="checkbox"
                      checked={item.done}
                      disabled={!manage || doing}
                      onChange={(event) =>
                        void change("subtasks/" + item.id, "PATCH", {
                          done: event.target.checked,
                        })
                      }
                    />
                    <span>{item.title}</span>
                  </label>
                ))}
                {manage && (
                  <form
                    className="inline"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (subtask.trim())
                        void change(
                          "subtasks",
                          "POST",
                          { title: subtask.trim() },
                          () => setSubtask(""),
                        );
                    }}
                  >
                    <input
                      aria-label="Subtask title"
                      placeholder="Add a subtask…"
                      maxLength={120}
                      value={subtask}
                      onChange={(event) => setSubtask(event.target.value)}
                    />
                    <Button type="submit" disabled={doing || !subtask.trim()}>
                      Add
                    </Button>
                  </form>
                )}
              </div>
              <div>
                <h3>
                  <Tag size={15} /> Labels
                </h3>
                <div className="inline label-list">
                  {data.labels.map((name) => (
                    <span key={name} className="team-pill tone-iris">
                      {name}
                      {manage && (
                        <button
                          aria-label={"Remove label " + name}
                          disabled={doing}
                          onClick={() =>
                            void change(
                              "labels/" + encodeURIComponent(name),
                              "DELETE",
                            )
                          }
                        >
                          <X size={13} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                {manage && (
                  <form
                    className="inline"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (label.trim())
                        void change(
                          "labels",
                          "POST",
                          { name: label.trim() },
                          () => setLabel(""),
                        );
                    }}
                  >
                    <input
                      aria-label="Label name"
                      placeholder="Add a label…"
                      pattern="[a-zA-Z0-9][a-zA-Z0-9 _\-]{0,29}"
                      value={label}
                      onChange={(event) => setLabel(event.target.value)}
                    />
                    <Button type="submit" disabled={doing || !label.trim()}>
                      Add
                    </Button>
                  </form>
                )}
              </div>
              <div>
                <h3>
                  <Link2 size={15} /> Prerequisites
                </h3>
                {data.dependencies.map((item) => (
                  <div className="record" key={item.id}>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.status}</small>
                    </div>
                    {manage && (
                      <Button
                        className="ghost icon"
                        aria-label={"Remove dependency " + item.title}
                        disabled={doing}
                        onClick={() =>
                          void change("dependencies/" + item.id, "DELETE")
                        }
                      >
                        <X size={14} />
                      </Button>
                    )}
                  </div>
                ))}
                {manage && (
                  <form
                    className="inline"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (dependency)
                        void change(
                          "dependencies",
                          "POST",
                          { prerequisiteId: dependency },
                          () => setDependency(""),
                        );
                    }}
                  >
                    <select
                      aria-label="Prerequisite task"
                      value={dependency}
                      onChange={(event) => setDependency(event.target.value)}
                    >
                      <option value="">Choose a prerequisite</option>
                      {tasks
                        .filter(
                          (item) =>
                            item.id !== task.id &&
                            !data.dependencies.some(
                              (link) => link.id === item.id,
                            ),
                        )
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title}
                          </option>
                        ))}
                    </select>
                    <Button type="submit" disabled={doing || !dependency}>
                      Link
                    </Button>
                  </form>
                )}
              </div>
              <div>
                <h3>
                  <History size={15} /> Activity
                </h3>
                {data.history.length ? (
                  data.history.map((item) => (
                    <div className="record" key={item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        <small>
                          {item.action.replace("task.", "")} · {item.status}
                        </small>
                      </div>
                      <span>{formatDate(item.createdAt)}</span>
                    </div>
                  ))
                ) : (
                  <p className="muted">No recent changes.</p>
                )}
              </div>
            </>
          )}
          {failure && (
            <p role="alert" className="form-error">
              {failure}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function Milestones({
  path,
  request,
  manage,
}: {
  path: string;
  request: Request;
  manage: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const milestones = useQuery({
    queryKey: [path],
    queryFn: () => request<Milestone[]>(path),
    enabled: opened,
  });
  async function change(
    method: string,
    body: unknown,
    id = "",
    form?: HTMLFormElement,
  ) {
    setPending(true);
    setFailure("");
    try {
      await request(path + (id ? "/" + id : ""), method, body);
      await milestones.refetch();
      form?.reset();
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setPending(false);
    }
  }
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (String(values.get("title")).trim())
      void change(
        "POST",
        { title: values.get("title"), dueDate: values.get("dueDate") || null },
        "",
        form,
      );
  }
  return (
    <section className="panel section-panel milestones">
      <Button
        className="ghost"
        aria-expanded={opened}
        onClick={() => setOpened(!opened)}
      >
        <ListChecks size={16} /> Project milestones
      </Button>
      {opened && (
        <>
          {milestones.data?.map((item) => (
            <label className="record" key={item.id}>
              <input
                type="checkbox"
                checked={item.done}
                disabled={!manage || pending}
                onChange={(event) =>
                  void change("PATCH", { done: event.target.checked }, item.id)
                }
              />
              <div>{item.title}</div>
              <span>{formatDate(item.dueDate)}</span>
            </label>
          ))}
          {!milestones.data?.length && (
            <Empty>
              {milestones.isError
                ? "Milestones could not be loaded."
                : "No milestones yet."}
            </Empty>
          )}
          {manage && (
            <form className="milestone-form" onSubmit={add}>
              <Field label="Milestone">
                <input name="title" required maxLength={120} />
              </Field>
              <Field label="Due date">
                <input name="dueDate" type="date" />
              </Field>
              <Button type="submit" disabled={pending}>
                Add milestone
              </Button>
            </form>
          )}
          {failure && (
            <p className="form-error" role="alert">
              {failure}
            </p>
          )}
        </>
      )}
    </section>
  );
}

type AttachmentList = {
  configured: boolean;
  files: { id: string; name: string; size: number; createdAt: string }[];
};
export function Attachments({
  path,
  request,
  manage,
}: {
  path: string;
  request: Request;
  manage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const files = useQuery({
    queryKey: [path],
    queryFn: () => request<AttachmentList>(path),
    enabled: open,
  });
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setFailure("");
    try {
      const body = new FormData(form);
      const response = await fetch("/api/" + path, { method: "POST", body });
      if (!response.ok) {
        const reply = await response.json().catch(() => null);
        throw new Error(reply?.detail || "The file could not be uploaded.");
      }
      form.reset();
      await files.refetch();
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="comments">
      <Button
        className="ghost"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Attachments
      </Button>
      {open && (
        <div className="task-details">
          {files.isError && (
            <p className="form-error">{errorText(files.error)}</p>
          )}
          {files.data?.files.map((file) => (
            <a
              className="record"
              key={file.id}
              href={"/api/" + path + "/" + file.id}
              download
            >
              <div>{file.name}</div>
              <small>{Math.max(1, Math.ceil(file.size / 1024))} KB</small>
            </a>
          ))}
          {files.data?.configured === false && (
            <p className="muted">
              Object storage is unavailable in this environment.
            </p>
          )}
          {files.data?.configured && manage && (
            <form className="inline" onSubmit={upload}>
              <input
                required
                type="file"
                name="file"
                aria-label="Task attachment"
                accept=".png,.jpg,.jpeg,.pdf,.txt"
              />
              <Button type="submit" disabled={pending}>
                Upload
              </Button>
            </form>
          )}
          {failure && (
            <p className="form-error" role="alert">
              {failure}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
