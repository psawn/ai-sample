require("../_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { LLMChain, SequentialChain } = require("@langchain/classic/chains");

// =======================================================
// SequentialChain (cách viết CŨ)
//
// Giống SimpleSequentialChain (file 02) ở chỗ nối nhiều chain chạy nối
// tiếp nhau, nhưng mạnh hơn:
// - Mỗi chain con có thể có NHIỀU input/output, và mỗi biến đều có TÊN
//   riêng (không bị giới hạn 1 input/1 output không tên như bản Simple).
// - Một chain con có thể dùng lại output của BẤT KỲ chain nào đã chạy
//   trước nó, không nhất thiết phải là chain ngay liền trước.
//   Ví dụ trong file này: chain 4 (followupChain) không lấy output của
//   chain 3 (languageChain, đứng ngay trước nó), mà lấy output của CẢ
//   chain 2 (summaryChain -> "summary") LẪN chain 3 (languageChain ->
//   "language") cộng lại.
//
// Lưu ý: LLMChain và SequentialChain đều đã bị đánh dấu lỗi thời
// (deprecated), sẽ bị xóa ở LangChain 1.0.0. Xem file
// "03-sequential-chain-lcel.js" để so sánh cách viết mới bằng LCEL.
// =======================================================

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0.7,
});

// Chain 1: Gọi API Gemini để dịch review sang tiếng Anh.
// input: Review -> output: English_Review
// (outputKey đặt TÊN cho kết quả của chain này, để các chain sau có thể
// tham chiếu tới nó qua {English_Review}, giống như 1 biến)
const translateChain = new LLMChain({
  llm: model,
  prompt: ChatPromptTemplate.fromTemplate(
    `Translate the following review to English:\n\n{Review}`,
  ),
  outputKey: "English_Review",
});

// Chain 2: Gọi API Gemini để tóm tắt bản tiếng Anh trong 1 câu.
// input: English_Review -> output: summary
const summaryChain = new LLMChain({
  llm: model,
  prompt: ChatPromptTemplate.fromTemplate(
    `Summarize the following review in 1 sentence:\n\n{English_Review}`,
  ),
  outputKey: "summary",
});

// Chain 3: Gọi API Gemini để xác định ngôn ngữ gốc của review.
// input: Review -> output: language
const languageChain = new LLMChain({
  llm: model,
  prompt: ChatPromptTemplate.fromTemplate(
    `What language is the following review:\n\n{Review}`,
  ),
  outputKey: "language",
});

// Chain 4: Gọi API Gemini để viết tin nhắn phản hồi.
// input: "summary" (output của chain 2) + "language" (output của chain 3)
// -> output: followup_message
const followupChain = new LLMChain({
  llm: model,
  prompt: ChatPromptTemplate.fromTemplate(
    `Write a follow up response to the following summary in the specified language:\n\nSummary: {summary}\n\nLanguage: {language}`,
  ),
  outputKey: "followup_message",
});

const overallChain = new SequentialChain({
  chains: [translateChain, summaryChain, languageChain, followupChain],
  inputVariables: ["Review"], // (các) biến bắt buộc phải cung cấp khi gọi overallChain.call(...)
  outputVariables: ["English_Review", "summary", "language", "followup_message"], // các biến muốn lấy ra ở kết quả cuối cùng
});

async function main() {
  const review = `Je trouve le goût médiocre. La mousse ne tient pas, c'est bizarre.`;

  // Chạy lần lượt 4 chain trên, mỗi chain là 1 lần gọi API Gemini.
  const result = await overallChain.call({ Review: review });

  console.log("English_Review:", result.English_Review);
  console.log("summary:", result.summary);
  console.log("language:", result.language);
  console.log("followup_message:", result.followup_message);
}

main();
