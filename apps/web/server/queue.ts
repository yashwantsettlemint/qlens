/**
 * Outbound notification publisher — durable delivery over the RabbitMQ that
 * already runs in infra/docker-compose.yml for ocr-service's bulk upload
 * (services/ocr-service/app/bulk.py). Direct Node analog of that file's
 * connect/channel pattern, using amqplib (aio-pika's Node equivalent) instead
 * of a second broker technology.
 *
 * The consumer (services/notification-service/app/queue.py) declares the
 * same durable queue + dead-letter queue, so publishing here never fails
 * because the queue doesn't exist yet regardless of startup order.
 */
import amqp, { type Channel, type ChannelModel } from "amqplib";

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672/";
const QUEUE_NAME = "notify.outbound";
const DLQ_NAME = "notify.outbound.dlq";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

async function getChannel(): Promise<Channel> {
  if (channel) return channel;
  connection = await amqp.connect(RABBITMQ_URL);
  connection.on("close", () => {
    connection = null;
    channel = null;
  });
  channel = await connection.createChannel();
  await channel.assertQueue(DLQ_NAME, { durable: true });
  await channel.assertQueue(QUEUE_NAME, {
    durable: true,
    arguments: { "x-dead-letter-exchange": "", "x-dead-letter-routing-key": DLQ_NAME },
  });
  return channel;
}

export type NotificationJob =
  | { type: "payment-received"; payload: { customer_email: string; customer_name: string; invoice_number: string; amount: number; paid_at: string } }
  | { type: "send-invoice"; payload: { customer_email: string; customer_name: string; invoice_number: string; pdf_base64: string } };

/** Fire-and-forget: never makes invoice/payment mutations depend on RabbitMQ
 * being up — log and swallow on failure, same best-effort contract these
 * notification sends already had before they were queued. */
export async function publishNotification(job: NotificationJob): Promise<void> {
  try {
    const ch = await getChannel();
    ch.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(job)), { persistent: true });
  } catch (err) {
    console.error("publishNotification failed:", job.type, err);
  }
}
