"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  AudioLines,
  Check,
  LayoutGrid,
  MessageSquare,
  Workflow,
} from "lucide-react";
import { errorText, Field, type Request } from "./common";
import { Button } from "./ui/button";
import { plans, type Screen } from "../lib/model";

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={"brand" + (small ? " compact" : "")}>
      <span className="brand-mark">
        <AudioLines size={small ? 17 : 21} />
      </span>
      {!small && <span>NexusFlow</span>}
    </span>
  );
}
export const planDetails: Record<
  string,
  { price: string; features: string[] }
> = {
  Free: {
    price: "$0",
    features: ["Up to 5 members", "Project boards", "Team channels"],
  },
  Professional: {
    price: "$24",
    features: [
      "Up to 100 members",
      "Workflow builder",
      "Reports and CSV export",
    ],
  },
  Enterprise: {
    price: "Custom",
    features: [
      "Up to 1,000 members",
      "Workspace administration",
      "Access and audit controls",
    ],
  },
};

export function PlanCards({
  current,
  select,
  pending,
}: {
  current?: string;
  select?: (plan: string) => void;
  pending?: boolean;
}) {
  return (
    <div className="plans">
      {plans.map((plan) => (
        <article
          key={plan}
          className={
            "panel plan " + (plan === "Professional" ? "featured" : "")
          }
        >
          <h2>{plan}</h2>
          <p className="price">
            {planDetails[plan].price}
            {plan !== "Enterprise" && <small> / month</small>}
          </p>
          <ul>
            {planDetails[plan].features.map((feature) => (
              <li key={feature}>
                <Check size={16} />
                {feature}
              </li>
            ))}
          </ul>
          {select ? (
            <Button
              className={plan === "Professional" ? "primary" : ""}
              disabled={pending || current === plan}
              onClick={() => select(plan)}
            >
              {current === plan ? "Current plan" : "Choose " + plan}
            </Button>
          ) : current ? (
            current === plan ? (
              <span className="muted">Current plan</span>
            ) : null
          ) : (
            <Link
              className={"button " + (plan === "Professional" ? "primary" : "")}
              href="/register"
            >
              Get started
            </Link>
          )}
        </article>
      ))}
    </div>
  );
}

export function PublicPage({
  screen,
  request,
}: {
  screen: Screen;
  request: Request;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const invite = search.get("invite");
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [tokenMode, setTokenMode] = useState<{ verify: string; reset: string }>(
    () => ({
      verify: search.get("verify") ?? "",
      reset: search.get("reset") ?? "",
    }),
  );
  const register = screen === "register";
  const forgot = screen === "forgot-password";
  const resend =
    screen === "login" && search.get("resend") === "1" && !tokenMode.verify;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure("");
    setNotice("");
    setPending(true);
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (screen === "login" && tokenMode.verify) {
        await request("auth/verify", "POST", { token: tokenMode.verify });
        setTokenMode({ verify: "", reset: "" });
        setNotice("Email verified. You can sign in.");
        return;
      }
      if (resend) {
        await request("auth/resend-verification", "POST", { email: form.email });
        setNotice(
          "If your account needs verification, check your inbox for a new link.",
        );
        return;
      }
      if (forgot) {
        if (tokenMode.reset) {
          await request("auth/reset-password", "POST", {
            token: tokenMode.reset,
            password: form.password,
          });
          router.push("/login");
          return;
        }
        await request("auth/forgot-password", "POST", { email: form.email });
        setNotice("If your account exists, a reset link will arrive by email.");
        return;
      }
      const reply = await request<{ verificationRequired?: boolean }>(
        "auth/" + screen,
        "POST",
        form,
      );
      if (reply.verificationRequired) {
        setNotice("Check your email for a verification link, then sign in.");
        return;
      }
      router.push(
        invite
          ? "/onboarding?invite=" + encodeURIComponent(invite)
          : "/projects",
      );
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setPending(false);
    }
  }
  if (screen === "home" || screen === "pricing")
    return (
      <div className="public marketing">
        <header>
          <Link href="/">
            <Brand />
          </Link>
          <nav>
            <Link href="/pricing">Pricing</Link>
            <Link href="/login">Sign in</Link>
            <Link className="button primary" href="/register">
              Create account
            </Link>
          </nav>
        </header>
        {screen === "home" ? (
          <>
            <div className="hero">
              <div className="eyebrow">THE TEAM WORKSPACE</div>
              <h1>
                Plan the work.
                <br />
                Keep everyone in sync.
              </h1>
              <p>
                Manage projects, talk to your team, and automate the follow-ups
                in one workspace.
              </p>
              <div className="inline">
                <Link href="/register" className="button primary">
                  Create workspace <ArrowRight size={17} />
                </Link>
                <Link href="/login" className="button">
                  Sign in
                </Link>
              </div>
            </div>
            <div className="feature-grid">
              {[
                {
                  title: "Plan projects",
                  icon: LayoutGrid,
                  text: "See the schedule, progress, and owner of every project.",
                },
                {
                  title: "Talk in context",
                  icon: MessageSquare,
                  text: "Keep team conversations close to decisions and deadlines.",
                },
                {
                  title: "Automate follow-ups",
                  icon: Workflow,
                  text: "Connect workspace events to actions your team can count on.",
                },
              ].map((item) => (
                <article className="panel" key={item.title}>
                  <item.icon size={24} />
                  <h2>{item.title}</h2>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="hero compact-hero">
              <h1>Choose your workspace plan</h1>
              <p>Start free and change plans as your team grows.</p>
            </div>
            <PlanCards />
          </>
        )}
      </div>
    );
  return (
    <main className="public auth">
      <Link href="/">
        <Brand />
      </Link>
      <div className="panel auth-card">
        <h1>
          {tokenMode.verify
            ? "Verify your email"
            : register
              ? "Create your account"
              : forgot
                ? tokenMode.reset
                  ? "Set a new password"
                  : "Reset password"
                : resend
                  ? "Resend verification email"
                  : "Sign in to NexusFlow"}
        </h1>
        <form className="form" onSubmit={submit}>
          {register && (
            <Field label="Name">
              <input name="name" autoComplete="name" required maxLength={100} />
            </Field>
          )}
          {!tokenMode.verify && !tokenMode.reset && (
            <Field label="Email">
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </Field>
          )}
          {!tokenMode.verify && !resend && (!forgot || tokenMode.reset) && (
            <Field label="Password">
              <input
                name="password"
                type="password"
                required
                minLength={register || tokenMode.reset ? 12 : undefined}
                maxLength={72}
                autoComplete={
                  register || tokenMode.reset
                    ? "new-password"
                    : "current-password"
                }
              />
            </Field>
          )}
          {notice && (
            <p className="green" role="status">
              {notice}
            </p>
          )}
          {failure && (
            <p className="form-error" role="alert">
              {failure}
            </p>
          )}
          <Button className="primary" type="submit" disabled={pending}>
            {pending
              ? "Please wait…"
              : tokenMode.verify
                ? "Verify email"
                : register
                  ? "Create account"
                  : forgot
                    ? tokenMode.reset
                      ? "Save password"
                      : "Send reset link"
                    : resend
                      ? "Send verification link"
                      : "Sign in"}
          </Button>
        </form>
        <footer>
          {screen === "login" && !resend && !tokenMode.verify ? (
            <>
              <Link href="/forgot-password">Forgot password?</Link>
              <Link href="/login?resend=1">Resend verification email</Link>
              <Link
                href={
                  invite
                    ? "/register?invite=" + encodeURIComponent(invite)
                    : "/register"
                }
              >
                Create an account
              </Link>
            </>
          ) : (
            <Link href="/login">Back to sign in</Link>
          )}
        </footer>
      </div>
    </main>
  );
}
