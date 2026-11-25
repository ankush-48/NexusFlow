import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "NexusFlow — Team workspace",
  description:
    "Plan projects, collaborate with your team, and automate the work in between.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
