// =======================================================================
// RETRIEVAL - BƯỚC 1: SIMILARITY SEARCH vs MMR
//
// 1. Similarity search: chỉ chọn kết quả liên quan nhất -> dễ trùng ý nhau.
// 2. MMR (Maximum Marginal Relevance): vừa liên quan, vừa đa dạng.
//    - Chọn kết quả liên quan nhất trước.
//    - Kết quả sau né những cái giống kết quả đã chọn.
//
// Đánh đổi: MMR ưu tiên đa dạng, nên đôi khi chọn kết quả lạc đề.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const { embedChunksSafely } = require("./util-embed-safely");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

// Model embedding: đổi Document và câu hỏi thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// Demo 1: 3 câu ngắn về nấm. Thấy rõ điểm yếu của MMR chỉ trong vài dòng.
async function demoMmrTradeoff() {
  const texts = [
    "The Amanita phalloides has a large and imposing fruiting body.", // Chỉ nói "thân to"
    "A mushroom with a large fruiting body is the Amanita phalloides. Some varieties are all-white.", // "Thân to" + "toàn trắng" -> khớp câu hỏi nhất
    "A. phalloides, a.k.a Death Cap, is one of the most poisonous of all known mushrooms.", // Không liên quan câu hỏi
  ];
  const smalldb = await MemoryVectorStore.fromTexts(texts, [{}, {}, {}], embeddings);

  const question = "Tell me about all-white mushrooms with large fruiting bodies";

  // similaritySearch: chỉ xếp theo độ liên quan.
  // -> Lấy text[0] và text[1] (đều nói "thân to"), dù 2 câu gần như trùng ý.
  const docsSS = await smalldb.similaritySearch(question, 2);
  console.log("=== [demo nấm] similaritySearch ===");
  docsSS.forEach((d) => console.log("-", d.pageContent));

  // MMR: kết quả thứ 2 né những câu giống kết quả đầu.
  // -> Có thể chọn text[2] (nói về độc tính, lạc đề) chỉ vì nó khác biệt nhất.
  const docsMmr = await smalldb.maxMarginalRelevanceSearch(question, {
    k: 2,
    fetchK: 3,
  });
  console.log("\n=== [demo nấm] maxMarginalRelevanceSearch (MMR) ===");
  docsMmr.forEach((d) => console.log("-", d.pageContent));
}

// Demo 2: so sánh trên PDF thật (3 lecture CS229).
async function demoMmrOnRealPdf() {
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

  // Embed có retry khi lỗi, rồi mới đưa vào vectorstore.
  // Lý do: util-embed-safely.js.
  const vectors = await embedChunksSafely(embeddings, splits);
  const vectordb = await MemoryVectorStore.fromExistingIndex(embeddings);
  await vectordb.addVectors(vectors, splits);

  const question = "what did they say about matlab?";

  // similaritySearch: tài liệu có nhiều đoạn cùng ý -> kết quả dễ trùng lặp.
  const docsSS = await vectordb.similaritySearch(question, 3); // k = 3 kết quả
  console.log("=== [demo PDF thật] similaritySearch ===");
  console.log("1:", docsSS[0].pageContent.slice(0, 100));
  console.log("2:", docsSS[1].pageContent.slice(0, 100));

  // MMR: kết quả đa dạng hơn, không phí chỗ trong prompt cho các đoạn cùng ý.
  // - k: số kết quả cuối cùng trả về.
  // - fetchK: số ứng viên lấy trước để MMR chọn lọc (phải > k).
  const docsMmr = await vectordb.maxMarginalRelevanceSearch(question, {
    k: 3,
    fetchK: 10,
  });
  console.log("\n=== [demo PDF thật] maxMarginalRelevanceSearch (MMR) ===");
  console.log("1:", docsMmr[0].pageContent.slice(0, 100));
  console.log("2:", docsMmr[1].pageContent.slice(0, 100));
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  await demoMmrTradeoff();
  await demoMmrOnRealPdf();
}

main();
