import { NextResponse } from 'next/server';
import { listDailyCheckinEnabledVendors } from '@/lib/daily-checkin';
import {
  getDailyCheckinTotalByDay,
  getTodayCheckinDayKey,
  listDailyCheckinRecordsByDay,
  listDailyCheckinSummaryByMonth,
  normalizeDetailDayKey,
  normalizeMonthKey,
  updateDailyCheckinAwardedUsd,
} from '@/lib/daily-checkin-history';

export const runtime = 'nodejs';

function firstDayOfMonth(monthKey: string): string {
  if (/^\d{4}-\d{2}$/.test(monthKey)) {
    return `${monthKey}-01`;
  }
  return `${getTodayCheckinDayKey().slice(0, 7)}-01`;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const month = normalizeMonthKey(url.searchParams.get('month'));
    const requestedDay = normalizeDetailDayKey(url.searchParams.get('day'));
    const day = requestedDay.startsWith(`${month}-`) ? requestedDay : firstDayOfMonth(month);

    const summary = listDailyCheckinSummaryByMonth(month);
    const details = listDailyCheckinRecordsByDay(day);
    const today = getTodayCheckinDayKey();
    const todayTotalUsd = getDailyCheckinTotalByDay(today);
    const dayTotalUsd = getDailyCheckinTotalByDay(day);
    const monthTotalUsd = summary.reduce((total, item) => total + item.totalAwardedUsd, 0);
    const enabledVendors = listDailyCheckinEnabledVendors();

    return NextResponse.json({
      ok: true,
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
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      dayKey?: unknown;
      vendorId?: unknown;
      awardedUsd?: unknown;
    };

    if (body.action !== 'set-awarded-usd') {
      return NextResponse.json(
        { ok: false, message: 'Unsupported action' },
        { status: 400 },
      );
    }

    const dayKey = String(body.dayKey || '').trim();
    const vendorId = Number(body.vendorId);
    const awardedUsd = Number(body.awardedUsd);

    if (!dayKey) {
      return NextResponse.json({ ok: false, message: 'dayKey 不能为空' }, { status: 400 });
    }
    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      return NextResponse.json({ ok: false, message: 'vendorId 非法' }, { status: 400 });
    }
    if (!Number.isFinite(awardedUsd) || awardedUsd < 0) {
      return NextResponse.json({ ok: false, message: 'awardedUsd 非法' }, { status: 400 });
    }

    const updated = updateDailyCheckinAwardedUsd({
      dayKey,
      vendorId,
      awardedUsd,
    });

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      record: updated,
      dayTotalUsd: getDailyCheckinTotalByDay(updated.dayKey),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
