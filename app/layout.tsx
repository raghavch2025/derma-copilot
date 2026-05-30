import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Derma-Copilot',
  description: 'AI-Powered Clinic Co-Pilot for Dermatology Clinics',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          backgroundColor: '#f8fafc',
          color: '#0f172a',
        }}
      >
        {children}
      </body>
    </html>
  );
}
