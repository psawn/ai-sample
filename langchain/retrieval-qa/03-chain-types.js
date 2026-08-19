require("dotenv").config();

const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const {
  GoogleGenerativeAIEmbeddings,
  ChatGoogleGenerativeAI,
} = require("@langchain/google-genai");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
// loadQAChain: tạo document chain kiểu cũ (không phải LCEL) nhưng vẫn hỗ trợ
// đủ 3 chain_type mà bản Python minh hoạ - "stuff", "map_reduce", "refine".
// Bản LCEL hiện tại (createStuffDocumentsChain) chỉ có sẵn cho "stuff", nên ở
// đây dùng loadQAChain để giữ đúng tinh thần so sánh 3 chiến lược của bài học.
const { loadQAChain } = require("langchain/chains");
const { embedChunksSafely } = require("../retrieval/util-embed-safely");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

async function buildVectorDb() {
  const pdfPaths = [
    path.join(lecturesDir, "MachineLearning-Lecture01.pdf"),
    path.join(lecturesDir, "MachineLearning-Lecture02.pdf"),
    path.join(lecturesDir, "MachineLearning-Lecture03.pdf"),
  ];

  let docs = [];
  for (const pdfPath of pdfPaths) {
    docs = docs.concat(await new PDFLoader(pdfPath).load());
  }

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1500,
    chunkOverlap: 150,
  });
  const splits = await textSplitter.splitDocuments(docs);

  const vectors = await embedChunksSafely(embeddings, splits);
  const vectordb = await MemoryVectorStore.fromExistingIndex(embeddings);
  await vectordb.addVectors(vectors, splits);
  return vectordb;
}

// Chạy 1 chain_type và trả về câu trả lời, để dễ so sánh 3 kiểu trong hàm main.
async function askWithChainType(chainType, retriever, question) {
  // Lấy sẵn danh sách chunk liên quan (input_documents) - loadQAChain không tự
  // gọi retriever như createRetrievalChain, phải truyền document vào tay.
  const relevantDocs = await retriever.invoke(question);

  const chain = loadQAChain(llm, { type: chainType });
  const result = await chain.call({
    input_documents: relevantDocs,
    question,
  });
  return result.text;
}

async function main() {
  const vectordb = await buildVectorDb();
  const retriever = vectordb.asRetriever({ k: 3 });

  const question = "Is probability a class topic?";

  // "stuff":
  // 1. Nhét toàn bộ chunk vào 1 prompt duy nhất.
  // 2. Gọi LLM 1 lần để sinh câu trả lời.
  // Nhanh, rẻ, nhưng nếu chunk quá nhiều/dài sẽ vượt giới hạn context của LLM.
  const stuffAnswer = await askWithChainType("stuff", retriever, question);
  console.log("=== stuff ===");
  console.log(stuffAnswer);

  // "map_reduce":
  // 1. Map: gọi LLM riêng cho từng chunk để tóm tắt.
  // 2. Reduce: gọi thêm 1 lần LLM để gộp các tóm tắt đó thành câu trả lời cuối.
  // Xử lý được nhiều chunk hơn "stuff", nhưng tốn nhiều lượt gọi LLM hơn và chạy chậm
  // hơn vì các chunk được xử lý độc lập, không "nhìn thấy" nhau.
  const mapReduceAnswer = await askWithChainType(
    "map_reduce",
    retriever,
    question,
  );
  console.log("\n=== map_reduce ===");
  console.log(mapReduceAnswer);

  // "refine":
  // 1. Gọi LLM trả lời dựa trên chunk đầu tiên.
  // 2. Lần lượt đưa từng chunk còn lại vào để LLM "tinh chỉnh" (refine) lại câu trả lời
  //    trước đó.
  // Giữ được mạch ngữ cảnh xuyên suốt các chunk (tốt hơn map_reduce), nhưng chạy tuần tự
  // (không song song được) nên thường là kiểu chậm nhất.
  const refineAnswer = await askWithChainType("refine", retriever, question);
  console.log("\n=== refine ===");
  console.log(refineAnswer);
}

main();
