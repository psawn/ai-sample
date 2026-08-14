require("dotenv").config();
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const { embedChunksSafely } = require("./util-embed-safely");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

// Embedding Model: gọi API Gemini để biến Document / Query thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// Demo nhỏ, không cần PDF: 3 câu ngắn để thấy rõ điểm yếu của MMR chỉ trong vài dòng,
// trước khi vào demo phức tạp hơn trên PDF thật ở dưới.
async function demoMmrTradeoff() {
  const texts = [
    "The Amanita phalloides has a large and imposing fruiting body.", // chỉ nói "thân to"
    "A mushroom with a large fruiting body is the Amanita phalloides. Some varieties are all-white.", // "thân to" + "toàn trắng" -> khớp câu hỏi nhất
    "A. phalloides, a.k.a Death Cap, is one of the most poisonous of all known mushrooms.", // không liên quan gì tới câu hỏi
  ];
  const smalldb = await MemoryVectorStore.fromTexts(texts, [{}, {}, {}], embeddings);

  const question = "Tell me about all-white mushrooms with large fruiting bodies";

  // similaritySearch(question, 2): chỉ xếp theo độ liên quan riêng lẻ với câu hỏi.
  // text[0] và text[1] đều nói nhiều về "thân to" nên xếp hạng gần nhau nhất -> lấy cả 2,
  // dù 2 kết quả này gần như trùng ý nhau (lãng phí 1 trong 2 chỗ trống).
  const docsSS = await smalldb.similaritySearch(question, 2);
  console.log("=== [demo nấm] similaritySearch ===");
  docsSS.forEach((d) => console.log("-", d.pageContent));

  // maxMarginalRelevanceSearch: sau khi chọn kết quả liên quan nhất, MMR né tiếp kết quả
  // nào GIỐNG kết quả đã chọn -> có thể đổi sang text[2] (nói về độc tính, chả liên quan
  // gì tới câu hỏi) chỉ vì nó "khác biệt" nhất. Đây là lúc thấy rõ: MMR ưu tiên đa dạng
  // hơn liên quan, nên kết quả thứ 2 đôi khi lạc đề hoàn toàn.
  const docsMmr = await smalldb.maxMarginalRelevanceSearch(question, {
    k: 2,
    fetchK: 3,
  });
  console.log("\n=== [demo nấm] maxMarginalRelevanceSearch (MMR) ===");
  docsMmr.forEach((d) => console.log("-", d.pageContent));
}

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

  // Embed từng chunk an toàn (tự retry khi lỗi) rồi mới đưa vào vectorstore.
  // Xem lý do trong util-embed-safely.js.
  const vectors = await embedChunksSafely(embeddings, splits);
  const vectordb = await MemoryVectorStore.fromExistingIndex(embeddings);
  await vectordb.addVectors(vectors, splits);

  const question = "what did they say about matlab?";

  // similaritySearch thường: chỉ chọn theo độ liên quan -> nếu tài liệu có nhiều đoạn
  // nói cùng 1 ý, kết quả dễ bị trùng lặp nội dung.
  const docsSS = await vectordb.similaritySearch(question, 3); // 3 = số kết quả (k) muốn lấy về
  console.log("=== [demo PDF thật] similaritySearch ===");
  console.log("1:", docsSS[0].pageContent.slice(0, 100));
  console.log("2:", docsSS[1].pageContent.slice(0, 100));

  // MMR (Maximum Marginal Relevance): vừa liên quan tới câu hỏi vừa đa dạng giữa các kết quả,
  // nhờ đó tránh lãng phí chỗ trong prompt gửi LLM cho nhiều đoạn nói cùng 1 nội dung.
  // k: số kết quả cuối cùng trả về. fetchK: số ứng viên lấy trước để MMR chọn lọc (phải > k).
  const docsMmr = await vectordb.maxMarginalRelevanceSearch(question, {
    k: 3,
    fetchK: 10,
  });
  console.log("\n=== [demo PDF thật] maxMarginalRelevanceSearch (MMR) ===");
  console.log("1:", docsMmr[0].pageContent.slice(0, 100));
  console.log("2:", docsMmr[1].pageContent.slice(0, 100));
}

async function main() {
  await demoMmrTradeoff();
  await demoMmrOnRealPdf();
}

main();
