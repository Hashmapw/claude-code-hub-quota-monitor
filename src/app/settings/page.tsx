export const dynamic = 'force-dynamic';

import { SystemSettingsPage } from '@/components/system-settings-page';
import { getSystemSettings } from '@/lib/system-settings';

export default async function SettingsRoutePage() {
  const settings = getSystemSettings();
  return <SystemSettingsPage initialSettings={settings} />;
}
