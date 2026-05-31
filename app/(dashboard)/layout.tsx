import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Clinic Panel · Derma-Copilot',
  description: 'Clinic assistant dashboard',
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
