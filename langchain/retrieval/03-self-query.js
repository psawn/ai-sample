require("dotenv").config();
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const {
  GoogleGenerativeAIEmbeddings,
  ChatGoogleGenerativeAI,
} = require("@langchain/google-genai");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const { SelfQueryRetriever } = require("langchain/retrievers/self_query");
const {
  FunctionalTranslator,
} = require("langchain/retrievers/self_query/functional");
const { AttributeInfo } = require("langchain/chains/query_constructor");
const { embedChunksSafely } = require("./util-embed-safely");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

// Embedding Model: gọi API Gemini để biến Document / Query thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// LLM: đọc câu hỏi tiếng Anh tự nhiên và tự tách ra query + filter metadata.
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

async function main() {
  const pdfPaths = [
    path.join(lecturesDir, "MachineLearning-Lecture01.pdf"),
    path.join(lecturesDir, "MachineLearning-Lecture02.pdf"),
    path.join(lecturesDir, "MachineLearning-Lecture03.pdf"),
  ];

  let docs = [];
  for (const pdfPath of pdfPaths) {
    const pages = await new PDFLoader(pdfPath).load();
    // PDFLoader trả metadata.source là đường dẫn tuyệt đối (khác nhau tuỳ máy).
    // Đổi về tên file cho gọn, để khớp với mô tả filter khai báo bên dưới.
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

  // Embed từng chunk an toàn (tự retry khi lỗi) rồi mới đưa vào vectorstore.
  // Xem lý do trong util-embed-safely.js.
  const vectors = await embedChunksSafely(embeddings, splits);
  const vectordb = await MemoryVectorStore.fromExistingIndex(embeddings);
  await vectordb.addVectors(vectors, splits);

  // Ở file 01, ta phải tự tay viết filter (doc) => boolean. Self-query retriever thay ta
  // làm việc đó theo luồng:
  // 1. Đưa cho LLM 1 câu hỏi tiếng Anh tự nhiên.
  // 2. LLM tự tách câu hỏi thành 2 phần:
  //    - query: phần dùng để tìm vector (vd: "regression")
  //    - filter: điều kiện lọc metadata (vd: source = Lecture03)
  // 3. metadataFieldInfo mô tả cho LLM biết mỗi field metadata nghĩa là gì để nó suy luận đúng.
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
    // FunctionalTranslator: chuyển filter LLM sinh ra thành hàm (doc) => boolean
    // để chạy trên MemoryVectorStore (mỗi loại vectorstore cần 1 translator riêng).
    structuredQueryTranslator: new FunctionalTranslator(),
    verbose: true, // in ra query + filter mà LLM suy luận được, để dễ kiểm tra
  });

  const question = "what did they say about regression in the third lecture?";
  const results = await selfQueryRetriever.invoke(question);

  console.log("=== Self-query retriever ===");
  results.forEach((d) =>
    console.log(d.metadata.source, "- trang", d.metadata.loc?.pageNumber),
  );
}

main();
