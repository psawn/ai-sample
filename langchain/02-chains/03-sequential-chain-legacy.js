// =======================================================================
// CHAINS - BƯỚC 3: SequentialChain (CÁCH CŨ - LEGACY)
//
// Giống SimpleSequentialChain (file 02) nhưng mạnh hơn:
// 1. Mỗi chain con có nhiều input/output, mỗi biến có tên riêng.
// 2. Chain sau dùng được output của bất kỳ chain nào trước nó.
//    Vd: chain 4 dùng cùng lúc "summary" (chain 2) và "language" (chain 3).
//
// LLMChain và SequentialChain đã deprecated.
// Cách mới: 03-sequential-chain-lcel.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { LLMChain, SequentialChain } = require("@langchain/classic/chains");

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0.7,
});

// Chain 1: dịch review sang tiếng Anh. Review -> English_Review.
// outputKey: đặt tên cho kết quả, để chain sau dùng lại qua {English_Review}.
const translateChain = new LLMChain({
  llm: model,
  prompt: ChatPromptTemplate.fromTemplate(
    `Translate the following review to English:\n\n{Review}`,
  ),
  outputKey: "English_Review",
});

// Chain 2: tóm tắt bản tiếng Anh trong 1 câu. English_Review -> summary.
const summaryChain = new LLMChain({
  llm: model,
  prompt: ChatPromptTemplate.fromTemplate(
    `Summarize the following review in 1 sentence:\n\n{English_Review}`,
  ),
  outputKey: "summary",
});

// Chain 3: xác định ngôn ngữ gốc. Review -> language.
const languageChain = new LLMChain({
  llm: model,
  prompt: ChatPromptTemplate.fromTemplate(
    `What language is the following review:\n\n{Review}`,
  ),
  outputKey: "language",
});

// Chain 4: viết tin nhắn phản hồi. summary + language -> followup_message.
const followupChain = new LLMChain({
  llm: model,
  prompt: ChatPromptTemplate.fromTemplate(
    `Write a follow up response to the following summary in the specified language:\n\nSummary: {summary}\n\nLanguage: {language}`,
  ),
  outputKey: "followup_message",
});

const overallChain = new SequentialChain({
  chains: [translateChain, summaryChain, languageChain, followupChain],
  inputVariables: ["Review"], // Biến bắt buộc truyền vào khi gọi
  outputVariables: ["English_Review", "summary", "language", "followup_message"], // Biến muốn lấy ra ở kết quả
});

// ===== KỊCH BẢN MINH HỌA =====
// Input: 1 review tiếng Pháp.
async function main() {
  const review = `Je trouve le goût médiocre. La mousse ne tient pas, c'est bizarre.`;

  // Chạy lần lượt 4 chain, mỗi chain gọi Gemini 1 lần.
  const result = await overallChain.call({ Review: review });

  console.log("English_Review:", result.English_Review);
  console.log("summary:", result.summary);
  console.log("language:", result.language);
  console.log("followup_message:", result.followup_message);
}

main();
