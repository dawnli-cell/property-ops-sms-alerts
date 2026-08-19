import { describe, expect, it } from "vitest";
import { decidePropertyAlert, propertyEventSchema } from "../src/property_alerts";

describe("inspection reminder decision", () => {
  const now = new Date("2026-08-19T08:00:00.000Z");

  it("sends inside 48 hours and skips a later inspection", () => {
    const base = {
      kind: "inspection_reminder" as const,
      inspectionId: "inspect-204",
      tenantPhone: "+15551234567",
      unit: "4B",
    };
    const dueSoon = propertyEventSchema.parse({
      ...base,
      scheduledAt: "2026-08-20T08:00:00.000Z",
    });
    const dueLater = propertyEventSchema.parse({
      ...base,
      scheduledAt: "2026-08-23T08:00:00.000Z",
    });

    expect(decidePropertyAlert(dueSoon, now)).toMatchObject({
      send: true,
      idempotencyKey: "inspection:inspect-204:48h",
    });
    expect(decidePropertyAlert(dueLater, now)).toEqual({
      send: false,
      reason: "outside_reminder_window",
    });
  });
});
