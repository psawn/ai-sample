// embedDocuments() gửi các chunk theo batch lớn (~100 chunk/request). Nếu 1 batch lỗi
// (thường do rate limit), thư viện không throw mà âm thầm trả về vector rỗng cho cả batch
// -> cơ chế retry tự động của langchain (AsyncCaller) không biết để retry, dữ liệu mất luôn.
//
// embedQuery() gọi từng chunk một và CÓ đi qua AsyncCaller -> tự động retry khi lỗi.
// Vì vậy ở đây ta tự chia nhỏ danh sách chunk, gọi embedQuery cho từng nhóm nhỏ chạy song song
// (concurrency) để vừa nhanh vừa không bắn quá nhiều request cùng lúc gây rate limit.
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
