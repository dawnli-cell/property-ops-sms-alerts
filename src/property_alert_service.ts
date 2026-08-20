import { createServer } from "node:http";
import { ZodError } from "zod";
import { InfraiError, sendSms } from "./infrai_sms";
import { decidePropertyAlert, propertyEventSchema } from "./property_alerts";

function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 32_768) reject(new Error("Request body is too large"));
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new SyntaxError("Request body must be JSON"));
      }
    });
    request.on("error", reject);
  });
}

const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method !== "POST" || request.url !== "/property-alerts") {
    response.writeHead(404).end(JSON.stringify({ error: "route_not_found" }));
    return;
  }

  try {
    const event = propertyEventSchema.parse(await readJson(request));
    const decision = decidePropertyAlert(event, new Date());
    if (decision.send === false) {
      response.writeHead(200).end(JSON.stringify({ status: "skipped", reason: decision.reason }));
      return;
    }

    const receipt = await sendSms({
      to: decision.to,
      body: decision.body,
      idempotency_key: decision.idempotencyKey,
    });
    response.writeHead(202).end(JSON.stringify({ status: "sent", message_id: receipt.message_id }));
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      response.writeHead(400).end(JSON.stringify({ error: "invalid_request" }));
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.writeHead(status).end(JSON.stringify({ error: error.message }));
      return;
    }
    response.writeHead(500).end(JSON.stringify({ error: "internal_error" }));
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Property alert service listening on http://localhost:${port}`));
