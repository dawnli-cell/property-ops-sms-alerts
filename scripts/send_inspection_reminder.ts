import { sendSms } from "../src/infrai_sms";
import { decidePropertyAlert, propertyEventSchema } from "../src/property_alerts";

const tenantPhone = process.env.DEMO_TENANT_PHONE;
if (!tenantPhone) throw new Error("DEMO_TENANT_PHONE is required");

const now = new Date();
const event = propertyEventSchema.parse({
  kind: "inspection_reminder",
  inspectionId: `demo-${now.toISOString().slice(0, 10)}`,
  tenantPhone,
  unit: "4B",
  scheduledAt: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
});
const decision = decidePropertyAlert(event, now);
if (decision.send === false) throw new Error(`Reminder skipped: ${decision.reason}`);

const receipt = await sendSms({
  to: decision.to,
  body: decision.body,
  idempotency_key: decision.idempotencyKey,
});
console.log(JSON.stringify({ status: "sent", message_id: receipt.message_id }, null, 2));
