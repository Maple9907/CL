# Egaroucid Othello Web

Web tĩnh cho Othello/Reversi, dùng trực tiếp runtime `ai.js` và `ai.wasm` từ Egaroucid for Web.

## Chạy local

Do trình duyệt thường chặn WebAssembly khi mở bằng `file://`, hãy chạy qua HTTP:

```bash
python3 -m http.server 8080
```

Sau đó mở `http://localhost:8080`.

## Deploy GitHub Pages

1. Tạo repo GitHub mới.
2. Đẩy toàn bộ file trong thư mục này lên repo.
3. Vào `Settings -> Pages`.
4. Chọn deploy từ branch `main` và folder `/root`.

## Tính năng

- Chọn bạn cầm quân đen hoặc trắng. Đen luôn là bên đi trước theo luật Othello.
- AI dùng Egaroucid WASM gốc, level 0 đến 15.
- Lùi đúng 1 nước. Nếu lùi nước AI vừa đi, app tạm dừng AI để bạn có thể lùi tiếp hoặc bấm `Cho AI đi`.
- Hiện nước hợp lệ, phân tích điểm gợi ý, lịch sử nước, copy biên bản.
- Tự động pass khi một bên không có nước.
- Tự lưu ván đang chơi vào localStorage.

## Nguồn engine và license

Egaroucid là dự án của Takuto Yamana:

- GitHub: https://github.com/Nyanyan/Egaroucid
- Website: https://www.egaroucid.nyanyan.dev/
- License upstream: GPL-3.0-or-later

File runtime gốc trong project này:

- `ai.js`
- `ai.wasm`

Thông tin thêm nằm trong `vendor/egaroucid/`.
