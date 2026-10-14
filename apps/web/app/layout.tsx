import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'DropDesk', description: 'Delivery operations for Nigerian businesses' };
export const viewport: Viewport = { themeColor: '#F7F8F7', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG">
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@500&display=swap" />
      </head>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[520px] bg-page-mesh" />
        {children}
      </body>
    </html>
  );
}
