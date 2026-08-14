// Ví dụ .bind() bằng object mô phỏng embeddings.client (có method gọi API dùng 'this').
// Cùng pattern với embeddings.client.batchEmbedContents.bind(...) ở debug-embedding-errors.js.

const apiClient = {
  name: "GeminiClient",
  fetchData: function () {
    // 'this' = object đang GỌI hàm này, không phải nơi hàm được định nghĩa
    console.log("Đang gọi API bằng: " + this.name);
  },
};

// BƯỚC 1: Gọi qua object -> 'this' = apiClient -> OK
apiClient.fetchData();
// ✅ LOG: "Đang gọi API bằng: GeminiClient"

// BƯỚC 2: Tách hàm ra khỏi object -> mất 'this'
const fetchDataAlone = apiClient.fetchData; // chỉ copy hàm, không mang theo apiClient
fetchDataAlone();
// ❌ LOG: "Đang gọi API bằng: undefined" -> lỗi hay gặp khi truyền hàm của object đi chỗ khác (callback...)

// BƯỚC 3: .bind() = khóa cứng 'this' vào apiClient, dù gọi ở đâu sau này
const boundFetchData = apiClient.fetchData.bind(apiClient);
boundFetchData();
// ✅ LOG: "Đang gọi API bằng: GeminiClient" -> vẫn đúng dù đã tách ra biến riêng

// QUY TẮC CHUNG: 'this' luôn là object đứng NGAY TRƯỚC dấu '.' cuối cùng lúc gọi hàm.
// Muốn tách hàm ra dùng riêng mà không mất 'this', bind() đúng object đó.
//
// apiClient.fetchData()     -> object trước dấu '.' cuối là apiClient      -> bind(apiClient)
// apiClient.fetchData.xxx() -> object trước dấu '.' cuối là apiClient.fetchData -> bind(apiClient.fetchData)
