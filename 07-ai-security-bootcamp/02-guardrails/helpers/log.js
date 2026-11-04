// =======================================================================
// GUARDRAILS - IN LOG THEO TỪNG BƯỚC
//
// Mẫu log của 1 câu hỏi:
//   ==================================
//   CÂU HỎI: ...
//   ==================================
//
//   [Phần 1: ...]
//      Dòng thông tin
//
//   [Phần 2: ...]
//   ----- Prompt gửi guard LLM -----
//   Nội dung prompt
//   ----------------------
//
// Các file đang sử dụng:
//   - ../01-custom-rails/intent-rails-rag.js
//   - ../02-nemo/call-nemo-server.js
//   - ./rag.js
// =======================================================================

const SEPARATOR = "=".repeat(70);
const INDENT = "   ";

/** In câu hỏi đang xử lý, để tách rõ log của từng câu. */
function logQuestion(question) {
  console.log(`\n${SEPARATOR}\nCÂU HỎI: ${question}\n${SEPARATOR}`);
}

/** In tiêu đề của 1 bước. */
function logStep(title) {
  console.log(`\n[${title}]`);
}

/** In 1 dòng thông tin thuộc bước hiện tại. */
function logInfo(text) {
  console.log(`${INDENT}${text}`);
}

/** In nguyên văn prompt giữa 2 dòng đánh dấu, để dòng dài tự xuống hàng không bị lệch. */
function logPrompt(title, prompt) {
  console.log(`\n----- ${title} -----`);
  console.log(prompt);
  console.log("----------------------\n");
}

module.exports = { logInfo, logPrompt, logQuestion, logStep };
