import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Navis",
  description: "View your document and explore Navis tools.",
};

export default function DocumentRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
