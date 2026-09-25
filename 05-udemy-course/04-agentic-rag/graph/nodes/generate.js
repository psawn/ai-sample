// =======================================================================
// NODE: GENERATE
// Dùng LLM viết câu trả lời từ câu hỏi + các chunk đã lọc.
// Đầu vào: question, documents -> Đầu ra: generation
// =======================================================================

const { logStep } = require("../../flow-logger");
const { generationChain } = require("../chains/generation");

/**
 * Gộp nội dung các chunk thành context -> gọi generationChain để trả lời.
 */
async function generate(state) {
  const { question, documents } = state;
  logStep("node", "GENERATE", `Viết câu trả lời từ ${documents.length} chunk`);

  // Chỉ lấy phần chữ, bỏ metadata cho prompt gọn
  const context = documents.map((doc) => doc.pageContent).join("\n\n");

  const generation = await generationChain.invoke({ context, question });
  return { documents, question, generation };
}

module.exports = { generate };
