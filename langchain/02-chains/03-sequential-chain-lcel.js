// =======================================================================
// CHAINS - BƯỚC 3: SequentialChain (CÁCH MỚI - LCEL)
//
// Nối nhiều chain, mỗi chain có nhiều input/output có tên.
// Chain sau dùng được output của bất kỳ chain nào trước nó, không chỉ chain liền kề.
//
// RunnablePassthrough.assign({ tenBien: chain }):
// 1. Chạy chain.
// 2. Gộp kết quả vào object hiện có: thêm key mới, giữ nguyên key cũ.
//    (.pipe() thường thì thay toàn bộ object bằng kết quả mới.)
//
// Vd: chain 4 dùng cùng lúc "summary" (chain 2) và "language" (chain 3),
// vì cả 2 key vẫn còn trong object nhờ .assign().
//
// So sánh với cách cũ: 03-sequential-chain-legacy.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { RunnableSequence, RunnablePassthrough } = require("@langchain/core/runnables");

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0.7,
});

// Chain 1: dịch review sang tiếng Anh -> English_Review.
const translateChain = ChatPromptTemplate.fromTemplate(
  `Translate the following review to English:\n\n{Review}`,
)
  .pipe(model)
  .pipe(new StringOutputParser());

// Chain 2: tóm tắt bản tiếng Anh -> summary.
const summaryChain = ChatPromptTemplate.fromTemplate(
  `Summarize the following review in 1 sentence:\n\n{English_Review}`,
)
  .pipe(model)
  .pipe(new StringOutputParser());

// Chain 3: xác định ngôn ngữ gốc của review -> language.
const languageChain = ChatPromptTemplate.fromTemplate(
  `What language is the following review:\n\n{Review}`,
)
  .pipe(model)
  .pipe(new StringOutputParser());

// Chain 4: viết tin nhắn phản hồi -> followup_message.
// Input: summary (chain 2) + language (chain 3).
const followupChain = ChatPromptTemplate.fromTemplate(
  `Write a follow up response to the following summary in the specified language:\n\nSummary: {summary}\n\nLanguage: {language}`,
)
  .pipe(model)
  .pipe(new StringOutputParser());

// Mỗi assign() thêm 1 key mới, giữ nguyên các key cũ:
// - Ban đầu: { Review }
// - Sau chain 1: { Review, English_Review }
// - Sau chain 2: { Review, English_Review, summary }
// - Sau chain 3: { Review, English_Review, summary, language }
// -> Đến chain 4, object đã có đủ summary và language.
//
// Chain 2 và 3 không phụ thuộc nhau -> có thể gộp vào 1 assign({ summary, language })
// để chạy song song. Ở đây tách riêng cho giống bản legacy.
const overallChain = RunnableSequence.from([
  RunnablePassthrough.assign({ English_Review: translateChain }), // Chain 1
  RunnablePassthrough.assign({ summary: summaryChain }), // Chain 2
  RunnablePassthrough.assign({ language: languageChain }), // Chain 3
  RunnablePassthrough.assign({ followup_message: followupChain }), // Chain 4
]);

// ===== KỊCH BẢN MINH HỌA =====
// Input: 1 review tiếng Pháp.
async function main() {
  const review = `Je trouve le goût médiocre. La mousse ne tient pas, c'est bizarre.`;

  // Chạy lần lượt 4 chain, mỗi chain gọi Gemini 1 lần.
  const result = await overallChain.invoke({ Review: review });

  console.log("English_Review:", result.English_Review);
  console.log("summary:", result.summary);
  console.log("language:", result.language);
  console.log("followup_message:", result.followup_message);
}

main();
