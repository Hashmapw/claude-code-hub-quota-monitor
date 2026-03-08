export const dynamic = 'force-dynamic';

import { DailyCheckinPage } from '@/components/daily-checkin-page';
import { listDailyCheckinEnabledVendors } from '@/lib/daily-checkin';
import {
  getDailyCheckinTotalByDay,
  getTodayCheckinDayKey,
  listDailyCheckinRecordsByDay,
  listDailyCheckinSummaryByMonth,
} from '@/lib/daily-checkin-history';

function buildInitialData() {
  const today = getTodayCheckinDayKey();
  const month = today.slice(0, 7);
  const day = today;
  const summary = listDailyCheckinSummaryByMonth(month);
  const details = listDailyCheckinRecordsByDay(day);
  const todayTotalUsd = getDailyCheckinTotalByDay(today);
  const dayTotalUsd = getDailyCheckinTotalByDay(day);
  const monthTotalUsd = summary.reduce((total, item) => total + item.totalAwardedUsd, 0);
  const enabledVendors = listDailyCheckinEnabledVendors();

  return {
    ok: true as const,
    generatedAt: new Date().toISOString(),
    month,
    day,
    today,
    todayTotalUsd,
    dayTotalUsd,
    monthTotalUsd,
    enabledVendorCount: enabledVendors.length,
    enabledVendors,
    summary,
    details,
  };
}

export default function DailyCheckinRoutePage() {
  return <DailyCheckinPage initialData={buildInitialData()} />;
}
