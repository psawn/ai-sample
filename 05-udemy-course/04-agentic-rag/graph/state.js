// =======================================================================
// GRAPH STATE
// "Cuốn sổ chung" mà mọi node trong graph cùng đọc và ghi.
// - Node nhận toàn bộ state -> trả về các trường muốn cập nhật.
// - LangGraph ghi đè giá trị mới vào state -> chuyển sang node tiếp theo.
// =======================================================================

const { Annotation } = require("@langchain/langgraph");

// Annotation() không truyền gì = giá trị mới ghi đè giá trị cũ
const GraphState = Annotation.Root({
  question: Annotation(), // Câu hỏi của người dùng
  generation: Annotation(), // Câu trả lời của LLM
  webSearch: Annotation(), // true = cần search web bổ sung
  documents: Annotation(), // Các Document tìm được (từ Chroma hoặc web)
});

module.exports = { GraphState };
