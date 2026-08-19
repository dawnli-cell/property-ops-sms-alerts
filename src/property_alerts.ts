import { z } from "zod";

export const propertyEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("maintenance_request"),
    requestId: z.string().min(1),
    tenantPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    unit: z.string().min(1),
    issue: z.string().min(1).max(120),
    priority: z.enum(["routine", "urgent"]),
  }),
  z.object({
    kind: z.literal("tenant_document"),
    documentId: z.string().min(1),
    tenantPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    tenantName: z.string().min(1),
    documentName: z.string().min(1).max(80),
    status: z.enum(["received", "missing"]),
  }),
  z.object({
    kind: z.literal("inspection_reminder"),
    inspectionId: z.string().min(1),
    tenantPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    unit: z.string().min(1),
    scheduledAt: z.string().datetime({ offset: true }),
  }),
]);

export type PropertyEvent = z.infer<typeof propertyEventSchema>;

export type AlertDecision =
  | { send: false; reason: string }
  | { send: true; to: string; body: string; idempotencyKey: string };

export function decidePropertyAlert(event: PropertyEvent, now: Date): AlertDecision {
  if (event.kind === "maintenance_request") {
    if (event.priority === "routine") return { send: false, reason: "routine_request" };
    return {
      send: true,
      to: event.tenantPhone,
      body: `Maintenance update for unit ${event.unit}: urgent request ${event.requestId} (${event.issue}) is queued for dispatch.`,
      idempotencyKey: `maintenance:${event.requestId}:urgent`,
    };
  }

  if (event.kind === "tenant_document") {
    if (event.status === "received") return { send: false, reason: "document_received" };
    return {
      send: true,
      to: event.tenantPhone,
      body: `Hi ${event.tenantName}, your property file still needs ${event.documentName}. Please contact the management office.`,
      idempotencyKey: `document:${event.documentId}:missing`,
    };
  }

  const scheduledAt = new Date(event.scheduledAt);
  const hoursUntilInspection = (scheduledAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursUntilInspection < 0 || hoursUntilInspection > 48) {
    return { send: false, reason: "outside_reminder_window" };
  }
  return {
    send: true,
    to: event.tenantPhone,
    body: `Inspection reminder for unit ${event.unit}: access is scheduled for ${scheduledAt.toISOString()}.`,
    idempotencyKey: `inspection:${event.inspectionId}:48h`,
  };
}
