# KaiwaTube

Ứng dụng web học tiếng Nhật qua video YouTube, playlist và anime có phụ đề song ngữ Nhật – Việt, hỗ trợ đồng bộ hội thoại theo thời gian thực, tra cứu Kanji/bộ thủ và phân tích ngữ pháp bằng AI Gemini.

## Tính năng chính

- **Trang chủ & Tìm kiếm YouTube**: Duyệt video/playlist gợi ý theo chủ đề hoặc tìm kiếm trực tiếp và dán link YouTube (`watch?v=...`, `youtu.be/...`, `list=...`, `&t=...`).
- **Phòng học Video (Watch Room)**:
  - Chặn phát cho đến khi phụ đề hoàn tất đồng bộ để tránh lệch hình và lời thoại.
  - Chuẩn hóa thời gian phụ đề, xử lý chồng lấn tag phi thoại (`[音楽]`, ...) và tự động căn chỉnh đoạn phụ đề đang phát.
  - Khôi phục đúng vị trí câu thoại và cuộn bảng hội thoại khi chuyển tab/trang.
  - Hỗ trợ nạp phụ đề `.SRT` / `.VTT` ngoài, gộp câu bằng AI, chỉnh sửa nhanh, lưu track cá nhân và đóng góp cộng đồng.
- **Phân tích Nhật ngữ & Kanji**:
  - Tách từ tiếng Nhật (`tiny-segmenter`), rê chuột hoặc bấm để xem Âm Hán Việt, nghĩa, bộ thủ và mẹo ghi nhớ.
  - Phân tích cấu trúc câu, từ vựng và Kanji chi tiết với Google Gemini.
- **Tài khoản, Yêu thích & Phân quyền**:
  - Đăng ký/đăng nhập lưu trữ bằng SQLite (`node:sqlite`), quản lý danh sách video/playlist Yêu thích và bảng quản trị báo cáo cộng đồng.

## Công nghệ sử dụng

- **Frontend**: React 19, TypeScript, Tailwind CSS, Vite, Lucide React
- **Backend Middleware (Vite API Server)**: Node HTTP middleware + `node:sqlite`, `yt-search`, `youtube-transcript`

## Cài đặt & Chạy local

```bash
bun install
cp .env.example .env
bun run dev
```

Mở trình duyệt tại địa chỉ Vite hiển thị (mặc định `http://localhost:5173`).

### Biến môi trường (`.env`)

Xem mẫu tại [`.env.example`](./.env.example):

- `POSTGRES_URL` / `DATABASE_URL` *(khuyên dùng khi deploy Vercel)*: Chuỗi kết nối Supabase PostgreSQL (Transaction Pooler), tự động dùng schema `kaiwatube` từ [`supabase/migrations/0001_kaiwatube_schema.sql`](./supabase/migrations/0001_kaiwatube_schema.sql).
- `KAIWATUBE_DB_SCHEMA` *(tùy chọn)*: Tên schema PostgreSQL (mặc định `kaiwatube`).
- `ADMIN_SECRET`: Mã bí mật dùng để kích hoạt quyền Admin khi đăng ký hoặc nâng cấp tài khoản.
- `JWT_SECRET`: Khóa ký phiên đăng nhập (nếu bỏ trống sẽ tự sinh ngẫu nhiên và lưu trong DB).
- `NIHONGO_DB_PATH` *(tùy chọn)*: Đường dẫn file SQLite khi chạy local/Docker (mặc định `nihongo.db`).
- `TRUST_PROXY` *(tùy chọn)*: Đặt `1` khi chạy sau Reverse Proxy (Vercel/Caddy/Nginx) để rate-limit đọc đúng IP khách hàng.
- `PORT` / `HOST` *(tùy chọn)*: Cổng và địa chỉ lắng nghe của production server (mặc định `0.0.0.0:3000`).

## Deploy Supabase + Vercel

1. Chạy migration [`supabase/migrations/0001_kaiwatube_schema.sql`](./supabase/migrations/0001_kaiwatube_schema.sql) trên project Supabase (schema `kaiwatube` có bật RLS).
2. Cấu hình biến môi trường trên Vercel: `POSTGRES_URL` (hoặc kết nối Supabase Integration), `JWT_SECRET`, `ADMIN_SECRET`.
3. Vercel tự build SPA (`npm run build:client`) vào `dist/` và phục vụ toàn bộ `/api/*` qua [`api/index.ts`](./api/index.ts) + [`vercel.json`](./vercel.json).

## Build & Chạy Production

```bash
bun run build
bun run start
```

Hoặc chạy qua Docker (`node:24-slim` + volume `/data`):

```bash
docker build -t kaiwatube .
docker run -d -p 3000:3000 -v kaiwatube_data:/data -e JWT_SECRET=... -e ADMIN_SECRET=... kaiwatube
```

## Kiểm thử

```bash
bun test
```
