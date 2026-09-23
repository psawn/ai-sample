// =======================================================================
// UTIL - VÍ DỤ .bind() VÀ 'this' TRONG JAVASCRIPT
//
// 'this' = object đứng ngay trước dấu '.' cuối cùng, lúc gọi hàm.
// Tách hàm ra khỏi object -> mất 'this'. Dùng .bind() để khóa cứng 'this'.
//
// Cùng pattern với embeddings.client.batchEmbedContents.bind(...)
// ở debug-embedding-errors.js.
// =======================================================================

// Object mô phỏng embeddings.client, có method dùng 'this'.
const apiClient = {
  name: "GeminiClient",
  fetchData: function () {
    // 'this' = object đang gọi hàm, không phải nơi hàm được định nghĩa.
    console.log("Đang gọi API bằng: " + this.name);
  },
};

// Bước 1: gọi qua object -> 'this' = apiClient -> đúng.
apiClient.fetchData();
// Log: "Đang gọi API bằng: GeminiClient"

// Bước 2: tách hàm ra khỏi object -> mất 'this'.
const fetchDataAlone = apiClient.fetchData; // Chỉ copy hàm, không mang theo apiClient
fetchDataAlone();
// Log: "Đang gọi API bằng: undefined" (sai)
// Lỗi hay gặp khi truyền method của object làm callback.

// Bước 3: .bind() khóa cứng 'this' vào apiClient, gọi ở đâu cũng đúng.
const boundFetchData = apiClient.fetchData.bind(apiClient);
boundFetchData();
// Log: "Đang gọi API bằng: GeminiClient" (đúng, dù đã tách ra biến riêng)

// Quy tắc: muốn tách hàm ra dùng riêng mà không mất 'this',
// bind() đúng object đứng trước dấu '.' cuối cùng:
//
// apiClient.fetchData()     -> object trước '.' cuối là apiClient           -> bind(apiClient)
// apiClient.fetchData.xxx() -> object trước '.' cuối là apiClient.fetchData -> bind(apiClient.fetchData)