# Fine-tune Qwen3 cho Text-to-SQL

Quy trình: sinh data trên máy (JS) → train trên Google Colab (GPU miễn phí) → chạy model mới trong Ollama → chấm điểm (JS).

```
04-evaluation.js           chấm model gốc            -> điểm để so sánh
05-generate-data.js        sinh cặp { question, sql } -> generated_queries.jsonl
06-filter-data.js          lọc rác                    -> generated_queries_filtered.jsonl
07-prepare-finetune.js     đổi sang dạng hội thoại    -> finetune_dataset.jsonl
08-finetune-colab.ipynb    train trên Colab           -> file .gguf (Google Drive)
ollama create              nạp model mới vào Ollama   -> qwen3-nba-sql
04-evaluation.js           chấm model mới             -> so với điểm ban đầu
```

## Chuẩn bị

- Ollama đang chạy, có model `qwen3:latest`.
- Postgres đang chạy: `docker start langgraph-pg`.
- Tài khoản Google (dùng Colab + Drive).
- Mọi lệnh `node` chạy từ thư mục gốc repo (`D:\Test\ai`) để đọc được `.env`.

## Bước 1 — Chấm model gốc trước

```
node 06-improving-accuracy/04-evaluation.js
```

Ghi lại số trong `data/results/summary.txt`. Đây là điểm của `qwen3` khi chưa fine-tune.
Lần chạy sau sẽ ghi đè thư mục `results/`, nên copy số ra chỗ khác.

## Bước 2 — Sinh và lọc data

```
node 06-improving-accuracy/05-generate-data.js 60
node 06-improving-accuracy/06-filter-data.js
node 06-improving-accuracy/07-prepare-finetune.js
```

| Lệnh | Ghi chú |
|---|---|
| `05` | Số cuối = số lượt sinh. `qwen3` chạy bằng CPU khoảng 1–1,5 phút/lượt, mỗi lượt cho 0–2 cặp. **Ghi đè** file cũ |
| `06` | Lọc xong nên mở `generated_queries_filtered.jsonl` đọc lướt: cặp nào câu hỏi không khớp SQL thì sửa tay hoặc xóa dòng |
| `07` | Nên có **ít nhất ~50 mẫu**. Ít hơn thì chạy thêm `05` |

Bộ đề `gold-test-set.jsonl` không được đưa vào data train. Nó dùng để chấm điểm, model thấy đề trước thì điểm bị ảo.

## Bước 3 — Train trên Colab

1. Vào https://colab.research.google.com → bấm nút **Tải sổ tay lên** (Upload notebook) ở trang chủ → chọn `06-improving-accuracy/08-finetune-colab.ipynb`.
   Đang mở sẵn 1 notebook thì dùng menu **Tệp (File) → Tải sổ tay lên**.
2. **Thời gian chạy (Runtime) → Thay đổi loại thời gian chạy (Change runtime type) → T4 GPU**.
3. Chạy lần lượt từng ô (Shift + Enter). Ô upload hỏi file `data/training_data/finetune_dataset.jsonl`.
4. So câu trả lời ở mục 5 (trước train) và mục 7 (sau train).
5. Ô xuất GGUF lưu file `.gguf` (khoảng 5GB với model 8B) vào Google Drive. Mất khoảng 30–40 phút với model 8B.
   **Đợi in dòng "Đã đẩy xong lên Drive" rồi mới tải về.** File hiện trên Drive sớm hơn là chưa đẩy đủ → tải về báo "Lỗi HTTP".
   Kiểm tra: bộ nhớ Drive đã dùng phải tăng khoảng 5GB.

Colab miễn phí không phải lúc nào cũng còn GPU, và phiên làm việc có giới hạn thời gian. Bị ngắt thì chạy lại từ đầu.
Để tab Colab mở trong lúc chạy; lâu không tương tác có thể bị ngắt phiên.

## Bước 4 — Nạp vào Ollama

Tải file `.gguf` từ Drive về, VD `D:\models\`. Tạo file `Modelfile` (không đuôi) cùng thư mục:

```
FROM ./<tên-file>.gguf
PARAMETER stop <|im_end|>
```

Không cần khai báo template vì `04-evaluation.js` gửi prompt raw (`raw: true`).

```
ollama create qwen3-nba-sql -f D:\models\Modelfile
ollama list
```

## Bước 5 — Chấm model đã fine-tune

1. **Tách model giám khảo trước.** `04-evaluation.js` hiện dùng chung `MODEL` cho cả viết SQL lẫn giám khảo.
   Đổi `MODEL` là đổi luôn giám khảo → so sánh không công bằng. Giám khảo phải giữ là `qwen3:latest`.
2. Đổi model viết SQL thành `"qwen3-nba-sql"`, chạy lại `04-evaluation.js`, so với điểm ở bước 1.

## Mẹo: chạy thử nhanh trước

Trước khi chạy `05` hàng giờ, chạy thử cả quy trình với data nhỏ để bắt lỗi sớm:

1. `05-generate-data.js 10` (khoảng 15 phút) → `06` → `07`.
2. Trên Colab đổi `MODEL_NAME = "unsloth/Qwen3-1.7B"` (train và xuất GGUF nhanh hơn nhiều).
3. Chạy được hết thì quay lại làm bản thật với `unsloth/Qwen3-8B`.

## Kết quả nên kỳ vọng

| Thường cải thiện | Ít cải thiện |
|---|---|
| Định dạng: SQL sạch, có `;`, đúng cú pháp Postgres | Câu cần suy luận khó (median, percentile) nếu data ít ví dụ loại đó |
| Thói quen theo schema (VD bóc `$` và `,` khỏi `salary` trước khi `CAST`) | Dạng câu hỏi không có trong data |

Data ít (vài chục mẫu) dễ bị **overfit** (học thuộc lòng): câu giống data train thì đúng, đổi chữ một chút là sai.
Loss lúc train tụt sát 0 là dấu hiệu nên nghi ngờ. Điểm ở bước 5 mới là con số thật.
