import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, applyCommonSecurityHeaders } from './security';

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  applyCommonSecurityHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function parseJsonObjectText<T>(rawText: string, maxBytes: number): T {
  const trimmed = rawText.trim();
  if (!trimmed) return {} as T;
  if (Buffer.byteLength(trimmed, 'utf8') > maxBytes) {
    throw new HttpError(413, 'Dữ liệu gửi lên vượt quá giới hạn cho phép.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new HttpError(400, 'Định dạng JSON không hợp lệ.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'Dữ liệu JSON phải là một đối tượng hợp lệ.');
  }
  return parsed as T;
}

export async function readJsonBody<T = Record<string, any>>(
  req: IncomingMessage,
  maxBytes = 64 * 1024
): Promise<T> {
  // Vercel's Node.js runtime may pre-consume and populate req.body before our handler runs.
  const preParsed = (req as IncomingMessage & { body?: unknown }).body;
  if (preParsed !== undefined) {
    if (typeof preParsed === 'string') {
      return parseJsonObjectText<T>(preParsed, maxBytes);
    }
    if (Buffer.isBuffer(preParsed)) {
      if (preParsed.length > maxBytes) {
        throw new HttpError(413, 'Dữ liệu gửi lên vượt quá giới hạn cho phép.');
      }
      return parseJsonObjectText<T>(preParsed.toString('utf8'), maxBytes);
    }
    if (preParsed === null || typeof preParsed !== 'object' || Array.isArray(preParsed)) {
      throw new HttpError(400, 'Dữ liệu JSON phải là một đối tượng hợp lệ.');
    }
    if (Buffer.byteLength(JSON.stringify(preParsed), 'utf8') > maxBytes) {
      throw new HttpError(413, 'Dữ liệu gửi lên vượt quá giới hạn cho phép.');
    }
    return preParsed as T;
  }

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
        const raw = Buffer.concat(chunks).toString('utf8');
        const parsed = parseJsonObjectText<T>(raw, maxBytes);
        settled = true;
        resolve(parsed);
      } catch (err) {
        fail(err instanceof Error ? err : new HttpError(400, 'Định dạng JSON không hợp lệ.'));
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
