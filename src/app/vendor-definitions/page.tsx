export const dynamic = 'force-dynamic';

import { VendorDefinitionsPage } from '@/components/vendor-definitions-page';
import { listEndpoints } from '@/lib/db';
import { listVendorDefinitions } from '@/lib/vendor-definitions';
import { listVendorSettings } from '@/lib/vendor-settings';

export default async function VendorDefinitionsRoutePage() {
  let endpointTotal = 0;
  try {
    endpointTotal = (await listEndpoints()).length;
  } catch {
    endpointTotal = 0;
  }
  const vendors = listVendorSettings();
  const definitions = listVendorDefinitions();

  return (
    <VendorDefinitionsPage
      initialDefinitions={definitions}
      stats={{
        endpointTotal,
        vendorTotal: vendors.length,
        vendorTypeTotal: definitions.length,
      }}
    />
  );
}
