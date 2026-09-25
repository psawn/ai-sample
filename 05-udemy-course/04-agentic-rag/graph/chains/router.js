// =======================================================================
// CHAIN: ROUTER
// Dùng LLM chọn nguồn dữ liệu cho câu hỏi: "vectorstore" (Chroma) hay "websearch".
//
// Export questionRouter cho routeQuestion (graph.js) dùng, ngay lúc graph bắt đầu.
// Export DATASOURCE để graph.js so sánh kết quả.
// =======================================================================

const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { z } = require("zod");

// ===== 1. CẤU HÌNH =====

// temperature: 0 -> LLM chọn nhất quán (cùng câu hỏi, cùng kết quả)
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Tên các nguồn dữ liệu, khai báo 1 chỗ duy nhất.
// Schema, prompt và graph.js đều dùng lại -> đổi tên chỉ sửa ở đây.
const DATASOURCE = {
  VECTORSTORE: "vectorstore",
  WEBSEARCH: "websearch",
};

// ===== 2. SCHEMA ĐẦU RA =====

// z.enum: LLM chỉ được chọn 1 trong 2 nguồn
const RouteQuery = z
  .object({
    datasource: z
      .enum([DATASOURCE.VECTORSTORE, DATASOURCE.WEBSEARCH])
      .describe(
        "Given a user question choose to route it to web search or a vectorstore.",
      ),
  })
  .describe("Route a user query to the most relevant datasource.");

// Ép LLM trả về object đúng schema, thay vì văn bản tự do
const structuredLlmRouter = llm.withStructuredOutput(RouteQuery);

// ===== 3. PROMPT =====

// LƯU Ý: Danh sách chủ đề trong prompt phải khớp với URLS của ingestion.js.
// - ingestion.js: chỉ có link, không có chủ đề.
// - router.js (prompt dưới): gõ tay chủ đề của các link đó.
// Không có gì ràng buộc 2 chỗ này. Thêm/bớt URL mà quên sửa prompt
// -> router chọn sai nguồn (không báo lỗi).
//
// TODO - 3 cách để thêm link không phải nhớ sửa 2 chỗ:
//
// Cách A (khuyên dùng): Mỗi link đi kèm chủ đề, khai báo ở 1 chỗ duy nhất.
//   Đổi URLS thành danh sách { url, topic }, router tự ghép topic vào prompt:
//
//     // ingestion.js
//     const SOURCES = [
//       { url: "https://.../agent/", topic: "agents" },
//       { url: "https://.../llm/", topic: "large language models" }, // Thêm mới
//     ];
//     module.exports = { getRetriever, SOURCES };
//
//     // router.js
//     const { SOURCES } = require("../../ingestion");
//     const topics = SOURCES.map((s) => s.topic).join(", ");
//
//   + Thêm bài mới chỉ sửa 1 chỗ, không thể quên sửa prompt.
//   - Vẫn phải tự viết topic cho mỗi link.
//
// Cách B: Lấy chủ đề tự động từ tiêu đề bài viết trong Chroma.
//   Khi graph khởi động, đọc metadata.title của các chunk rồi chèn vào prompt.
//   + Prompt luôn khớp dữ liệu thật trong Chroma.
//   - Code phải async, tiêu đề trang có thể dài hoặc không rõ chủ đề.
//
// Cách C: Bỏ hẳn router.
//   Câu hỏi nào cũng vào retrieve trước, gradeDocuments lọc lại.
//   + Không còn danh sách chủ đề phải giữ cho khớp.
//   - Câu hỏi ngoài lề vẫn phải tìm Chroma + chấm từng chunk -> tốn thêm LLM.
//   - Khác bài giảng (bài dạy chính bước router).
//
// => Hiện giữ prompt viết tay như bài giảng. Nên chuyển sang Cách A.

// Chèn giá trị từ DATASOURCE -> tên trong prompt luôn khớp với enum
const system =
  `You are an expert at routing a user question to "${DATASOURCE.VECTORSTORE}" or "${DATASOURCE.WEBSEARCH}".\n` +
  `The ${DATASOURCE.VECTORSTORE} contains documents related to agents, prompt engineering, and adversarial attacks.\n` +
  `Use "${DATASOURCE.VECTORSTORE}" for questions on these topics. For all else, use "${DATASOURCE.WEBSEARCH}".`;

const routePrompt = ChatPromptTemplate.fromMessages([
  ["system", system],
  ["human", "{question}"],
]);

// Chain: điền prompt -> LLM chọn nguồn -> trả về { datasource: "vectorstore" | "websearch" }
const questionRouter = routePrompt.pipe(structuredLlmRouter);

module.exports = { questionRouter, DATASOURCE };
