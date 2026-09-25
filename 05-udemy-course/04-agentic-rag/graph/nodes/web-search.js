// =======================================================================
// NODE: WEB SEARCH
// Search web bằng Tavily, gộp kết quả thành 1 Document thêm vào documents.
// Đầu vào: question, documents (có thể chưa có) -> Đầu ra: documents
// =======================================================================

const { Document } = require("@langchain/core/documents");
const { RunnableLambda } = require("@langchain/core/runnables");
const { TavilySearch } = require("@langchain/tavily");

const { logWarning } = require("../../../helpers/logger");
const { logStep, logDetail } = require("../../flow-logger");

const webSearchTool = withRetry(new TavilySearch({ maxResults: 3 }));

/**
 * Search câu hỏi trên web -> gộp nội dung 3 kết quả -> thêm vào cuối documents.
 */
async function webSearch(state) {
  const { question } = state;
  logStep("node", "WEB SEARCH", `Search Tavily: "${question}"`);

  // Router đi thẳng tới web search thì documents chưa có -> dùng mảng rỗng
  const documents = state.documents ?? [];

  const { results } = await webSearchTool.invoke({ query: question });
  results.forEach((result) => logDetail(`Tavily: ${result.url}`));

  const joinedTavilyResult = results.map((result) => result.content).join("\n");

  const webResults = new Document({ pageContent: joinedTavilyResult });

  return { documents: [...documents, webResults], question };
}

/**
 * Bọc SDK Tavily để tự động retry khi gặp sự cố mạng (vd: "fetch failed").
 *
 * *Lưu ý:* Tavily SDK trả về object { error } chứ không throw.
 * Ta phải chủ động throw Error để trigger cơ chế retry của LangChain.
 */
function withRetry(tool, maxAttempts = 3) {
  return RunnableLambda.from(async (input) => {
    const res = await tool.invoke(input);
    if (res.error) throw new Error(res.error);
    return res;
  }).withRetry({
    stopAfterAttempt: maxAttempts,
    onFailedAttempt: (e) =>
      logWarning(`${tool.name}: ${e.message}, thử lại...`),
  });
}

module.exports = { webSearch };
