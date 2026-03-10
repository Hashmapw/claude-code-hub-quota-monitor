export const dynamic = 'force-dynamic';

import { VendorBalanceHistoryPage } from '@/components/vendor-balance-history-page';
import { getVendorBalanceHistoryPayload } from '@/lib/vendor-balance-history';

async function buildInitialData() {
  return {
    ok: true as const,
    ...(await getVendorBalanceHistoryPayload()),
  };
}

export default async function VendorBalanceHistoryRoutePage() {
  return <VendorBalanceHistoryPage initialData={await buildInitialData()} />;
}
