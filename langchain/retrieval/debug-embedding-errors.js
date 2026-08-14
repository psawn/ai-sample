require("dotenv").config();
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// embedDocuments() không throw khi 1 batch lỗi (tự nuốt lỗi bằng Promise.allSettled).
// Muốn thấy lỗi thật, phải log ở tầng thấp hơn: patch thẳng client.batchEmbedContents
// (hàm gọi HTTP tới Gemini) để in lỗi ra trước khi embedDocuments() kịp nuốt mất nó.
const originalBatchEmbedContents = embeddings.client.batchEmbedContents.bind(
  embeddings.client,
);

embeddings.client.batchEmbedContents = async (req) => {
  try {
    return await originalBatchEmbedContents(req);
  } catch (err) {
    console.error(
      `[batchEmbedContents LỖI] ${req.requests.length} chunk bị fail:`,
      err.status ?? err.code ?? "(không có status)",
      "-",
      err.message,
    );
    throw err;
  }
};

async function main() {
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
  console.log("Tổng số chunk:", splits.length);

  // Gọi trực tiếp embedDocuments (không qua fromDocuments/addDocuments nữa).
  // Lưu ý: embedDocuments() vẫn KHÔNG throw ra ngoài dù 1 batch con bị lỗi, vì bên trong nó
  // tự bắt lỗi bằng Promise.allSettled rồi trả vector rỗng [] thay vì reject cả hàm
  // -> catch bên dưới gần như sẽ không bao giờ chạy, đây chính là điều muốn chứng minh.
  const texts = splits.map((d) => d.pageContent);
  const vectors = await embeddings.embedDocuments(texts);

  const brokenCount = vectors.filter((v) => v.length === 0).length;
  console.log(`Số chunk bị vector rỗng: ${brokenCount}/${splits.length}`);

  if (brokenCount === 0) {
    console.log("Không có chunk nào lỗi lần này (batch API chạy trót lọt).");
  } else {
    console.log(
      "-> embedDocuments() trả về bình thường (không throw), dù có chunk lỗi bên trong.",
      "Lỗi thật từ Gemini bị thư viện nuốt mất, không có cách nào log ra bằng try/catch ở đây.",
    );
  }

  const vectordb = await MemoryVectorStore.fromExistingIndex(embeddings);
  await vectordb.addVectors(vectors, splits);

  const question = "what did they say about matlab?";
  // Nếu có chunk lỗi nằm trong top ứng viên, dòng này sẽ crash giống lỗi gốc ban đầu.
  await vectordb.maxMarginalRelevanceSearch(question, { k: 3, fetchK: 10 });
}

main();
