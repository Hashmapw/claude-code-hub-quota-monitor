export const dynamic = 'force-dynamic';

import { VendorBalanceHistoryPage } from '@/components/vendor-balance-history-page';
import { getVendorBalanceHistoryPayload } from '@/lib/vendor-balance-history';

function buildInitialData() {
  return {
    ok: true as const,
    ...getVendorBalanceHistoryPayload(),
  };
}

export default function VendorBalanceHistoryRoutePage() {
  return <VendorBalanceHistoryPage initialData={buildInitialData()} />;
}
