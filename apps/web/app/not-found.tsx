import Link from "next/link";

export default function NotFound() {
  return (
    <main className="public">
      <h1>Page not found</h1>
      <Link className="button primary" href="/">
        Return to NexusFlow
      </Link>
    </main>
  );
}
