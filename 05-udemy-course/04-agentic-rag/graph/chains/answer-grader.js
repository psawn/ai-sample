// =======================================================================
// CHAIN: ANSWER GRADER
// Dùng LLM chấm xem câu trả lời đã giải quyết đúng trọng tâm câu hỏi chưa.
// (Được gọi trong node kiểm tra của graph).
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

// Định nghĩa cấu trúc đầu ra: true (đạt) / false (chưa đạt)
const GradeAnswer = z.object({
  binaryScore: z
    .boolean()
    .describe("Answer addresses the question, 'yes' or 'no'"),
});

// Ép LLM trả về object chuẩn Zod thay vì văn bản tự do
const structuredLlmGrader = llm.withStructuredOutput(GradeAnswer);

const system = `You are a grader assessing whether an answer addresses / resolves a question
Give a binary score 'yes' or 'no'. Yes' means that the answer resolves the question.`;

const answerPrompt = ChatPromptTemplate.fromMessages([
  ["system", system],
  ["human", "User question: \n\n {question} \n\n LLM generation: {generation}"],
]);

// Chain xử lý: Điền prompt -> LLM chấm điểm -> Trả về { binaryScore: true | false }
const answerGrader = answerPrompt.pipe(structuredLlmGrader);

module.exports = { answerGrader };
