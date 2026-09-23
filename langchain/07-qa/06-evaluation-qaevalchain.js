// =======================================================================
// QA - BƯỚC 6: ĐÁNH GIÁ RAG BẰNG QAEvalChain
//
// Dùng LLM làm "giám khảo" chấm hệ thống RAG.
//
// Flow:
// 1. Chuẩn bị bộ câu hỏi + đáp án đúng (examples).
// 2. Cho RAG trả lời từng câu -> predictions.
// 3. QAEvalChain so câu trả lời AI với đáp án -> CORRECT / INCORRECT.
//
// Giám khảo so ý nghĩa, không cần trùng từng chữ.
// Bản tự viết bằng LCEL (tùy biến được): 07-evaluation-lcel.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { CSVLoader } = require("@langchain/community/document_loaders/fs/csv");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const {
  GoogleGenerativeAIEmbeddings,
  ChatGoogleGenerativeAI,
} = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const {
  RunnableSequence,
  RunnablePassthrough,
} = require("@langchain/core/runnables");
const { StringOutputParser } = require("@langchain/core/output_parsers");
// QAEvalChain: chain "giám khảo" dựng sẵn, chấm CORRECT/INCORRECT.
const { QAEvalChain } = require("@langchain/classic/evaluation");
const path = require("path");

// Model embedding: đổi Document và câu hỏi thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// LLM dùng cho 2 việc: trả lời câu hỏi (qaChain) và chấm điểm (evalChain).
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

  // Bước 1: hệ thống RAG cần kiểm tra (giống 05-rag-chain-lcel.js).
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

  // Bước 3: chấm điểm.
  // Giám khảo nhận (câu hỏi, đáp án, câu trả lời AI) -> so ý nghĩa
  // -> trả CORRECT hoặc INCORRECT.
  const evalChain = QAEvalChain.fromLlm(llm);
  const gradedOutputs = await evalChain.evaluate(examples, predictions);

  console.log("\n========== Kết quả đánh giá (QAEvalChain) ==========");
  examples.forEach((example, i) => {
    console.log(`Example ${i}:`);
    console.log("Question: " + predictions[i].query);
    console.log("Real Answer: " + predictions[i].answer);
    console.log("Predicted Answer: " + predictions[i].result);
    console.log("Predicted Grade: " + gradedOutputs[i].text);
    console.log("-----------------------");
  });
}

main();
