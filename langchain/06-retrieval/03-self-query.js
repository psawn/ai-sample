// =======================================================================
// RETRIEVAL - BƯỚC 3: SELF-QUERY RETRIEVER
//
// Để LLM tự viết filter, thay vì viết tay như file 02.
//
// Flow:
// 1. Đưa câu hỏi tự nhiên cho LLM.
// 2. LLM tách thành 2 phần:
//    - query: phần dùng để tìm vector (vd: "regression").
//    - filter: điều kiện lọc metadata (vd: source = Lecture03).
// 3. Tìm vector theo query, chỉ trong các chunk thỏa filter.
//
// metadataFieldInfo: mô tả ý nghĩa từng field metadata, để LLM suy ra filter đúng.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const {
  GoogleGenerativeAIEmbeddings,
  ChatGoogleGenerativeAI,
} = require("@langchain/google-genai");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const { SelfQueryRetriever } = require("@langchain/classic/retrievers/self_query");
const {
  FunctionalTranslator,
} = require("@langchain/classic/retrievers/self_query/functional");
const { AttributeInfo } = require("@langchain/classic/chains/query_constructor");
const { embedChunksSafely } = require("./util-embed-safely");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

// Model embedding: đổi Document và câu hỏi thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// LLM: đọc câu hỏi tự nhiên, tách ra query + filter metadata.
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const pdfPaths = [
    path.join(lecturesDir, "MachineLearning-Lecture01.pdf"),
    path.join(lecturesDir, "MachineLearning-Lecture02.pdf"),
    path.join(lecturesDir, "MachineLearning-Lecture03.pdf"),
  ];

  let docs = [];
  for (const pdfPath of pdfPaths) {
    const pages = await new PDFLoader(pdfPath).load();
    // metadata.source mặc định là đường dẫn tuyệt đối (khác nhau tùy máy).
    // Đổi về tên file để khớp với mô tả trong metadataFieldInfo bên dưới.
    pages.forEach((p) => {
      p.metadata.source = path.basename(pdfPath);
    });
    docs = docs.concat(pages);
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

  // Mô tả các field metadata cho LLM. Mô tả càng rõ, filter LLM sinh ra càng đúng.
  const metadataFieldInfo = [
    new AttributeInfo({
      name: "source",
      description:
        "The lecture the chunk is from, should be one of `MachineLearning-Lecture01.pdf`, `MachineLearning-Lecture02.pdf`, or `MachineLearning-Lecture03.pdf`",
      type: "string",
    }),
    new AttributeInfo({
      name: "loc.pageNumber",
      description: "The page number the chunk is from",
      type: "number",
    }),
  ];

  const selfQueryRetriever = SelfQueryRetriever.fromLLM({
    llm,
    vectorStore: vectordb,
    documentContents: "Lecture notes",
    attributeInfo: metadataFieldInfo,
    // Đổi filter LLM sinh ra thành hàm (doc) => boolean cho MemoryVectorStore.
    // Mỗi loại vectorstore cần 1 translator riêng.
    structuredQueryTranslator: new FunctionalTranslator(),
    verbose: true, // In query + filter LLM suy ra, để dễ kiểm tra
  });

  // Kỳ vọng: chỉ trả chunk thuộc MachineLearning-Lecture03.pdf.
  const question = "what did they say about regression in the third lecture?";
  const results = await selfQueryRetriever.invoke(question);

  console.log("=== Self-query retriever ===");
  results.forEach((d) =>
    console.log(d.metadata.source, "- trang", d.metadata.loc?.pageNumber),
  );
}

main();
