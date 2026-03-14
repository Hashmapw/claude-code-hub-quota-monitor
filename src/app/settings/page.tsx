export const dynamic = "force-dynamic";

import { SystemSettingsPage } from "@/components/system-settings-page";
import { listPushDeliveryRecords } from "@/lib/push-history";
import { getPushManagementState } from "@/lib/push-management";
import { getSystemSettings } from "@/lib/system-settings";

export default async function SettingsRoutePage() {
  const settings = getSystemSettings();
  const pushManagement = getPushManagementState();
  const pushRecords = listPushDeliveryRecords();
  return (
    <SystemSettingsPage
      initialSettings={settings}
      initialPushManagement={pushManagement}
      initialPushRecords={pushRecords}
    />
  );
}
