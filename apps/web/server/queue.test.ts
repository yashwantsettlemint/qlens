import { describe, expect, it, vi, beforeEach } from "vitest";

const sendToQueue = vi.fn();
const assertQueue = vi.fn();
const createChannel = vi.fn(async () => ({ sendToQueue, assertQueue, on: vi.fn() }));
const connect = vi.fn(async () => ({ createChannel, on: vi.fn() }));

vi.mock("amqplib", () => ({ default: { connect } }));

const job = {
  type: "payment-received" as const,
  payload: { customer_email: "a@b.com", customer_name: "A", invoice_number: "INV-1", amount: 10, paid_at: "2024-01-01" },
};

beforeEach(() => {
  vi.resetModules();
  sendToQueue.mockClear();
  assertQueue.mockClear();
  createChannel.mockClear();
  connect.mockReset().mockImplementation(async () => ({ createChannel, on: vi.fn() }));
});

describe("publishNotification", () => {
  it("connects, declares the durable queue + DLQ, and publishes a persistent message", async () => {
    const { publishNotification } = await import("./queue");
    await publishNotification(job);
    expect(connect).toHaveBeenCalled();
    expect(assertQueue).toHaveBeenCalledWith("notify.outbound.dlq", { durable: true });
    expect(assertQueue).toHaveBeenCalledWith(
      "notify.outbound",
      expect.objectContaining({ durable: true, arguments: expect.objectContaining({ "x-dead-letter-exchange": "" }) }),
    );
    expect(sendToQueue).toHaveBeenCalledTimes(1);
    const [queueName, buf, opts] = sendToQueue.mock.calls[0];
    expect(queueName).toBe("notify.outbound");
    expect(opts).toEqual({ persistent: true });
    expect(JSON.parse(buf.toString())).toMatchObject({ type: "payment-received" });
  });

  it("swallows a connection failure instead of throwing", async () => {
    connect.mockReset().mockRejectedValue(new Error("econnrefused"));
    const { publishNotification } = await import("./queue");
    await expect(publishNotification(job)).resolves.toBeUndefined();
    expect(sendToQueue).not.toHaveBeenCalled();
  });
});
