// =======================================================================
// CHAIN: GENERATION
// Dùng LLM trả lời câu hỏi dựa trên context (các chunk tìm được).
// Được dùng trong node generate (graph/nodes/generate.js).
// =======================================================================

const { StringOutputParser } = require("@langchain/core/output_parsers");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Prompt chép sẵn từ "rlm/rag-prompt" trên LangChain Hub
// (kéo trực tiếp từ Hub cần LangSmith API key)
const prompt = ChatPromptTemplate.fromMessages([
  [
    "human",
    "You are an assistant for question-answering tasks. " +
      "Use the following pieces of retrieved context to answer the question. " +
      "If you don't know the answer, just say that you don't know. " +
      "Use three sentences maximum and keep the answer concise.\n" +
      "Question: {question} \nContext: {context} \nAnswer:",
  ],
]);

// Chain: điền prompt -> LLM trả lời -> lấy phần text (bỏ AIMessage)
const generationChain = prompt.pipe(llm).pipe(new StringOutputParser());

module.exports = { generationChain };
