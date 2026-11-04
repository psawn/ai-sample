// =======================================================================
// GUARDRAILS - OUTPUT RAIL: KIỂM TRA CÂU TRẢ LỜI TRƯỚC KHI TRẢ USER
//
// Lớp phòng thủ cuối cùng. Input rail đã cho qua, nhưng câu trả lời vẫn có
// thể làm lộ dữ liệu, VD tài liệu RAG chứa mật khẩu bị đưa nhầm vào.
//
// Cách làm: quét câu trả lời bằng regex. Trúng 1 pattern → giữ lại CẢ câu
// trả lời (không chỉ che 1 phần), báo user liên hệ HR.
//
// Các file đang sử dụng:
//   - ../01-custom-rails/intent-rails-rag.js
//   - ../02-nemo/call-nemo-server.js
// =======================================================================

// Pattern dữ liệu không được xuất hiện trong câu trả lời
const SENSITIVE_OUTPUT_PATTERNS = {
  // "mật khẩu: abc123", "password = **abc123**", "mật khẩu `Hrm@2026`"
  // Dấu ngăn cách (: = là) không bắt buộc vì LLM hay viết thiếu.
  // Đổi lại, giá trị phải có chữ số, để "password policy" không bị chặn oan.
  // → Regex dễ lọt hoặc chặn nhầm: phải test với câu trả lời thật của LLM.
  credential_leak:
    /(password|mật khẩu|api[_\s-]?key|token)\s*(?:[:=]|là)?\s*[*"'`]*(?=[^\s*"'`]*\d)[^\s*"'`]{6,}/i,
  // "lương của Lan là 35.000.000", "thu nhập 40,000,000 VND"
  salary_amount: /(lương|thu nhập)[^.\n]{0,40}?\d{1,3}([.,]\d{3}){2,}/i,
  // Số CCCD 12 chữ số
  citizen_id: /\b\d{12}\b/,
};

const WITHHELD_MESSAGE =
  "Câu trả lời có thể chứa thông tin nhạy cảm nên đã bị giữ lại. Vui lòng liên hệ hr@abc.vn.";

/** Trả về danh sách tên pattern bị trúng; mảng rỗng = câu trả lời an toàn. */
function checkOutput(text) {
  return Object.entries(SENSITIVE_OUTPUT_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

module.exports = { checkOutput, WITHHELD_MESSAGE };
