import type { IncomingMessage, ServerResponse } from 'node:http';

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export async function readJsonBody<T = Record<string, any>>(
  req: IncomingMessage,
  maxBytes = 6 * 1024 * 1024
): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > maxBytes) {
        aborted = true;
        reject(new Error('Dữ liệu gửi lên vượt quá giới hạn cho phép.'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw) {
          resolve({} as T);
          return;
        }
        resolve(JSON.parse(raw) as T);
      } catch {
        reject(new Error('Định dạng JSON không hợp lệ.'));
      }
    });

    req.on('error', (err) => {
      if (!aborted) reject(err);
    });
  });
}

export function getRequestUrl(req: IncomingMessage): URL {
  return new URL(req.url || '/', 'http://localhost');
}
