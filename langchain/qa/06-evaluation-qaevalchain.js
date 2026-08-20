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
// QAEvalChain: chain dựng sẵn của LangChain,
// đóng vai trò "giám khảo" - gọi LLM để so sánh câu trả lời AI sinh ra với đáp án đúng, rồi chấm CORRECT/INCORRECT.
const { QAEvalChain } = require("@langchain/classic/evaluation");
const path = require("path");

// Embedding Model: gọi API Gemini (model gemini-embedding-001) để biến Document / Query thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// LLM: gọi API Gemini (model gemini-3.5-flash) cho 2 việc - trả lời câu hỏi (qaChain) và chấm điểm câu trả lời (evalChain).
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

const filePath = path.join(__dirname, "OutdoorClothingCatalog_1000.csv");
const loader = new CSVLoader(filePath);

function formatDocuments(docs) {
  return docs.map((doc) => doc.pageContent).join("\n\n");
}

// Bộ câu hỏi kiểm thử: mỗi câu hỏi kèm sẵn đáp án đúng (do người viết tự xác nhận),
// dùng làm "chuẩn" để so sánh với câu trả lời mà hệ thống RAG (AI) sinh ra.
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

async function main() {
  // Giới hạn số document để tránh vượt rate limit của API embedding.
  const docs = (await loader.load()).slice(0, 90);

  console.log("Loaded documents:", docs.length);

  // Gọi API Gemini để tạo vector cho từng Document, lưu Document + vector vào MemoryVectorStore trong RAM.
  const db = await MemoryVectorStore.fromDocuments(docs, embeddings);

  // Retriever: khi invoke sẽ:
  // 1. Gọi API Gemini để tạo vector cho câu hỏi.
  // 2. So sánh với các vector Document trong RAM để tìm ra những đoạn nội dung liên quan nhất làm ngữ cảnh trả lời.
  const retriever = db.asRetriever({
    k: 4,
  });

  const prompt = ChatPromptTemplate.fromTemplate(
    `{documents}\n\nQuestion: {input}`,
  );

  // RAG chain:
  // 1. Tìm document liên quan.
  // 2. Nhét vào prompt.
  // 3. Gọi LLM sinh câu trả lời.
  // Đây là hệ thống mà ta muốn kiểm tra độ chính xác.
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

  // results: cho qaChain trả lời từng query trong examples (gọi API Gemini),
  // results[i] là câu trả lời do AI sinh ra ứng với examples[i], theo đúng thứ tự.
  // Đây chỉ là câu trả lời AI đoán được, có thể khác với answer chuẩn.
  const results = await qaChain.batch(
    examples.map((example) => ({ input: example.query })),
  );

  // predictions: "bài làm" cần chấm - ghép query/answer chuẩn với câu trả lời
  // AI vừa sinh ra (result), để đưa vào evalChain.evaluate() so sánh ở bước tiếp theo.
  const predictions = examples.map((example, i) => ({
    query: example.query,
    answer: example.answer,
    result: results[i],
  }));

  // QAEvalChain.fromLlm dựng sẵn 1 chain giám khảo:
  // 1. Nhận vào (câu hỏi, đáp án đúng, câu trả lời AI sinh ra).
  // 2. Gọi LLM để nhận xét 2 câu trả lời có cùng ý nghĩa không, dù cách diễn đạt khác nhau.
  // 3. Trả về CORRECT hoặc INCORRECT.
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
