import {
  getDashboardStats,
  getAppointments,
  getPatients,
  getMessages,
  getActiveMedications,
} from '../actions';
import PanelClient from './PanelClient';

export const dynamic = 'force-dynamic';

export default async function PanelPage() {
  const [stats, appointments, patients, messages, medications] =
    await Promise.all([
      getDashboardStats(),
      getAppointments(),
      getPatients(),
      getMessages(),
      getActiveMedications(),
    ]);

  return (
    <PanelClient
      stats={stats}
      appointments={appointments as any}
      patients={patients as any}
      messages={messages as any}
      medications={medications as any}
    />
  );
}
