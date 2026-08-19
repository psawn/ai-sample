require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { RunnableSequence, RunnablePassthrough } = require("@langchain/core/runnables");

// =======================================================
// SequentialChain (cách viết MỚI - LCEL)
//
// Giống bản cũ ("03-sequential-chain-legacy.js"): nối nhiều chain, mỗi
// chain có thể có nhiều input/output có tên, và chain sau có thể dùng
// lại output của BẤT KỲ chain nào chạy trước nó (không chỉ chain liền kề).
//
// Cách làm: RunnablePassthrough.assign({ tenBien: chainTuongUng })
// 1. Chạy chainTuongUng.
// 2. GỘP kết quả vào object hiện có: thêm key mới, giữ nguyên các key cũ
//    (khác với .pipe() thông thường sẽ THAY THẾ toàn bộ object bằng kết
//    quả mới).
// Nhờ vậy các biến trung gian (Review, English_Review, summary...) được
// giữ lại xuyên suốt cả chain.
//
// Ví dụ trong file này: chain 4 (followupChain) không lấy output của
// chain 3 (languageChain, đứng ngay trước nó), mà lấy output của CẢ
// chain 2 (summaryChain -> "summary") LẪN chain 3 (languageChain ->
// "language") cộng lại - vì cả 2 key đó vẫn còn trong object nhờ .assign().
// =======================================================

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0.7,
});

// Chain 1: Gọi API Gemini để dịch review sang tiếng Anh -> English_Review
const translateChain = ChatPromptTemplate.fromTemplate(
  `Translate the following review to English:\n\n{Review}`,
)
  .pipe(model)
  .pipe(new StringOutputParser());

// Chain 2: Gọi API Gemini để tóm tắt bản tiếng Anh -> summary
const summaryChain = ChatPromptTemplate.fromTemplate(
  `Summarize the following review in 1 sentence:\n\n{English_Review}`,
)
  .pipe(model)
  .pipe(new StringOutputParser());

// Chain 3: Gọi API Gemini để xác định ngôn ngữ gốc -> language
const languageChain = ChatPromptTemplate.fromTemplate(
  `What language is the following review:\n\n{Review}`,
)
  .pipe(model)
  .pipe(new StringOutputParser());

// Chain 4: Gọi API Gemini để viết tin nhắn phản hồi.
// input: "summary" (output của chain 2) + "language" (output của chain 3)
// output: followup_message
const followupChain = ChatPromptTemplate.fromTemplate(
  `Write a follow up response to the following summary in the specified language:\n\nSummary: {summary}\n\nLanguage: {language}`,
)
  .pipe(model)
  .pipe(new StringOutputParser());

// Mỗi assign() thêm 1 key mới vào object, giữ nguyên các key cũ
// - Ban đầu:            { Review }
// - Sau assign Chain 1: { Review, English_Review }
// - Sau assign Chain 2: { Review, English_Review, summary }
// - Sau assign Chain 3: { Review, English_Review, summary, language }
// - Đến chain 4, object đã có sẵn cả summary lẫn language.
const overallChain = RunnableSequence.from([
  RunnablePassthrough.assign({ English_Review: translateChain }), // Chain 1
  RunnablePassthrough.assign({ summary: summaryChain }), // Chain 2
  RunnablePassthrough.assign({ language: languageChain }), // Chain 3
  RunnablePassthrough.assign({ followup_message: followupChain }), // Chain 4
]);

async function main() {
  const review = `Je trouve le goût médiocre. La mousse ne tient pas, c'est bizarre.`;

  // Chạy lần lượt 4 chain trên, mỗi chain là 1 lần gọi API Gemini.
  const result = await overallChain.invoke({ Review: review });

  console.log("English_Review:", result.English_Review);
  console.log("summary:", result.summary);
  console.log("language:", result.language);
  console.log("followup_message:", result.followup_message);
}

main();
