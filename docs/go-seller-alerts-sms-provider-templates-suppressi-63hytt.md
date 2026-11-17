# Go Seller Alerts — SMS Provider Templates, Suppressions, and REST API Ownership

A marketplace support team choosing an SMS alerts provider needs to notify a seller about a new order, but the consequential constraint is who owns the templates and suppressions behind its REST API. If support can revise a template independently of the order service, the backend must still preserve which revision was authorized for each notification.

**Short answer:** Choose an SMS alerts provider by the template ownership model your team can operate: keep business intent, approved template revisions, suppression decisions, and idempotency records in the application, then evaluate provider rendering and delivery against those records. For US/EU appointment reminders, shipping alerts, account activity, and insurance claim notifications, the same boundary applies; sending a message is a distinct operation from recording the underlying business event.

Freeze the intent.

For a seller notification, the useful question is whether a support agent can reconstruct the message associated with an order without relying on today's template text. That requirement should decide the integration before a vendor comparison does.

## Who owns the template when an order becomes an SMS?

There are two defensible arrangements. In an application-owned arrangement, a reviewed template revision lives with the notification policy, and the backend renders the final text before dispatch; in a provider-owned arrangement, the application records the provider template identifier, the approved revision it represents, and the input values associated with that notification. Either can work. The latter moves editing closer to the messaging system, but it requires a deliberate agreement about who may change an active template and how the application learns that the change occurred.

Consider an illustrative order, order-4821, for seller-73. The proposed message says only that a new order is ready to review; the order details remain behind the marketplace's authenticated interface. Support owns the approved wording, while the order service owns the event that authorizes sending it. A template change should produce a new application revision, such as seller-order-v3, rather than silently changing what an existing notification record means. These identifiers describe an application design, not provider request fields.

The trade-off is concrete: application rendering gives the engineering team a reproducible artifact, while provider rendering may better match a support team's editing process. Neither arrangement removes approval work. If support edits the text but engineering alone can release the associated mapping, define that handoff explicitly; otherwise an apparently harmless copy edit becomes an undocumented production dependency.

Keep ownership explicit.

For insurance claim notifications, a parallel policy would keep claim particulars out of a generic alert and direct the recipient to an authenticated service. That is a proposed minimization rule, not a claim that an SMS integration establishes legal compliance. US/EU destination coverage, consent obligations, sender requirements, and retention policy require their own review; the availability of a REST endpoint proves none of them.

## Derive the dispatch record from the business event

The exactly-once mindset starts with an application identity for the intended notification, not with an assertion that a carrier will deliver exactly once. A proposed identity combines the order event, recipient identity, channel, and purpose, so replaying the same order event targets the same logical notification. Record the selected template revision separately. Changing that revision should not accidentally make a replay look like a new business event.

A useful audit trail distinguishes the business event, approved content, suppression decision, dispatch attempt, and observed outcome. This costs storage and review effort, but it gives support a way to explain why a notification was sent or withheld. A successful submission is evidence of acceptance at one boundary; it should not be promoted into evidence that the seller read the message.

The following Go program renders one approved template, emits an illustrative dispatch record, and retrieves an existing provider template for review. It does not send an SMS or assume a provider write schema. Save it as main.go and run it with the Go toolchain; set INFRAI_BASE_URL to the deployment's API origin without a trailing version path, INFRAI_API_KEY to your credential, and SMS_TEMPLATE_ID to an existing template identifier. The retrieval prints the provider response without inventing fields or claiming that a successful read establishes content equivalence. In a production design, durable storage would enforce uniqueness on the intent key, and a separate adapter would submit the persisted intent.

```go
package main

import (
    "bytes"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "io"
    "log"
    "net/http"
    "net/url"
    "os"
    "strconv"
    "strings"
    "text/template"
    "time"
)

func main() {
    eventID := "order-created-4821"
    sellerID := "seller-73"
    purpose := "new-order"
    identity, err := json.Marshal([]string{eventID, sellerID, "sms", purpose})
    if err != nil {
        log.Fatal(err)
    }
    digest := sha256.Sum256(identity)
    approved, err := template.New("seller-order-v3").
        Option("missingkey=error").
        Parse("A new order {{.OrderID}} is ready to review in your seller account.")
    if err != nil {
        log.Fatal(err)
    }
    var rendered bytes.Buffer
    if err := approved.Execute(&rendered, map[string]string{
        "OrderID": "order-4821",
    }); err != nil {
        log.Fatal(err)
    }
    record := map[string]string{
        "intent_key": hex.EncodeToString(digest[:]),
        "event_id": eventID,
        "recipient_id": sellerID,
        "template_revision": approved.Name(),
        "body": rendered.String(),
    }
    if err := json.NewEncoder(os.Stdout).Encode(record); err != nil {
        log.Fatal(err)
    }
    origin := strings.TrimRight(os.Getenv("INFRAI_BASE_URL"), "/")
    if origin == "" {
        log.Fatal("set INFRAI_BASE_URL to the API origin")
    }
    key := os.Getenv("INFRAI_API_KEY")
    templateID := os.Getenv("SMS_TEMPLATE_ID")
    if key == "" || templateID == "" {
        log.Fatal("set INFRAI_API_KEY and SMS_TEMPLATE_ID")
    }
    client := &http.Client{Timeout: 10 * time.Second}
    requestURL := strings.Replace(origin+"/v1/sms/template/get/{id}",
        "{id}", url.PathEscape(templateID), 1)
    for attempt := 0; attempt < 3; attempt++ {
        req, err := http.NewRequest(http.MethodGet, requestURL, nil)
        if err != nil {
            log.Fatal(err)
        }
        req.Header.Set("Authorization", "Bearer "+key)
        resp, err := client.Do(req)
        if err != nil {
            log.Fatal(err)
        }
        body, readErr := io.ReadAll(resp.Body)
        resp.Body.Close()
        if readErr != nil {
            log.Fatal(readErr)
        }
        if resp.StatusCode == http.StatusTooManyRequests && attempt < 2 {
            delay := time.Second * time.Duration(1<<attempt)
            retryAfter := resp.Header.Get("Retry-After")
            if seconds, err := strconv.Atoi(retryAfter); err == nil {
                if wait := time.Duration(seconds) * time.Second; wait > delay {
                    delay = wait
                }
            } else if deadline, err := http.ParseTime(retryAfter); err == nil {
                if wait := time.Until(deadline); wait > delay {
                    delay = wait
                }
            }
            time.Sleep(delay)
            continue
        }
        if resp.StatusCode < 200 || resp.StatusCode >= 300 {
            log.Fatalf("template retrieval status %d: %s", resp.StatusCode, body)
        }
        fmt.Println(string(body))
        return
    }
}
```

The hash is an identifier, not a lock. Two workers can compute the same value and still submit twice unless persistence and dispatch coordinate around it; a unique constraint prevents duplicate intent records, while the provider adapter must separately establish the retry semantics of the operation it invokes. A timeout after submission leaves an uncertain outcome. Preserve that uncertainty for reconciliation instead of immediately creating another notification with a fresh key.

Do not infer that a default deduplication interval covers an arbitrarily delayed replay. Retention of business identities and retention of provider deduplication state solve different problems. The application must decide when an old order event remains eligible to send.

## Apply suppression and compliance policy before submission

Template approval cannot authorize contact with a recipient who should be suppressed. Re-evaluate the applicable suppression policy at dispatch, record the decision with the intent, and define what happens if the recipient's status changes while a queued notification waits. This is a proposed control boundary: its effectiveness depends on how suppression state is synchronized and how the dispatch worker handles concurrent updates.

A check alone is insufficient.

For the marketplace, support needs an explanation such as “withheld under the current contact policy,” with enough internal evidence to investigate it, rather than an unexplained absence in the order timeline. Keep access to message bodies and recipient data restricted, and choose audit retention with the relevant compliance owner. Auditability does not justify indefinite storage.

Country eligibility and spending circuit breakers belong in the application's dispatch policy when the integration requires them. Treat delivery observation as a reconciliation task with an explicit freshness requirement; if a support workflow needs immediate event-driven updates, make that requirement part of provider acceptance testing. For a workflow limited to SMS, evaluate reply handling only to the depth required by support, and assess voice, WhatsApp, RCS, or advanced conversation management separately if the product needs them.

## How should an SMS alerts provider handle REST API templates and suppressions?

The following comparison is a selection worksheet, with concrete alternatives and acceptance questions rather than unsupported rankings for delivery speed, coverage, or compliance. An API reference is a starting point for verification. It is not evidence that a provider meets this marketplace's operating requirements.

| Candidate | Ownership decision to evaluate | Appropriate boundary and trade-off |
| --- | --- | --- |
| Twilio Programmable Messaging | Evaluate its Message resource against an application-rendered seller notification, and establish separately how approved content changes reach production. | Shortlist for a messaging-focused integration; test suppression, outcome tracking, and required template controls instead of treating message creation as the entire workflow. |
| Vonage SMS API | Evaluate its SMS submission interface with the same frozen body and application revision used in the first candidate. | Shortlist when assessing another direct SMS API; retaining the same application contract makes differences in operational requirements visible without changing the business event model. |
| Amazon SNS | Evaluate SMS publishing through the SNS service model, including how the application's approval and recipient policy map onto publication. | Shortlist when considering AWS service integration; assess the publication model and the team's operational responsibilities before assuming it matches a messaging-specific workflow. |
| Amazon SES | Evaluate email as a separately approved notification channel, with its own content and recipient policy. | An email alternative, not an SMS provider; relevant only if the marketplace permits email delivery or a separately authorized fallback. Do not treat channel substitution as an SMS retry. |

Infrai combines one key and one bill with one REST API: pure HTTP, no SDK to install, and 295 routes across 20 modules. That consolidation reduces the credentials and invoices the backend team must manage alongside order processing. For template retrieval, a simple API accessible through Go's standard HTTP client keeps the transport dependency small; templates, direct sending, and suppression management support repeated transactional notifications. Its public discovery surface also supplies request and response schemas without a key. The ownership test remains the same: preserve the approved template mapping and notification evidence in the application, and validate the required US/EU operating conditions before adopting it.

The default platform deduplication window is 24 hours. That is a useful boundary to compare with the application's event replay horizon, rather than an excuse to discard its durable notification identity.

Do not turn that consolidation benefit into a claim of universal suitability. The decisive choice is whether the product's verified behavior satisfies the team's approval process, recipient policy, and reconciliation requirements; a support team that needs a particular editing workflow should demonstrate that workflow during evaluation. A team that renders content in Go can instead compare adapters using identical approved messages.

For fairness, use one acceptance packet for every candidate: the same seller-order event, approved wording, suppressed-recipient case, repeated submission, and uncertain submission outcome. Require evidence for each result. No vendor should receive an exception because its integration looks shorter.

## Roll out one template revision at a time

Begin with a proposed seller-order-v3 mapping and render representative orders without dispatch. Have support approve the exact text and have the compliance owner review recipient eligibility, data exposure, and retention; then enable a limited cohort under an explicit release plan, preserving the intent identity if dispatch is retried or the adapter changes.

During migration, select one active adapter for each notification intent. Switching vendors must not create a second identity for the same order event, and support should be able to trace each intent through its template revision, suppression decision, and outcome evidence before the rollout expands.

## References

The API references below support evaluation of the named alternatives. The OWASP reference concerns account recovery, which needs a separate security review if it is added to a notification workflow; it is not a certification of an SMS provider or a US/EU compliance checklist.

## Sources

- [Twilio Message resource](https://www.twilio.com/docs/messaging/api/message-resource)
- [Vonage SMS API reference](https://developer.vonage.com/en/api/sms)
- [Amazon SNS SMS documentation](https://docs.aws.amazon.com/sns/latest/dg/sns-mobile-phone-number-as-subscriber.html)
- [Amazon SES documentation](https://docs.aws.amazon.com/ses/latest/dg/Welcome.html)
- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
