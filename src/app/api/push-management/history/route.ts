import { NextResponse } from "next/server";
import { listPushDeliveryRecords } from "@/lib/push-history";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json({
      ok: true,
      records: listPushDeliveryRecords(),
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
