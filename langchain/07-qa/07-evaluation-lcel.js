// =======================================================================
// QA - BƯỚC 7: ĐÁNH GIÁ RAG BẰNG CHAIN LCEL TỰ VIẾT
//
// Giống file 06, nhưng tự viết chain giám khảo thay QAEvalChain:
// 1. gradePrompt: điền câu hỏi + đáp án + câu trả lời AI.
// 2. llm: so ý nghĩa, trả JSON.
// 3. JsonOutputParser: text -> { grade }.
//
// Ưu điểm: tùy chỉnh tự do prompt chấm điểm và format kết quả.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { CSVLoader } = require("@langchain/community/document_loaders/fs/csv");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const {
  GoogleGenerativeAIEmbeddings,
  ChatGoogleGenerativeAI,
} = require("@langchain/google-genai");
const {
  ChatPromptTemplate,
  PromptTemplate,
} = require("@langchain/core/prompts");
const {
  RunnableSequence,
  RunnablePassthrough,
} = require("@langchain/core/runnables");
const {
  StringOutputParser,
  JsonOutputParser,
} = require("@langchain/core/output_parsers");
const path = require("path");

// Model embedding: đổi Document và câu hỏi thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// LLM dùng cho 2 việc: trả lời câu hỏi (qaChain) và chấm điểm (gradeChain).
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

const filePath = path.join(__dirname, "OutdoorClothingCatalog_1000.csv");
const loader = new CSVLoader(filePath);

// Ghép nội dung các document thành 1 đoạn text.
function formatDocuments(docs) {
  return docs.map((doc) => doc.pageContent).join("\n\n");
}

// Bộ câu hỏi kiểm thử, mỗi câu kèm đáp án đúng (người viết tự xác nhận).
const examples = [
  {
    query: "Do the Cozy Comfort Pullover Set have side pockets?",
    answer: "Yes",
  },
  {
    query:
      "What collection is the Ultra-Lofty 850 Stretch Down Hooded Jacket from?",
    answer: "The DownTek collection",
  },
];

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Chỉ lấy 90 document để không vượt rate limit của API embedding.
  // 2 sản phẩm trong examples nằm trong 90 dòng đầu.
  const docs = (await loader.load()).slice(0, 90);

  console.log("Loaded documents:", docs.length);

  // Embed từng Document, lưu vào RAM.
  const db = await MemoryVectorStore.fromDocuments(docs, embeddings);

  // Retriever: nhận câu hỏi -> trả k document liên quan nhất.
  const retriever = db.asRetriever({
    k: 4,
  });

  const prompt = ChatPromptTemplate.fromTemplate(
    `{documents}\n\nQuestion: {input}`,
  );

  // Bước 1: hệ thống RAG cần kiểm tra (giống file 06).
  // Tìm document -> nhét vào prompt -> LLM trả lời.
  const qaChain = RunnableSequence.from([
    RunnablePassthrough.assign({
      documents: async (input) => {
        const relevantDocs = await retriever.invoke(input.input);
        return formatDocuments(relevantDocs);
      },
    }),
    prompt,
    llm,
    new StringOutputParser(),
  ]);

  // Bước 2: cho RAG trả lời tất cả câu hỏi.
  // results[i] là câu trả lời AI cho examples[i], đúng thứ tự.
  const results = await qaChain.batch(
    examples.map((example) => ({ input: example.query })),
  );

  // "Bài làm" cần chấm: câu hỏi + đáp án đúng + câu trả lời AI (result).
  const predictions = examples.map((example, i) => ({
    query: example.query,
    answer: example.answer,
    result: results[i],
  }));

  // Bước 3: tự viết chain giám khảo.
  // Prompt yêu cầu LLM so ý nghĩa 2 câu trả lời, trả kết quả dạng JSON.
  // {{ }}: escape dấu { } trong PromptTemplate (không phải biến).
  const gradePrompt = PromptTemplate.fromTemplate(
    `Bạn là giám khảo chấm bài.

Câu hỏi: {query}
Đáp án đúng: {answer}
Câu trả lời cần chấm: {result}

Hãy xác định câu trả lời cần chấm có đúng ý với đáp án đúng hay không, dù cách diễn đạt
có thể khác nhau. Chỉ trả lời đúng định dạng JSON, không thêm chữ nào khác:
{{"grade": "CORRECT"}} hoặc {{"grade": "INCORRECT"}}`,
  );

  // JsonOutputParser: parse text của model thành object.
  // Lưu ý: chỉ đúng khi model chịu "chỉ trả JSON". Model viết thêm giải thích -> parse lỗi.
  //
  // So với tool_calls (../10-functions-tools-agents/03-tagging.js, 04-extraction.js):
  // tool_calls bị ép đúng schema nên đáng tin hơn. JsonOutputParser chỉ tìm
  // JSON trong văn bản tự do.
  //
  // Chain chấm điểm: prompt -> LLM -> parse JSON.
  const gradeChain = RunnableSequence.from([
    gradePrompt,
    llm,
    new JsonOutputParser(),
  ]);

  // Chấm song song tất cả predictions.
  const gradedOutputs = await gradeChain.batch(predictions);

  console.log("\n========== Kết quả đánh giá (LCEL tự viết) ==========");
  examples.forEach((example, i) => {
    console.log(`Example ${i}:`);
    console.log("Question: " + predictions[i].query);
    console.log("Real Answer: " + predictions[i].answer);
    console.log("Predicted Answer: " + predictions[i].result);
    console.log("Predicted Grade: " + gradedOutputs[i].grade);
    console.log();
  });
}

main();
