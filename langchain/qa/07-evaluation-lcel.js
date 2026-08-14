require("dotenv").config();

const { CSVLoader } = require("@langchain/community/document_loaders/fs/csv");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
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

// Embedding Model: gọi API Gemini (model gemini-embedding-001) để biến Document / Query thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// LLM: gọi API Gemini (model gemini-3.5-flash) cho 2 việc - trả lời câu hỏi (qaChain) và chấm điểm câu trả lời (gradeChain).
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

  // Retriever: khi invoke, gọi API Gemini để tạo vector cho câu hỏi, so sánh với các vector
  // Document trong RAM để tìm ra những đoạn nội dung liên quan nhất làm ngữ cảnh trả lời.
  const retriever = db.asRetriever({
    k: 4,
  });

  const prompt = ChatPromptTemplate.fromTemplate(
    `{documents}\n\nQuestion: {input}`,
  );

  // RAG chain: tìm document liên quan -> nhét vào prompt -> gọi LLM sinh câu trả lời.
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
  // AI vừa sinh ra (result), để đưa vào gradeChain.batch() so sánh ở bước tiếp theo.
  const predictions = examples.map((example, i) => ({
    query: example.query,
    answer: example.answer,
    result: results[i],
  }));

  // Prompt giám khảo: đưa câu hỏi, đáp án đúng và câu trả lời AI sinh ra vào, yêu cầu LLM
  // nhận xét 2 câu trả lời có cùng ý nghĩa hay không (dù diễn đạt khác nhau) và trả
  // kết quả dạng JSON. Đây là phần "kiểu mới" - tự viết chain chấm điểm thay vì dùng
  // 1 chain dựng sẵn, nên có thể tuỳ chỉnh prompt hoặc định dạng kết quả tự do.
  const gradePrompt = PromptTemplate.fromTemplate(
    `Bạn là giám khảo chấm bài.

Câu hỏi: {query}
Đáp án đúng: {answer}
Câu trả lời cần chấm: {result}

Hãy xác định câu trả lời cần chấm có đúng ý với đáp án đúng hay không, dù cách diễn đạt
có thể khác nhau. Chỉ trả lời đúng định dạng JSON, không thêm chữ nào khác:
{{"grade": "CORRECT"}} hoặc {{"grade": "INCORRECT"}}`,
  );

  // Chain chấm điểm: prompt -> gọi LLM -> parse kết quả JSON trả về.
  const gradeChain = RunnableSequence.from([
    gradePrompt,
    llm,
    new JsonOutputParser(),
  ]);

  // Chấm điểm hàng loạt cho toàn bộ predictions cùng lúc.
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
