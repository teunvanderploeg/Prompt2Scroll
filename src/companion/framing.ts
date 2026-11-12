export function frame(value: unknown): Buffer { const body = Buffer.from(JSON.stringify(value)); const header = Buffer.alloc(4); header.writeUInt32LE(body.length); return Buffer.concat([header,body]); }
export class Decoder {
  private buffer: Buffer = Buffer.alloc(0);
  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer,chunk]); const messages: unknown[] = [];
    while (this.buffer.length >= 4) { const n = this.buffer.readUInt32LE(0); if (n > 1024*1024) throw new Error('Native message too large'); if (this.buffer.length < n+4) break; messages.push(JSON.parse(this.buffer.subarray(4,n+4).toString())); this.buffer = this.buffer.subarray(n+4); }
    return messages;
  }
}
