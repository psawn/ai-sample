// =======================================================================
// LOGGER: IN LOG CÓ MÀU RA TERMINAL
//
// Mỗi loại log có màu + icon riêng -> nhìn là biết ngay:
//   logInfo    ℹ️  xanh cyan  -> thông tin chung
//   logSuccess ✅ xanh lá    -> chạy xong, thành công
//   logWarning ⚠️  vàng       -> cần chú ý, chưa phải lỗi
//   logError   ❌ đỏ         -> có lỗi
//   logHeader  🚀 tím        -> tiêu đề tách từng phần
//
// Cách tô màu: chèn mã ANSI trước chữ -> chữ đổi màu
// -> chèn Colors.END ở cuối để trả về màu thường.
//
// Dùng khi: muốn theo dõi tiến trình script trên terminal cho dễ đọc.
// =======================================================================

// ===== 1. BẢNG MÀU =====

/**
 * Mã màu ANSI cho terminal.
 *
 * Đặt mã màu trước chữ để tô màu, luôn kết thúc bằng `Colors.END`
 * để chữ phía sau không bị dính màu.
 *
 * @example
 * console.log(`${Colors.RED}Lỗi rồi${Colors.END}`);
 */
const Colors = {
  PURPLE: "\x1b[95m",
  CYAN: "\x1b[96m",
  DARKCYAN: "\x1b[36m",
  BLUE: "\x1b[94m",
  GREEN: "\x1b[92m",
  YELLOW: "\x1b[93m",
  RED: "\x1b[91m",
  BOLD: "\x1b[1m",
  UNDERLINE: "\x1b[4m",
  END: "\x1b[0m", // Trả về màu mặc định
};

// ===== 2. CÁC HÀM IN LOG =====

/**
 * In thông tin chung, kèm icon ℹ️.
 *
 * Mặc định màu xanh cyan, có thể đổi màu khác.
 *
 * @param {string} message - Nội dung cần in.
 * @param {string} [color=Colors.CYAN] - Mã màu, lấy từ `Colors`.
 * @example
 * logInfo("Đang tải dữ liệu...");
 * logInfo("Bước 2", Colors.BLUE);
 */
function logInfo(message, color = Colors.CYAN) {
  console.log(`${color}ℹ️  ${message}${Colors.END}`);
}

/**
 * In thông báo thành công, màu xanh lá, kèm icon ✅.
 *
 * @param {string} message - Nội dung cần in.
 * @example
 * logSuccess("Đã lưu 120 tài liệu");
 */
function logSuccess(message) {
  console.log(`${Colors.GREEN}✅ ${message}${Colors.END}`);
}

/**
 * In thông báo lỗi, màu đỏ, kèm icon ❌.
 *
 * Chỉ in ra màn hình, không dừng chương trình.
 *
 * @param {string} message - Nội dung lỗi.
 * @example
 * logError(`Kết nối thất bại: ${err.message}`);
 */
function logError(message) {
  console.log(`${Colors.RED}❌ ${message}${Colors.END}`);
}

/**
 * In cảnh báo, màu vàng, kèm icon ⚠️.
 *
 * Dùng cho việc cần chú ý nhưng script vẫn chạy tiếp được.
 *
 * @param {string} message - Nội dung cảnh báo.
 * @example
 * logWarning("Không tìm thấy API key, dùng giá trị mặc định");
 */
function logWarning(message) {
  console.log(`${Colors.YELLOW}⚠️  ${message}${Colors.END}`);
}

/**
 * In tiêu đề lớn, màu tím đậm, có đường kẻ trên và dưới.
 *
 * Dùng để tách các phần của script cho dễ nhìn.
 *
 * @param {string} message - Tiêu đề cần làm nổi bật.
 * @example
 * logHeader("BƯỚC 1: TẢI DỮ LIỆU");
 * // ============================================================
 * // 🚀 BƯỚC 1: TẢI DỮ LIỆU
 * // ============================================================
 */
function logHeader(message) {
  const line = `${Colors.BOLD}${Colors.PURPLE}${"=".repeat(60)}${Colors.END}`;
  console.log(`\n${line}`);
  console.log(`${Colors.BOLD}${Colors.PURPLE}🚀 ${message}${Colors.END}`);
  console.log(`${line}\n`);
}

module.exports = {
  Colors,
  logInfo,
  logSuccess,
  logError,
  logWarning,
  logHeader,
};
