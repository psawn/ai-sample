// =======================================================================
// CHAIN: HALLUCINATION GRADER
// Dùng LLM chấm xem câu trả lời có dựa trên tài liệu (documents) không,
// hay bịa đặt (hallucination).
// (Được gọi trong gradeGenerationGroundedInDocumentsAndQuestion của graph.js).
// =======================================================================

const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { z } = require("zod");

// temperature: 0 giúp LLM chấm điểm nhất quán (cùng đầu vào, cùng kết quả)
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Định nghĩa cấu trúc đầu ra: true (dựa hoàn toàn vào facts) / false (bịa đặt)
const GradeHallucinations = z
  .object({
    binaryScore: z
      .boolean()
      .describe("Answer is grounded in the facts, 'yes' or 'no'"),
  })
  .describe("Binary score for hallucination present in generation answer.");

// Ép LLM trả về object chuẩn Zod thay vì văn bản tự do
const structuredLlmGrader = llm.withStructuredOutput(GradeHallucinations);

const system = `You are a grader assessing whether an LLM generation is grounded in / supported by a set of retrieved facts.
Give a binary score 'yes' or 'no'. 'Yes' means that the answer is grounded in / supported by the set of facts.`;

const hallucinationPrompt = ChatPromptTemplate.fromMessages([
  ["system", system],
  ["human", "Set of facts: \n\n {documents} \n\n LLM generation: {generation}"],
]);

// Chain xử lý: Điền prompt -> LLM chấm điểm -> Trả về { binaryScore: true | false }
const hallucinationGrader = hallucinationPrompt.pipe(structuredLlmGrader);

module.exports = { hallucinationGrader };
