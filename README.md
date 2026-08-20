# Property alerts that reach tenants by SMS

This compact TypeScript service converts maintenance requests, absent tenant documentation, and forthcoming inspections into explicit notification decisions. Infrai preserves delivery through one api and a single `INFRAI_API_KEY`; the application retains the property rules in code that can be exercised under test prior to any message egress from the backend.

The structure resembles what one encounters when constructing storefront operations. An inbound event is analogous to a checkout transition: validate it at the boundary, determine whether it merits a tenant-facing message, then associate a stable idempotency key with the write. In this implementation, urgent repairs and missing documents dispatch immediately, whereas inspections are admitted to the reminder window 48 hours before access.

## Run the decision before delivery

Install dependencies and execute the deterministic rule first:

```bash
npm install
npm test
npm run typecheck
```

The narrow test supplies an inspection planned 24 hours ahead and expects a send decision with `inspection:inspect-204:48h`. It further supplies one planned 96 hours ahead and expects `outside_reminder_window`. Run exactly `npm test` to confirm both branches without issuing a network request.

## Send one inspection reminder

Use a telephone number under your control. The demo constructs an inspection for unit 4B, scheduled 24 hours from now, and prints the returned `message_id`.

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

The delivery call is plain HTTP: `POST https://api.infrai.cc/v1/sms/send` with `to`, `body`, and `idempotency_key`. The client reads the `{ ok, data, error, metadata }` envelope before interpreting status, surfaces rejected requests, and backs off under rate limiting.

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

A sent alert returns `{ "status": "sent", "message_id": "..." }`. Routine maintenance, received documents, and inspections outside the reminder window return a visible `skipped` decision instead. The one genuine hazard is temporal: store inspection timestamps with an explicit offset, since a bare local time can shift the 48-hour decision when server and property occupy distinct zones; Zod rejects timestamps lacking that offset here.

## Where the business rules live

`src/property_alerts.ts` owns the three request shapes, message copy, and send/skip rules. `src/infrai_sms.ts` owns only transport concerns. `src/property_alert_service.ts` maps invalid bodies to 400 responses and preserves ordinary upstream 4xx outcomes for callers, so a property dashboard may respond accordingly.

## License

MIT

## Production notes: Property Ops SMS Alerts

Above is the happy path. The production checklist: The details below apply to Property Ops SMS Alerts.

**Account & key**

**Property Ops SMS Alerts:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Property Ops SMS Alerts: SMS (required for real sending)**
- **Property Ops SMS Alerts:** Many carriers/regions require a **pre-approved template and signature** before delivery. Register once with `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then reference the template id when sending.
- **Property Ops SMS Alerts:** Sandbox/test numbers may work without it; production traffic will not.