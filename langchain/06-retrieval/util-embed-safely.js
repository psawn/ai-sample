// =======================================================================
// UTIL - EMBED AN TOÀN (CÓ RETRY KHI LỖI)
//
// Vấn đề: 2 cách embed của thư viện xử lý lỗi khác nhau.
// 1. embedDocuments(): gửi theo batch lớn (~100 chunk/request).
//    Batch lỗi (thường do rate limit) -> không throw, âm thầm trả vector rỗng.
//    Cơ chế retry (AsyncCaller) không biết có lỗi -> không retry -> mất dữ liệu.
// 2. embedQuery(): gọi từng chunk, có đi qua AsyncCaller -> tự retry khi lỗi.
//
// Giải pháp: chia chunk thành từng nhóm nhỏ, gọi embedQuery song song trong nhóm.
// Vừa nhanh, vừa không bắn quá nhiều request cùng lúc gây rate limit.
// Chi tiết lỗi gốc: debug-embedding-errors.js.
// =======================================================================

// Embed danh sách docs, mỗi lần chạy song song tối đa `concurrency` request.
// Trả mảng vector đúng thứ tự docs.
async function embedChunksSafely(embeddings, docs, concurrency = 5) {
  const vectors = new Array(docs.length);
  for (let i = 0; i < docs.length; i += concurrency) {
    const group = docs.slice(i, i + concurrency);
    const groupVectors = await Promise.all(
      group.map((doc) => embeddings.embedQuery(doc.pageContent)),
    );
    groupVectors.forEach((v, j) => {
      vectors[i + j] = v;
    });
  }
  return vectors;
}

module.exports = { embedChunksSafely };
