/** Collect a readable stream into a string. Ported from v1 web/server.ts. */
export function collectStream(stream: NodeJS.ReadableStream, onData?: (chunk: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c) => {
      chunks.push(Buffer.from(c));
      if (onData) onData(c.toString("utf-8"));
    });
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}
