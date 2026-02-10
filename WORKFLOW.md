# Workflow MVP (Tiếng Việt)

Tài liệu này mô tả luồng sử dụng MVP “AI Action Firewall” trên Sui.

## 1) Tổng quan luồng
1. Tạo `AdminCap` và `Vault`.
2. Nạp SUI vào `Vault`.
3. Cấp `Permission` cho agent (giới hạn số tiền + thời hạn).
4. Agent tạo `ActionProposal`.
5. Agent gọi `execute_transfer` để chuyển tiền nếu pass firewall.

## 2) Ghi chú quan trọng
- **Vault là nguồn tiền**: nếu không nạp vào Vault thì không thể chuyển.
- **Permission chỉ là quyền**: không phải tiền.
- **Các object đã được ràng buộc**: AdminCap ↔ Vault ↔ Permission ↔ Proposal. Permission chỉ dùng được với Vault đã gắn.
- **Quota tổng**: mỗi Permission có `max_total` và `spent_total`. Khi vượt quota sẽ bị từ chối.
- `expires_at_ms` là **timestamp theo millisecond** (Unix epoch).
- UI đã chuyển sang nhập **SUI** và tự đổi sang **MIST** khi gửi tx.
- 1 SUI = 1,000,000,000 MIST.

## 3) Dữ liệu đã deploy (testnet)
- Network: `testnet`
- Package ID: `0x80b36d20a10a40d6b0e7f22ecdd5bb2cd2e496fe7c8d1c7cf660b37fafa606df`
- Clock object ID: `0x6`

## 4) Chạy UI
1. `cd ui`
2. `yarn install`
3. `yarn dev`

Nếu đổi package hoặc network, sửa file `ui/src/ids.ts`.

## 5) Hướng dẫn dùng UI (ngắn gọn)
1. Connect ví Sui (testnet).
2. Bấm `Create AdminCap` và `Create Vault`.
3. Ở **Vault Funding**, nhập số SUI và bấm `Deposit into Vault`.
4. Ở **Permission**, nhập agent + max SUI + expiry (phút), bấm `Issue Permission`.
   - `Max per transfer`: giới hạn mỗi lần.
   - `Total quota`: giới hạn tổng (0 = unlimited).
5. Ở **Action Proposal**, nhập recipient + amount, bấm `Propose Transfer`.
6. Ở **Execute**, bấm `Execute Transfer`.

## 6) Chạy demo bằng script (PowerShell)
File: `scripts/demo.ps1`

Chạy mặc định:
```powershell
.\scripts\demo.ps1
```

Tham số tuỳ chọn:
```powershell
.\scripts\demo.ps1 -Recipient 0xYOUR_ADDR -DepositAmount 100000000 -MaxAmount 50000000 -TransferAmount 10000000
```

Lưu ý: script dùng **MIST**, không phải SUI.

## 7) Checklist demo
- [ ] Ví kết nối testnet
- [ ] Có Vault ID
- [ ] Vault đã được nạp SUI
- [ ] Permission ID được tạo
- [ ] Proposal ID được tạo
- [ ] Execute thành công
