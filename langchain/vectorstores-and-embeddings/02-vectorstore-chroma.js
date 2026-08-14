require("dotenv").config();
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const {
  RecursiveCharacterTextSplitter,
} = require("@langchain/textsplitters");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { Chroma } = require("@langchain/community/vectorstores/chroma");

// Chroma cần 1 server chạy nền (khác MemoryVectorStore chạy trong RAM).
// Chạy server bằng Docker trước khi chạy file này:
//   docker run -d --name chroma -p 8000:8000 chromadb/chroma
// Dữ liệu được lưu trong collection cố định bên dưới, nên các lần chạy sau
// sẽ tái sử dụng vector đã embed thay vì gọi lại API embedding.

// Khởi tạo mô hình Embedding của Gemini (model: gemini-embedding-001),
// dùng để gọi API Gemini, chuyển Document / Query thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

async function main() {
  const pdfPath = path.join(
    __dirname,
    "../../docs/cs229_lectures/MachineLearning-Lecture01.pdf",
  );
  const docs = await new PDFLoader(pdfPath).load();

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1500,
    chunkOverlap: 150,
  });
  const splits = await textSplitter.splitDocuments(docs);
  console.log("Số chunk sau khi split:", splits.length);

  const vectordb = new Chroma(embeddings, {
    collectionName: "cs229-lecture01",
    url: "http://localhost:8000",
  });

  let existingCount = 0;
  try {
    await vectordb.ensureCollection();
    existingCount = await vectordb.collection.count();
  } catch (err) {
    console.error(
      "Không kết nối được Chroma server. Hãy chạy trước:\n" +
        "  docker run -d --name chroma -p 8000:8000 chromadb/chroma",
    );
    throw err;
  }

  if (existingCount === 0) {
    await vectordb.addDocuments(splits);
    console.log("Đã embed và lưu", splits.length, "chunk vào Chroma.");
  } else {
    console.log(
      "Collection đã có sẵn",
      existingCount,
      "vector, bỏ qua bước embed.",
    );
  }

  // similaritySearch: embed câu hỏi rồi tìm k chunk có vector gần nhất trong vectordb.
  const question = "is there an email i can ask for help";
  const results = await vectordb.similaritySearch(question, 3);
  console.log("\n=== Similarity search: email hỗ trợ ===");
  console.log(results[0].pageContent);
}

main();
