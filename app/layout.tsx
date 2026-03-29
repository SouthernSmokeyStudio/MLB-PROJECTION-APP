import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Southern Smokey Studio | MLB Projection App",
  description: "Engine-first MLB dashboard built on verified Southern Smokey Studio projection layers."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
