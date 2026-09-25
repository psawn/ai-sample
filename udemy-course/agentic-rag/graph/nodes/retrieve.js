// =======================================================================
// NODE: RETRIEVE
// Tìm các chunk liên quan đến câu hỏi trong Chroma.
// Đầu vào: question -> Đầu ra: documents
// =======================================================================

const { logStep } = require("../../flow-logger");
const { getRetriever } = require("../../ingestion");

// Lưu lại retriever sau lần gọi đầu, tránh kết nối + kiểm tra Chroma lại mỗi lần
let retrieverPromise;

/**
 * Lấy retriever (chỉ tạo ở lần đầu) -> tìm chunk theo câu hỏi.
 */
async function retrieve(state) {
  const { question } = state;
  logStep("node", "RETRIEVE", `Tìm chunk trong Chroma cho câu hỏi: "${question}"`);

  retrieverPromise ??= getRetriever(); // Chỉ tạo ở lần gọi đầu tiên
  const retriever = await retrieverPromise;

  const documents = await retriever.invoke(question);
  return { documents, question };
}

module.exports = { retrieve };
