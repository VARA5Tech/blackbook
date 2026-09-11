import type { Metadata, Viewport } from "next";
import { Fraunces, Geist } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

// A quiet transitional serif for client names and page titles.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  axes: ["SOFT", "WONK", "opsz"],
});

/**
 * Icons, manifest and social card come from the supplied brand pack, declared
 * through Next's metadata API rather than hand-written head tags so the paths
 * are checked at build time.
 */
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "Blackbook",
    template: "%s · Blackbook",
  },
  description: "People. Journeys. Relationships.",
  applicationName: "Blackbook",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "Blackbook",
    description: "People. Journeys. Relationships.",
    type: "website",
    images: [{ url: "/brand/blackbook-og-dark.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
  // Internal system: keep it out of any index that can reach it.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#090909",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("font-sans", geist.variable, fraunces.variable)}
    >
      <head>
        {/* Applies the stored theme before paint so the page never flashes. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
