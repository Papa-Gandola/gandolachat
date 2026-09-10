FROM python:3.12-slim

# Без этого print-диагностика ([apk-mirror], [push], [steam-*]) копится в
# буфере stdout и в `docker compose logs` появляется с опозданием на часы.
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p uploads/avatars uploads/files

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
