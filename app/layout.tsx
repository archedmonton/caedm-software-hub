import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { DeveloperContactProvider } from "@/components/hub/developer-contact";
import { developer } from "@/lib/developer";
export const metadata: Metadata = {
  title: { default: "CAEDM Software Hub", template: "%s · CAEDM Software Hub" },
  description:
    "Software, renewals, and financial stewardship for the Catholic Archdiocese of Edmonton.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={GeistSans.className}>
        <DeveloperContactProvider
          value={{
            name: developer.name,
            email: developer.email,
            title: developer.title,
          }}
        >
          {children}
        </DeveloperContactProvider>
      </body>
    </html>
  );
}
