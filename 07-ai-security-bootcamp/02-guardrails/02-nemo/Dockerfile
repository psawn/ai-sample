# =======================================================================
# NEMO GUARDRAILS SERVER - IMAGE TỰ BUILD
#
# Image = NeMo Guardrails + thư mục config/ (mỗi thư mục con = 1 bot, VD hr-assistant/).
# File JS call-nemo-server.js (cùng thư mục) gọi server này qua HTTP.
#
# Chạy từ thư mục gốc repo:
#   docker build -t nemo-hr 07-ai-security-bootcamp/02-guardrails/02-nemo
#   docker run --rm -p 8001:8000 --env-file .env nemo-hr
#
# - Port 8001 trên máy (8000 để dành cho Chroma), trong container vẫn là 8000.
# - --env-file .env: đưa GEMINI_API_KEY vào container. Docker khắt khe hơn dotenv:
#   tên biến trong .env không được có khoảng trắng (sai: "KEY =abc", đúng: "KEY=abc").
# - Sửa file trong config/ → build lại (vài giây, Docker dùng lại các bước trước).
#
# Khác Dockerfile chính thức của NVIDIA (github.com/NVIDIA-NeMo/Guardrails):
#   - Cài NeMo từ PyPI → không cần clone repo NeMo.
#   - Chỉ cài phần [server] thay vì mọi extras → image nhẹ hơn.
#   - Bỏ bước tải sẵn model all-MiniLM-L6-v2: config dùng embedding Gemini,
#     và bước đó lỗi SSL sau proxy công ty (proxy chặn huggingface.co).
# =======================================================================

# NeMo 0.24.1 hỗ trợ Python 3.10–3.13
FROM python:3.12-slim

RUN pip install --no-cache-dir "nemoguardrails[server]==0.24.1"

# Rail PII có sẵn của NeMo cần Presidio và model spaCy.
# Model này nặng nên image lớn hơn nhiều (khoảng 2.7 GB).
RUN pip install --no-cache-dir presidio-analyzer presidio-anonymizer spacy \
    && python -m spacy download en_core_web_lg

# Chép config vào sau cùng: sửa config chỉ build lại bước này
COPY config /config

EXPOSE 8000

# NeMo gọi Gemini qua endpoint tương thích OpenAI → đọc biến OPENAI_API_KEY.
# Gán OPENAI_API_KEY = GEMINI_API_KEY rồi bật server.
CMD ["sh", "-c", "OPENAI_API_KEY=$GEMINI_API_KEY exec nemoguardrails server --config /config --port 8000"]
