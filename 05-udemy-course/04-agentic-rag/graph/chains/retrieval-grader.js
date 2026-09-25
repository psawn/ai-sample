// =======================================================================
// CHAIN: RETRIEVAL GRADER
// Dùng LLM chấm 1 chunk có liên quan đến câu hỏi không -> "yes" / "no".
// Được dùng trong node grade-documents (graph/nodes/grade-documents.js).
// =======================================================================

const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { z } = require("zod");

// temperature: 0 -> chấm điểm ổn định, cùng đầu vào cho cùng kết quả
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Schema đầu ra: LLM chỉ trả lời "yes" (liên quan) hoặc "no" (không liên quan)
const GradeDocuments = z
  .object({
    binaryScore: z
      .string()
      .describe("Documents are relevant to the question, 'yes' or 'no'"),
  })
  .describe("Binary score for relevance check on retrieved documents.");

// Ép LLM trả về object đúng schema GradeDocuments, thay vì văn bản tự do
const structuredLlmGrader = llm.withStructuredOutput(GradeDocuments);

const system = `You are a grader assessing relevance of a retrieved document to a user question.
If the document contains keyword(s) or semantic meaning related to the question, grade it as relevant.
Give a binary score 'yes' or 'no' score to indicate whether the document is relevant to the question.`;

const gradePrompt = ChatPromptTemplate.fromMessages([
  ["system", system],
  ["human", "Retrieved document: \n\n {document} \n\n User question: {question}"],
]);

// Chain: điền prompt -> LLM chấm -> trả về { binaryScore: "yes" | "no" }
const retrievalGrader = gradePrompt.pipe(structuredLlmGrader);

module.exports = { retrievalGrader };
