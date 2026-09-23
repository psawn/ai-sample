// =======================================================================
// POLYFILL - BỔ SUNG globalThis.crypto CHO NODE 18
//
// VÌ SAO CẦN:
// @langchain/core@1.x gọi crypto.getRandomValues() mỗi lần .invoke() để tạo
// UUID tracing. Biến toàn cục globalThis.crypto chỉ có sẵn từ Node 19.
// Node 18 thiếu biến này -> lỗi "ReferenceError: crypto is not defined".
//
// CÁCH DÙNG: require file này ở DÒNG ĐẦU mỗi file demo (trước cả dotenv),
// để crypto có sẵn trước khi bất kỳ package @langchain/* nào chạy.
// =======================================================================

if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = require("crypto").webcrypto;
}
