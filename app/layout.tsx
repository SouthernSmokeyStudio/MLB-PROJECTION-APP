import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MLB Projection App",
  description: "Southern Smokey Studio MLB Projection App"
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
