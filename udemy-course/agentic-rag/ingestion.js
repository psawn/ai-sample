// =======================================================================
// INGESTION: Nạp blog từ URLS vào Chroma và cung cấp retriever để tìm kiếm.
//
// Quy trình: Load (tải web) -> Split (cắt chunk) -> Embed & Store (lưu Chroma)
// - URL mới: Nạp vào Chroma.
// - URL cũ (đã embed): Bỏ qua, không gọi API lại.
//
// Export getRetriever() cho node retrieve (graph/nodes/retrieve.js) dùng.
// =======================================================================

require("../../langchain/_polyfill");
require("dotenv").config();

const { randomUUID } = require("crypto");

// Dùng bản "slim" vì cheerio bản đầy đủ yêu cầu Node 20+
const { GoogleGeminiEmbeddingFunction } = require("@chroma-core/google-gemini");
const { Document } = require("@langchain/core/documents");
const { BaseRetriever } = require("@langchain/core/retrievers");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const cheerio = require("cheerio/slim");
const { ChromaClient } = require("chromadb");
const { getEncoding } = require("js-tiktoken");

// ===== 1. CẤU HÌNH =====

// LƯU Ý: Thêm/bớt URL -> sửa luôn danh sách chủ đề trong system prompt
// của graph/chains/router.js. Không thì router chọn sai nguồn (không báo lỗi).
const URLS = [
  // Link gốc của bài giảng: mạng công ty chặn (URL Filtering) -> thay bằng
  // trang cùng chủ đề trên promptingguide.ai
  // "https://lilianweng.github.io/posts/2023-06-23-agent/",
  // "https://lilianweng.github.io/posts/2023-03-15-prompt-engineering/",
  // "https://lilianweng.github.io/posts/2023-10-25-adv-attack-llm/",
  "https://www.promptingguide.ai/research/llm-agents", // agents
  "https://www.promptingguide.ai/introduction/tips", // prompt engineering
  "https://www.promptingguide.ai/risks/adversarial", // adversarial attacks
];

const COLLECTION_NAME = "rag-chroma";
const EMBED_BATCH_SIZE = 100; // Giới hạn tối đa 100 text/request của Gemini API

const chroma = new ChromaClient({
  host: process.env.CHROMA_HOST || "localhost",
  port: Number(process.env.CHROMA_PORT) || 8000,
});

// Model embedding: biến văn bản thành vector
const embeddingFunction = new GoogleGeminiEmbeddingFunction({
  apiKey: process.env.GEMINI_API_KEY,
  modelName: "gemini-embedding-001",
});

// ===== 2. INGESTION PIPELINE =====

/**
 * Bước 1 - Load: Tải HTML từng URL và lấy nội dung trong thẻ <article>.
 */
async function loadDocuments(urls) {
  return Promise.all(
    urls.map(async (url) => {
      const html = await (await fetch(url)).text();
      const page = cheerio.load(html);
      const text = page("article").text().trim();

      if (!text) throw new Error(`Không lấy được nội dung từ ${url}`);

      return new Document({
        pageContent: text,
        metadata: { source: url, title: page("title").text() },
      });
    }),
  );
}

/**
 * Bước 2 - Split: Cắt tài liệu thành các chunk nhỏ (tối đa 250 token).
 * Dùng tiktoken đếm số token thay vì số ký tự.
 */
async function splitDocuments(docs) {
  const encoder = getEncoding("cl100k_base");

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 250,
    chunkOverlap: 0,
    lengthFunction: (text) => encoder.encode(text).length,
  });

  return textSplitter.splitDocuments(docs);
}

/**
 * Bước 3 - Embed & Store: Lưu chunk vào Chroma (Chroma tự gọi Gemini tạo vector).
 * Chia batch 100 chunk/lần vì Gemini giới hạn 100 text/request.
 */
async function storeChunks(collection, chunks) {
  for (let start = 0; start < chunks.length; start += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(start, start + EMBED_BATCH_SIZE);
    await collection.add({
      ids: batch.map(() => randomUUID()), // ID ngẫu nhiên: tránh trùng giữa các lần nạp
      documents: batch.map((chunk) => chunk.pageContent),
      metadatas: batch.map(({ metadata }) => ({
        source: metadata.source,
        title: metadata.title,
      })),
    });
  }
}

/**
 * Lọc ra các URL chưa embed (chưa có chunk nào mang `source` = URL đó).
 */
async function filterNewUrls(collection, urls) {
  const results = await Promise.all(
    urls.map((url) => collection.get({ where: { source: url }, limit: 1 })),
  );
  return urls.filter((_, i) => results[i].ids.length === 0);
}

// ===== 3. RETRIEVER =====

/**
 * Custom Retriever kế thừa BaseRetriever của LangChain.
 * - `invoke(question)`: có sẵn ở lớp cha, tự gọi `_getRelevantDocuments`.
 * - `_getRelevantDocuments(question)`: hàm mình tự viết để tìm chunk trong Chroma.
 */
class ChromaRetriever extends BaseRetriever {
  // Định danh class khi LangChain ghi log: <thư mục>/<bài>/<loại>
  lc_namespace = ["udemy-course", "agentic-rag", "retrievers"];

  constructor(collection, k = 4) {
    super();
    this.collection = collection;
    this.k = k; // Số chunk trả về mỗi lần tìm
  }

  // Phải đặt đúng tên này (1 dấu gạch dưới): invoke() của lớp cha sẽ tự gọi
  async _getRelevantDocuments(question) {
    const result = await this.collection.query({
      queryTexts: [question],
      nResults: this.k,
    });

    // rows().queries[0]: kết quả của câu hỏi đầu tiên (chỉ gửi 1 câu)
    return result
      .rows()
      .queries[0].map(
        (row) =>
          new Document({ pageContent: row.document, metadata: row.metadata }),
      );
  }
}

/**
 * Trả về 1 đối tượng ChromaRetriever (class ở trên) gắn với collection trong Chroma.
 * - Gọi .invoke(question) -> nhận về 4 chunk giống câu hỏi nhất.
 * - Node retrieve (graph/nodes/retrieve.js) dùng nó để tìm chunk.
 *
 * Trước khi trả về: URL nào chưa có trong Chroma thì nạp vào.
 */
async function getRetriever() {
  // Mở collection (chưa có thì tạo mới). Gắn embeddingFunction
  // -> Chroma tự gọi Gemini embed khi thêm/tìm chunk.
  const collection = await chroma.getOrCreateCollection({
    name: COLLECTION_NAME,
    embeddingFunction,
  });

  // Lọc ra URL chưa embed, URL đã có thì bỏ qua
  const newUrls = await filterNewUrls(collection, URLS);
  const skipped = URLS.length - newUrls.length;
  if (skipped > 0) console.log(`Bỏ qua ${skipped} URL đã embed.`);

  // Chỉ nạp khi có URL mới
  if (newUrls.length > 0) {
    const docs = await loadDocuments(newUrls); // Bước 1 - Load
    const chunks = await splitDocuments(docs); // Bước 2 - Split
    await storeChunks(collection, chunks); // Bước 3 - Embed & Store
    console.log(
      `Đã nạp ${chunks.length} chunk từ ${docs.length} trang vào Chroma.`,
    );
  }

  // Chỉ tạo retriever, chưa tìm gì. Tìm chunk chạy khi gọi retriever.invoke()
  return new ChromaRetriever(collection);
}

module.exports = { getRetriever };
