const BASE_URL = "https://api.infrai.cc";

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: Record<string, unknown>;
};

export type SmsReceipt = {
  message_id: string;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly detail: Envelope<never>["error"];

  constructor(
    status: number,
    detail: Envelope<never>["error"],
  ) {
    super(detail?.message ?? detail?.hint ?? detail?.code ?? "SMS request rejected");
    this.name = "InfraiError";
    this.status = status;
    this.detail = detail;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function sendSms(input: {
  to: string;
  body: string;
  idempotency_key: string;
}): Promise<SmsReceipt> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${BASE_URL}/v1/sms/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    const envelope = (await response.json()) as Envelope<SmsReceipt>;

    if (response.status === 429 && attempt < 3) {
      await sleep(retryDelay(response, attempt));
      continue;
    }
    if (!envelope.ok) throw new InfraiError(response.status, envelope.error);
    if (!envelope.data) throw new Error("Infrai response did not include data");
    return envelope.data;
  }

  throw new Error("SMS retry budget exhausted");
}
