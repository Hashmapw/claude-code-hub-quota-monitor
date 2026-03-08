export const dynamic = 'force-dynamic';

import { MonitorLoginPage } from '@/components/monitor-login-page';
import { DEFAULT_SYSTEM_DISPLAY_NAME } from '@/lib/app-identity';
import { isMonitorAuthConfigured } from '@/lib/monitor-auth-shared';
import { getSystemSettings } from '@/lib/system-settings';

export default function LoginRoutePage() {
  const settings = getSystemSettings();
  const siteTitle = settings.systemDisplayName || DEFAULT_SYSTEM_DISPLAY_NAME;

  return (
    <MonitorLoginPage
      siteTitle={siteTitle}
      authConfigured={isMonitorAuthConfigured()}
    />
  );
}
