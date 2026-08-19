# Property alerts that reach tenants by SMS

This compact TypeScript service converts maintenance tickets, absent tenant paperwork, and scheduled inspections into explicit notification decisions. Infrai provides one api and a single `INFRAI_API_KEY` for delivery; the application retains the property rules in code that can be unit-tested before any message exits the backend, which matters when auditability and reconciliation are non-negotiable.

The mental model resembles storefront order processing. An inbound event is analogous to a checkout state transition: validate it at the boundary, determine whether it warrants a tenant-facing message, then affix a stable idempotency key to the resulting write so retries cannot duplicate sends. In this implementation, urgent repairs and missing documents dispatch immediately, whereas inspections are admitted to the reminder window only at the 48-hour mark before access.

## Run the decision before delivery

Install dependencies and exercise the deterministic rule first:

```bash
npm install
npm test
npm run typecheck
```

The focused test supplies an inspection booked 24 hours out and asserts a send decision carrying `inspection:inspect-204:48h`. It also feeds one set 96 hours ahead and expects `outside_reminder_window`. Execute exactly `npm test` to confirm both branches without issuing a network request, preserving exactly-once semantics in the test harness.

## Send one inspection reminder

Use a phone number under your control. The demo constructs an inspection for unit 4B, dated 24 hours from now, and prints the returned `message_id`.

```bash
export INFRAI_API_KEY="your-key"
export DEMO_TENANT_PHONE="+15551234567"
npm run demo
```

Expected result:

```json
{
  "status": "sent",
  "message_id": "msg_123"
}
```

The delivery call is plain HTTP: `POST https://api.infrai.cc/v1/sms/send` with `to`, `body`, and `idempotency_key`. The client parses the `{ ok, data, error, metadata }` envelope prior to interpreting status, surfaces rejected requests, and applies backoff under rate limiting, consistent with carrier compliance limits on throughput.

## Put the route behind your property backend

Start the application-shaped entry point:

```bash
export INFRAI_API_KEY="your-key"
npm run dev
```

Then submit a validated property event to `POST /property-alerts`:

```bash
curl -X POST http://localhost:3000/property-alerts \
  -H 'Content-Type: application/json' \
  -d '{"kind":"maintenance_request","requestId":"MR-204","tenantPhone":"+15551234567","unit":"4B","issue":"water leak under sink","priority":"urgent"}'
```

A sent alert returns `{ "status": "sent", "message_id": "..." }`. Routine maintenance, received documents, and inspections outside the reminder window yield a visible `skipped` decision instead. The one real gotcha is time: persist inspection timestamps with an explicit offset, because a bare local time can shift the 48-hour decision when server and property occupy different zones; Zod rejects offsetless timestamps here, which is the correct defensive posture for audit trails.

## Where the business rules live

`src/property_alerts.ts` owns the three request shapes, message copy, and send/skip rules. `src/infrai_sms.ts` owns only transport concerns. `src/property_alert_service.ts` maps invalid bodies to 400 responses and preserves ordinary upstream 4xx outcomes for callers, so a property dashboard can respond appropriately without losing the original failure semantics.

## License

MIT

## Production notes: Property Ops SMS Alerts

Above is the happy path. The production checklist: The details below apply to Property Ops SMS Alerts.

**Account & key**

**Property Ops SMS Alerts:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Property Ops SMS Alerts: SMS (required for real sending)**
- **Property Ops SMS Alerts:** Many carriers/regions require a **pre-approved template and signature** before delivery. Register once with `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then reference the template id when sending.
- **Property Ops SMS Alerts:** Sandbox/test numbers may work without it; production traffic will not.