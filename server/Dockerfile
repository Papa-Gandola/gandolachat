# Без PYTHONUNBUFFERED print-диагностика ([apk-mirror], [push], [steam-*])
# копится в буфере stdout и в `docker compose logs` появляется с опозданием
# на часы (env выставлен в основной стадии ниже).

# pg_dump 16 для ночных бэкапов (app/backups.py). В bookworm из коробки
# только 15-я версия клиента (сервер 16 она не дампит), а репозиторий PGDG
# из РФ недоступен/душится — сборка на VPS падала с exit 100 (та же беда,
# что с GitHub CDN, грабля №12). Поэтому берём бинарники из образа
# postgres:16 — он и так скачан локально (на нём крутится db), интернет
# сборке не нужен. Обе базы — bookworm, glibc совпадает; библиотеки
# собираем ldd-ом в свой каталог и грузим через LD_LIBRARY_PATH.
FROM postgres:16 AS pgtools
RUN mkdir -p /pgtools/lib \
 && cp /usr/lib/postgresql/16/bin/pg_dump /usr/lib/postgresql/16/bin/pg_restore /pgtools/ \
 && ldd /usr/lib/postgresql/16/bin/pg_dump /usr/lib/postgresql/16/bin/pg_restore \
    | awk '/=> \//{print $3}' | grep -v 'libc.so.6' | sort -u | xargs -I{} cp -L {} /pgtools/lib/
# libc НЕ копируем: системный загрузчик обязан работать со своей libc, а
# бинарники под старый glibc прекрасно живут на новом (обратная совместимость)

# База прибита к bookworm НАРОЧНО: плавающий python:3.12-slim недавно
# переехал на Debian 13 (trixie) и молча сломал сборку (PGDG-строка была
# bookworm, libldap-2.5-0 в trixie нет — exit 100). Пин = никаких
# сюрпризов от смены дистрибутива под ногами; и glibc совпадает с
# postgres:16 (тоже bookworm).
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1

COPY --from=pgtools /pgtools /opt/pgtools
RUN printf '#!/bin/sh\nexec env LD_LIBRARY_PATH=/opt/pgtools/lib /opt/pgtools/pg_dump "$@"\n' > /usr/local/bin/pg_dump \
 && printf '#!/bin/sh\nexec env LD_LIBRARY_PATH=/opt/pgtools/lib /opt/pgtools/pg_restore "$@"\n' > /usr/local/bin/pg_restore \
 && chmod +x /usr/local/bin/pg_dump /usr/local/bin/pg_restore

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p uploads/avatars uploads/files

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
