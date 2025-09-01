// shared/storage.ts
import { BlobServiceClient } from "@azure/storage-blob";

const conn = process.env["AzureWebJobsStorage"]!;
export const blob = BlobServiceClient.fromConnectionString(conn);

export async function readBlob(container: string, path: string): Promise<string> {
  const c = blob.getContainerClient(container);
  const b = c.getBlobClient(path);
  const d = await b.download();
  return await streamToString(d.readableStreamBody!);
}

export async function writeBlob(container: string, path: string, data: string | Uint8Array): Promise<void> {
  const c = blob.getContainerClient(container);
  await c.createIfNotExists();
  const b = c.getBlockBlobClient(path);
  if (typeof data === "string") {
    await b.upload(data, Buffer.byteLength(data));
  } else {
    await b.uploadData(data);
  }
}

async function streamToString(readable: NodeJS.ReadableStream): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    readable.on("data", (d) => chunks.push(Buffer.from(d)));
    readable.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    readable.on("error", reject);
  });
}
