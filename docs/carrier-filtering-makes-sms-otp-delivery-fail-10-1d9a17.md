# Carrier Filtering Makes SMS OTP Delivery Fail: 10-Minute Fintech Reset Controls

Short answer: SMS OTP delivery can fail under carrier filtering even when a password-reset code is valid. Treat the message as a constrained financial-control message, not as a generic notification. The least complex option is a registered sender identity, a consistent template, one approved delivery path per region, and a retry policy that records every attempt without repeatedly sending the same code. That reduces integration effort because the failure policy is designed before the provider API is wired in.

A ten-minute expiry does not make delivery reliable. It makes late delivery more damaging: a user who receives an expired code requests another one, and the system can create a small burst of near-identical traffic that looks suspicious to an intermediary. In a payment backend, I would measure the cost of that burst in support contacts, abandoned logins, duplicate messages, and fraud-review noise before discussing message rates.

## What does a failed reset message actually cost?

The visible bill is the message attempt. The dominant operational term is usually retention and reconciliation: how long the system must preserve request identifiers, template versions, route decisions, provider responses, delivery callbacks, and security events so that an investigator can explain what happened. Keeping that evidence costs storage and retention work; discarding it costs time when a customer says the code never arrived.

The useful change is to retain a compact, append-only event record rather than every transient request object. For each reset request, keep a keyed digest of the code, the creation and expiry times, destination country, sender class, template revision, route class, attempt number, and normalized outcome. Never store the code itself in an application log. Retain the security and delivery events for the period required by the organization's policy, and separate personally identifying destination data from the operational timeline where possible.

That is a deliberate trade. I stop keeping message bodies and raw phone numbers in routine diagnostics, but I keep enough identifiers to reconcile one request across the authentication service, messaging boundary, and carrier-facing result. When the message fails, the missing detail is privacy-preserving and still actionable.

## Why can SMS OTP delivery fail under carrier filtering?

A sender can pass local application validation and still be rejected later. Carrier filtering evaluates traffic patterns, sender identity, content, destination, and route context. US application-to-person traffic has registration and campaign requirements documented by the mobile ecosystem; European destinations add country-specific sender and anti-spam constraints rather than one universal rule.\\n+
The result is not always a clean rejection. Some failures appear as a provider-side error, some as a delayed delivery receipt, and some as no useful handset confirmation at all. A timeout is therefore an observation, not proof that the carrier rejected the message. The backend needs a state model that distinguishes accepted for delivery, delivered, expired, filtered or rejected when reported, and unknown.

The anti-fraud system also changes the traffic profile. One account requesting five codes in two minutes, many accounts targeting one number range, or a reset template that changes shape across attempts can be treated differently from a normal login flow. This is why blindly retrying a failed submission is dangerous: it increases load and can turn a temporary uncertainty into a recognizable abuse pattern.

No retry loop.

Auditability matters.

The event timeline should make a disputed reset reconstructable without guessing. At 09:00:00 the authentication service creates the challenge; at 09:00:01 the messaging boundary accepts the idempotency key; at 09:00:02 the route adapter records an external acknowledgement; at 09:00:12 a delivery report may arrive, or it may remain unknown. Those timestamps are illustrative states, not a delivery guarantee. The important point is that a later report updates the delivery event while leaving the original submission intact. Reconciliation can then see a late result instead of mistaking a second send for progress.

## The integration boundary should own the awkward parts

The authentication service should ask for a reset challenge; it should not know which sender registration, route, or regional encoding is selected. The messaging boundary should accept a stable command and return a durable correlation identifier. That interface lets the team change a route without changing password-reset semantics. It also gives reconciliation a single place to compare the intended event with provider acknowledgements and later delivery reports.

A small Go interface is enough to make the contract explicit. The important property is idempotency: the same reset request must not create a second valid challenge merely because a network call was retried.

```go
type ResetMessage struct {
	RequestID   string
	Destination string
	Country     string
	TemplateRev string
	ExpiresAt   time.Time
}

type DeliveryResult struct {
	CorrelationID string
	State         string
}

type Messenger interface {
	SendReset(ctx context.Context, msg ResetMessage, idemKey string) (DeliveryResult, error)
}
```

The implementation should persist the idempotency key before submitting work, then record the submission and response as separate events. If the client loses the response, a retry first checks the key and returns the original correlation identifier. That is an exactly-once mindset at the application boundary; it does not pretend that the external network provides exactly-once delivery.

A second control is the resend rule. Generate a new challenge only when policy allows it, invalidate the prior challenge explicitly, and apply a per-account and per-destination limit. A delivery timeout should enter an unknown state and trigger reconciliation or a controlled fallback, not an immediate loop. The user-facing response can remain deliberately vague so it does not reveal whether an account or phone number exists.

## Registration is part of the release, not a later ticket

Sender registration, template ownership, and route approval belong in deployment planning because they are integration dependencies. The release artifact should identify the sender class allowed in each destination, the exact reset-message template family, the responsible owner, and the evidence needed when a carrier or intermediary asks why the traffic exists. A content change that looks cosmetic to an application developer can be a material change to traffic classification.

The test matrix should include US and EU destinations, long and short phone-number formats, non-ASCII characters, repeated requests, an expired code, a provider timeout, a reported rejection, and a delayed delivery receipt. Test the event timeline as well as the handset result. A system that sends the right text but cannot prove which template and route produced it is still difficult to operate.

For regional decisions, compare integration effort rather than headline throughput: registration lead time, sender and template constraints, callback quality, idempotency support, regional coverage, audit export, and the amount of adapter code the team must own. Those criteria remain useful when the route changes. They also keep a team from mistaking a shared path for a guaranteed path.

## A practical decision rule for short-expiry authentication

Use SMS as one factor with a bounded challenge lifetime, explicit rate limits, and a recovery path. Before launch, answer five questions in writing: who owns sender registration; what does “accepted” mean at the integration boundary; how will unknown outcomes be reconciled; which events are retained for audit; and what does the user do after the ten-minute window closes?

The correct fallback is a product and risk decision, not an automatic second SMS route. Depending on account risk, it may be a verified alternate factor, a support review, or a fresh challenge after a cooldown. The fallback must preserve the same audit trail and must not let a user bypass the original anti-fraud controls by changing channels.

SMS is a poor fit for a high-assurance recovery path when the user has no reliable mobile coverage or the destination rules cannot be verified. In that case, a verified non-SMS factor or manual review is more appropriate, even though it adds integration and support work.

The limitation is structural: carrier policy is outside the authentication service's control. No application retry can make an unregistered sender legitimate or turn an unknown delivery result into proof of arrival.

For fintech systems, reliability is therefore a chain of contracts: sender legitimacy, content consistency, regional routing, bounded retries, and evidence that survives a disputed login. The message is only one event in that chain. **The cost worth controlling is not the individual send; it is the retained uncertainty around every send.**

## Further reading

- Amazon SES documentation: https://docs.aws.amazon.com/ses/latest/dg/Welcome.html
- Twilio US A2P 10DLC compliance documentation: https://www.twilio.com/docs/messaging/compliance/a2p-10dlc
- NIST Digital Identity Guidelines, SP 800-63B: https://pages.nist.gov/800-63-3/sp800-63b.html
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
