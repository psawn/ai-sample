// =======================================================================
// DEMO: INGESTION - NẠP TÀI LIỆU VÀO VECTOR DATABASE (BƯỚC 1 RAG)
//
// Luồng xử lý (Flow):
//   main
//    ├─ prepareVectorStore : Kết nối DB & tạo Vector Index (nếu chưa có).
//    ├─ ingestTextFile     : Nguồn 1 - File .txt cục bộ.
//    ├─ ingestWebsite      : Nguồn 2 - Website, chọn 1 trong 2 cách:
//    │    ├─ Cách 1: crawlWebsite         (TavilyCrawl)
//    │    └─ Cách 2: mapAndExtractWebsite (TavilyMap -> TavilyExtract)
//    └─ printSummary       : Báo cáo tổng số tài liệu và chunk đã lưu.
//
// Quy trình 4 bước cho mỗi nguồn:
// 1. Load          : Đọc dữ liệu -> Document { pageContent, metadata }.
// 2. Filter        : Bỏ qua nội dung chưa thay đổi (so sánh contentHash).
// 3. Split         : Cắt văn bản thành các đoạn nhỏ (chunks).
// 4. Embed & Store : Chuyển chunk thành vector, lưu DB theo batch song song.
// -> Bước 1 viết riêng cho từng nguồn; Bước 2-4 dùng chung (ingestDocuments).
// =======================================================================

require("../langchain/_polyfill");
require("dotenv").config();

const path = require("path");
const { createHash } = require("crypto");
const { MongoClient } = require("mongodb");
const { Document } = require("@langchain/core/documents");
const { RunnableLambda } = require("@langchain/core/runnables");
const { TextLoader } = require("@langchain/classic/document_loaders/fs/text");
const {
  CharacterTextSplitter,
  RecursiveCharacterTextSplitter,
} = require("@langchain/textsplitters");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { MongoDBAtlasVectorSearch } = require("@langchain/mongodb");
const { TavilyCrawl, TavilyMap, TavilyExtract } = require("@langchain/tavily");
const {
  Colors,
  logInfo,
  logSuccess,
  logError,
  logWarning,
  logHeader,
} = require("./logger");

// ===== 1. CẤU HÌNH =====

// --- Nguồn 1: File .txt ---
const TEXT_FILE_PATH = path.join(
  __dirname,
  "../docs/cs229_lectures/mediumblog1.txt",
);

// --- Nguồn 2: Website (Tavily) ---
const CRAWL_URL = "https://python.langchain.com/";

// Cấu hình phạm vi quét cho TavilyCrawl và TavilyMap
const CRAWL_OPTIONS = {
  maxDepth: 3, // Đi sâu tối đa 3 tầng link
  limit: 50, // Lấy tối đa 50 trang
  selectDomains: ["^docs\\.langchain\\.com$"], // Chỉ cào trang docs
  instructions: "Documentation relevant to AI agents", // Lọc nội dung AI agent (tốn x2 credit)
};

// Độ chi tiết khi trích xuất: "basic" (rẻ, nhanh) hoặc "advanced" (lấy cả bảng/mã nhúng)
const EXTRACT_DEPTH = "advanced";

const EXTRACT_BATCH_SIZE = 20; // Giới hạn 20 URL/request của TavilyExtract
const TAVILY_MAX_ATTEMPTS = 3; // Số lần retry tối đa khi gọi Tavily lỗi

// --- Vector Store (MongoDB + Gemini) ---
const EMBED_BATCH_SIZE = 100; // Giới hạn 100 text/request của Gemini API

// Khóa lưu trong MongoDB (phải khớp cấu hình Vector Index)
const TEXT_KEY = "text"; // Field lưu nội dung văn bản
const EMBEDDING_KEY = "embedding"; // Field lưu mảng vector

// ===== 2. MAIN - FLOW TỔNG =====

async function main() {
  logHeader("DOCUMENTATION INGESTION PIPELINE");
  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    // Kết nối DB và khởi tạo Vector Store
    const { collection, vectorStore } = await prepareVectorStore(client);

    // Chạy nạp dữ liệu song song/tuần tự từ các nguồn
    const allStats = [
      await ingestTextFile(collection, vectorStore),
      await ingestWebsite(collection, vectorStore),
    ];

    printSummary(allStats);
  } finally {
    await client.close();
  }
}

/**
 * In báo cáo tổng kết.
 */
function printSummary(allStats) {
  const totalDocs = allStats.reduce((sum, s) => sum + s.documents, 0);
  const totalChunks = allStats.reduce((sum, s) => sum + s.chunks, 0);

  logHeader("PIPELINE COMPLETE");
  logSuccess("🎉 Documentation ingestion pipeline finished successfully!");
  logInfo("📊 Summary:", Colors.BOLD);
  logInfo(`   • Documents loaded: ${totalDocs}`);
  logInfo(`   • Chunks stored: ${totalChunks}`);
}

// ===== 3. KHỞI TẠO VECTOR STORE =====

/**
 * Khởi tạo MongoDB Collection và VectorStore wrapper.
 * Trả về `collection` (thao tác trực tiếp) và `vectorStore` (tự động embed + lưu DB).
 */
async function prepareVectorStore(client) {
  // Model embedding (luôn dùng chung 1 model cho cả nạp dữ liệu và truy vấn)
  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-embedding-001",
  });

  const db = client.db(process.env.MONGODB_DB);
  const collection = db.collection(process.env.MONGODB_COLLECTION);

  // Đảm bảo Vector Index đã sẵn sàng trước khi thao tác
  await ensureVectorIndex({
    db,
    collectionName: process.env.MONGODB_COLLECTION,
    embeddings,
  });

  // Tự động tạo vector khi gọi `addDocuments()` rồi lưu vào MongoDB
  const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
    collection,
    indexName: process.env.INDEX_NAME,
    textKey: TEXT_KEY,
    embeddingKey: EMBEDDING_KEY,
  });

  return { collection, vectorStore };
}

/**
 * Đảm bảo Vector Index tồn tại trên MongoDB.
 * Lưu ý: MongoDB cần khởi tạo Index thủ công (tách biệt với storage), khác với Pinecone hay Chroma.
 */
async function ensureVectorIndex({ db, collectionName, embeddings }) {
  const indexName = process.env.INDEX_NAME;

  // Đảm bảo Collection tồn tại trước khi tạo Index
  const collectionExists = await db
    .listCollections({ name: collectionName })
    .hasNext();
  if (!collectionExists) {
    await db.createCollection(collectionName);
  }

  const collection = db.collection(collectionName);

  // Bỏ qua nếu Index đã tồn tại
  const [existing] = await collection.listSearchIndexes(indexName).toArray();
  if (existing) {
    logInfo(`Index "${indexName}" đã có sẵn`);
    return;
  }

  // Lấy số chiều (dimensions) của model bằng cách embed thử 1 chuỗi ngắn
  const numDimensions = (await embeddings.embedQuery("dimension check")).length;

  logInfo(`Creating index "${indexName}" (${numDimensions} dimensions)...`);

  // Tạo Vector Index mới trên MongoDB Atlas
  await collection.createSearchIndex({
    name: indexName,
    type: "vectorSearch",
    definition: {
      fields: [
        {
          type: "vector",
          path: EMBEDDING_KEY,
          numDimensions,
          similarity: "cosine",
        },
      ],
    },
  });

  await waitForIndexReady(collection, indexName);
  logSuccess("Index ready");
}

/**
 * Chờ MongoDB hoàn tất khởi tạo Index (khi `queryable = true`).
 * Kiểm tra lại mỗi 2 giây.
 */
async function waitForIndexReady(collection, indexName) {
  while (true) {
    const [index] = await collection.listSearchIndexes(indexName).toArray();
    if (index?.queryable) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

// ===== 4. NGUỒN 1: TEXT FILE =====

async function ingestTextFile(collection, vectorStore) {
  logHeader("NGUỒN 1: TEXT FILE");

  // Bước 1. Load file
  const sourceDocs = await loadTextFile(TEXT_FILE_PATH);

  // Cấu hình tách đoạn đơn giản theo dấu xuống dòng
  const textSplitter = new CharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 0,
  });

  // Chạy Bước 2 -> 4
  return ingestDocuments({ collection, vectorStore, sourceDocs, textSplitter });
}

/**
 * Bước 1 (Text File): Đọc file .txt -> Mảng Document.
 */
async function loadTextFile(filePath) {
  logInfo(`📄 TextLoader: Loading ${filePath}`, Colors.PURPLE);
  const sourceDocs = await new TextLoader(filePath).load();

  // Chuẩn hóa xuống dòng từ Windows (\r\n -> \n)
  sourceDocs.forEach((sourceDoc) => {
    sourceDoc.pageContent = sourceDoc.pageContent.replace(/\r\n/g, "\n");
  });
  return sourceDocs;
}

// ===== 5. NGUỒN 2: WEBSITE =====

async function ingestWebsite(collection, vectorStore) {
  logHeader("NGUỒN 2: WEBSITE");

  // Bước 1. Load: Chọn 1 trong 2 cách cào web (comment cách không dùng)
  const sourceDocs = await crawlWebsite(CRAWL_URL); // Cách 1: TavilyCrawl
  // const sourceDocs = await mapAndExtractWebsite(CRAWL_URL); // Cách 2: Map -> Extract

  if (sourceDocs.length === 0) {
    logWarning("Không lấy được trang nào, bỏ qua.");
    return { documents: 0, chunks: 0 };
  }

  // Tách đoạn linh hoạt cho Web (ưu tiên theo đoạn văn, dòng, từ, ký tự)
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 4000,
    chunkOverlap: 200,
  });

  // Chạy Bước 2 -> 4
  return ingestDocuments({ collection, vectorStore, sourceDocs, textSplitter });
}

/**
 * Bước 1 (Web - Cách 1): Dùng TavilyCrawl lấy URL và nội dung trong 1 request.
 */
async function crawlWebsite(url) {
  logInfo(`🗺️ TavilyCrawl: Starting to crawl ${url}`, Colors.PURPLE);
  const crawler = withRetry(
    new TavilyCrawl({ ...CRAWL_OPTIONS, extractDepth: EXTRACT_DEPTH }),
  );

  let res;
  try {
    res = await crawler.invoke({ url });
  } catch (e) {
    logError(
      `TavilyCrawl: Thất bại sau ${TAVILY_MAX_ATTEMPTS} lần thử - ${e.message}`,
    );
    return [];
  }

  logSuccess(`TavilyCrawl: Crawl được ${res.results.length} trang`);
  return toDocuments(res.results, "TavilyCrawl");
}

/**
 * Bước 1 (Web - Cách 2): Tách làm 2 bước (Map lấy danh sách URL -> Extract lấy nội dung).
 * Tiết kiệm credit vì có thể lọc bớt URL trước khi lấy nội dung chi tiết.
 */
async function mapAndExtractWebsite(url) {
  const urls = await mapUrls(url);
  if (urls.length === 0) return [];

  const pages = await extractPages(urls);
  return toDocuments(pages, "TavilyExtract");
}

/**
 * Tìm danh sách URL con từ URL gốc (chưa lấy nội dung).
 */
async function mapUrls(url) {
  logInfo(`🗺️ TavilyMap: Starting to map ${url}`, Colors.PURPLE);
  const mapper = withRetry(new TavilyMap(CRAWL_OPTIONS));

  let res;
  try {
    res = await mapper.invoke({ url });
  } catch (e) {
    logError(
      `TavilyMap: Thất bại sau ${TAVILY_MAX_ATTEMPTS} lần thử - ${e.message}`,
    );
    return [];
  }

  // Lọc bỏ anchor tag (#) để tránh trùng lặp trang
  const urls = [...new Set(res.results.map((u) => u.split("#")[0]))];
  logSuccess(`TavilyMap: Tìm được ${urls.length} URL`);
  return urls;
}

/**
 * Lấy nội dung chi tiết của các URL theo từng batch song song.
 * Batch lỗi bị bỏ qua, không làm hỏng các batch khác.
 */
async function extractPages(urls) {
  const extractor = withRetry(
    new TavilyExtract({ extractDepth: EXTRACT_DEPTH }),
  );
  const batches = splitIntoBatches(urls, EXTRACT_BATCH_SIZE);
  logInfo(
    `📦 TavilyExtract: ${urls.length} URL -> ${batches.length} batches (${EXTRACT_BATCH_SIZE} URL/batch)`,
    Colors.DARKCYAN,
  );

  async function extractBatch(batch, batchNum) {
    try {
      const res = await extractor.invoke({ urls: batch });
      res.failed_results.forEach((f) =>
        logWarning(`TavilyExtract: Bỏ qua ${f.url} - ${f.error}`),
      );
      return res.results;
    } catch (e) {
      logError(`TavilyExtract: Batch ${batchNum} thất bại - ${e.message}`);
      return [];
    }
  }

  const batchResults = await Promise.all(
    batches.map((batch, i) => extractBatch(batch, i + 1)),
  );
  return batchResults.flat();
}

/**
 * Bọc Runnable để tự động retry khi gặp lỗi kết nối tạm thời.
 */
function withRetry(tool) {
  return RunnableLambda.from(async (input) => {
    const res = await tool.invoke(input);
    if (res.error) throw new Error(res.error);
    return res;
  }).withRetry({
    stopAfterAttempt: TAVILY_MAX_ATTEMPTS,
    onFailedAttempt: (e) => logWarning(`${tool.name}: Lỗi - ${e.message}`),
  });
}

/**
 * Chuyển kết quả cào web thành danh sách Document (bỏ trang rỗng).
 */
function toDocuments(pages, toolName) {
  return pages
    .filter((page) => page.raw_content)
    .map((page) => {
      logInfo(`${toolName}: Successfully fetched ${page.url}`);
      return new Document({
        pageContent: page.raw_content,
        metadata: { source: page.url },
      });
    });
}

// ===== 6. BƯỚC 2 -> 4: DÙNG CHUNG CHO MỌI NGUỒN =====

async function ingestDocuments({
  collection,
  vectorStore,
  sourceDocs,
  textSplitter,
}) {
  // Bước 2. Filter: Loại bỏ file trùng lặp/chưa chỉnh sửa
  const newSourceDocs = await filterNewDocuments({
    collection,
    sourceDocs,
    textSplitter,
  });
  if (newSourceDocs.length === 0) {
    logSuccess("Tất cả đã được embed, không có gì mới.");
    return { documents: sourceDocs.length, chunks: 0 };
  }

  // Bước 3. Split: Tách tài liệu mới thành các chunks
  const chunks = await textSplitter.splitDocuments(newSourceDocs);
  logSuccess(
    `Text Splitter: Created ${chunks.length} chunks from ${newSourceDocs.length} documents`,
  );

  // Bước 4. Embed & Store: Tạo vector và lưu vào MongoDB
  await storeChunksInBatches({ collection, vectorStore, chunks });

  return { documents: sourceDocs.length, chunks: chunks.length };
}

/**
 * Bước 2: Kiểm tra hash nội dung + cấu hình split.
 * Nếu file thay đổi: xóa toàn bộ chunk cũ để chuẩn bị ghi đè dữ liệu mới.
 */
async function filterNewDocuments({ collection, sourceDocs, textSplitter }) {
  const newSourceDocs = [];
  const splitConfig = `${textSplitter.constructor.name}:${textSplitter.chunkSize}:${textSplitter.chunkOverlap}`;

  for (const sourceDoc of sourceDocs) {
    sourceDoc.metadata.contentHash = hashContent(
      `${splitConfig}\n${sourceDoc.pageContent}`,
    );
    const { source, contentHash } = sourceDoc.metadata;
    const existing = await collection.findOne({ source });

    if (existing?.contentHash === contentHash) {
      continue; // Bỏ qua nếu không đổi
    }

    if (existing) {
      const { deletedCount } = await collection.deleteMany({ source });
      logWarning(`"${source}" đã thay đổi, xóa ${deletedCount} chunk cũ.`);
    }
    newSourceDocs.push(sourceDoc);
  }

  const skipped = sourceDocs.length - newSourceDocs.length;
  if (skipped > 0) {
    logInfo(`Bỏ qua ${skipped}/${sourceDocs.length} nguồn đã được embed.`);
  }
  return newSourceDocs;
}

/**
 * Bước 4: Tạo vector (Gemini) và lưu vào MongoDB theo từng batch song song.
 * Tự động Rollback (xóa chunk đã lưu của nguồn bị lỗi) nếu xử lý batch thất bại.
 */
async function storeChunksInBatches({ collection, vectorStore, chunks }) {
  const batches = splitIntoBatches(chunks, EMBED_BATCH_SIZE);
  logInfo(
    `📦 VectorStore: ${chunks.length} chunks -> ${batches.length} batches (${EMBED_BATCH_SIZE} chunks/batch)`,
    Colors.DARKCYAN,
  );

  const failedSources = new Set();

  async function addBatch(batch, batchNum) {
    try {
      await vectorStore.addDocuments(batch);
      logSuccess(
        `VectorStore: Added batch ${batchNum}/${batches.length} (${batch.length} chunks)`,
      );
      return true;
    } catch (e) {
      logError(`VectorStore: Failed batch ${batchNum} - ${e.message}`);
      batch.forEach((chunk) => failedSources.add(chunk.metadata.source));
      return false;
    }
  }

  const results = await Promise.all(
    batches.map((batch, i) => addBatch(batch, i + 1)),
  );

  const successful = results.filter(Boolean).length;
  if (successful === batches.length) {
    logSuccess(
      `VectorStore: All batches succeeded (${successful}/${batches.length})`,
    );
    return;
  }

  // Rollback dữ liệu lỗi để tránh lưu thiếu chunk
  logWarning(
    `VectorStore: Only ${successful}/${batches.length} batches succeeded`,
  );
  await collection.deleteMany({ source: { $in: [...failedSources] } });
  logWarning(
    `Đã xóa chunk của ${failedSources.size} nguồn lỗi, vui lòng chạy lại.`,
  );
}

// ===== 7. HELPER =====

/**
 * Tạo mã SHA-256 hash nội dung.
 */
function hashContent(content) {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Chia mảng dữ liệu thành các batch nhỏ.
 * Vd: 5 phần tử, size 2 -> [[1, 2], [3, 4], [5]]
 */
function splitIntoBatches(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

main().catch(console.error);
