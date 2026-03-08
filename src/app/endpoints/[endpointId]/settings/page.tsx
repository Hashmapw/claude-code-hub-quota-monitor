import { notFound } from 'next/navigation';
import { EndpointSettingsPage } from '@/components/endpoint-settings-page';
import { listVendorOptions } from '@/lib/vendor-settings';
import { listAvailableVendorTypes, listVendorDefinitions } from '@/lib/vendor-definitions';
import { getQuotaRecordByEndpointId } from '@/lib/quota/service';

type PageProps = {
  params: Promise<{ endpointId: string }>;
};

export default async function ProviderSettingsRoute({ params }: PageProps) {
  const { endpointId: endpointIdRaw } = await params;
  const endpointId = Number(endpointIdRaw);

  if (!Number.isInteger(endpointId) || endpointId <= 0) {
    notFound();
  }

  const record = await getQuotaRecordByEndpointId(endpointId);
  if (!record) {
    notFound();
  }

  return (
    <EndpointSettingsPage
      initialData={{
        record,
        meta: {
          vendorTypes: listAvailableVendorTypes(),
          vendorDefinitions: listVendorDefinitions().map((d) => ({
            vendorType: d.vendorType,
            displayName: d.displayName,
          })),
          endpoints: listVendorOptions(),
        },
      }}
    />
  );
}
