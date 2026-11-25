"use client";

import { Circle, CircleCheck, CircleDot, Signal, X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { initials, type Person } from "../lib/model";
import { Button } from "./ui/button";

export type Request = <T>(
  path: string,
  method?: string,
  data?: unknown,
) => Promise<T>;
export type Notify = (message: string, error?: boolean) => void;

const avatarColors = ["lilac", "mint", "amber", "rose", "blue", "peach"];
export function Avatar({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  const color =
    avatarColors[
      Array.from(name).reduce((sum, letter) => sum + letter.charCodeAt(0), 0) %
        avatarColors.length
    ];
  return (
    <span className={"avatar " + color + (small ? " small" : "")} title={name}>
      {initials(name) || "–"}
    </span>
  );
}
export function StatusIcon({ status }: { status: string }) {
  const Icon =
    status === "Completed"
      ? CircleCheck
      : status === "In progress"
        ? CircleDot
        : Circle;
  return (
    <Icon
      size={16}
      className={
        status === "Completed"
          ? "green"
          : status === "In progress"
            ? "violet"
            : "muted"
      }
    />
  );
}
export function Priority({ value }: { value: string }) {
  return (
    <span className={"priority priority-" + value.toLowerCase()}>
      <Signal size={14} />
      {value}
    </span>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal-body">
        <header>
          <h2 id={titleId}>{title}</h2>
          <Button className="icon ghost" onClick={close} aria-label="Close">
            <X size={18} />
          </Button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function PersonSelect({
  people,
  value,
  onChange,
  label,
}: {
  people: Person[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Unassigned</option>
      {people.map((person) => (
        <option key={person.id} value={person.id}>
          {person.name}
        </option>
      ))}
    </select>
  );
}
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";
