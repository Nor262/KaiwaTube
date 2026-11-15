import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, applyCommonSecurityHeaders } from './security';

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  applyCommonSecurityHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export async function readJsonBody<T = Record<string, any>>(
  req: IncomingMessage,
  maxBytes = 64 * 1024
): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        req.pause();
        fail(new HttpError(413, 'Dữ liệu gửi lên vượt quá giới hạn cho phép.'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw) {
          settled = true;
          resolve({} as T);
          return;
        }
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          fail(new HttpError(400, 'Dữ liệu JSON phải là một đối tượng hợp lệ.'));
          return;
        }
        settled = true;
        resolve(parsed as T);
      } catch {
        fail(new HttpError(400, 'Định dạng JSON không hợp lệ.'));
      }
    });

    req.on('error', () => {
      fail(new HttpError(400, 'Không thể đọc dữ liệu yêu cầu.'));
    });
  });
}

export function getRequestUrl(req: IncomingMessage): URL {
  return new URL(req.url || '/', 'http://localhost');
}
