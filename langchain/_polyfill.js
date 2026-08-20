// @langchain/core@1.x dùng crypto.getRandomValues() (Web Crypto API) mỗi khi gọi
// .invoke() để sinh UUID cho việc tracing nội bộ - API này chỉ có sẵn dưới dạng biến
// toàn cục (globalThis.crypto) từ Node 19 trở lên. Máy đang chạy Node 18 nên cần polyfill
// thủ công, nếu không sẽ gặp lỗi "ReferenceError: crypto is not defined" ngay khi invoke().
//
// File này require 1 lần duy nhất ở đầu mỗi file demo (trước cả dotenv), để đảm bảo
// globalThis.crypto có sẵn trước khi bất kỳ package @langchain/* nào chạy.
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = require("crypto").webcrypto;
}
