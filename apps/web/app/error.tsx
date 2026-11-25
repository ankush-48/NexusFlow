"use client";

import Link from "next/link";
import { Brand } from "../components/public";
import { Button } from "../components/ui/button";

export default function AppError({ reset }: { reset: () => void }) {
  return (
    <main className="loading-shell">
      <Brand />
      <h1>Something went wrong</h1>
      <div className="inline">
        <Button className="primary" onClick={reset}>
          Try again
        </Button>
        <Link className="button" href="/projects">
          Open projects
        </Link>
      </div>
    </main>
  );
}
