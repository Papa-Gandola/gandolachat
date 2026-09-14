# Без PYTHONUNBUFFERED print-диагностика ([apk-mirror], [push], [steam-*])
# копится в буфере stdout и в `docker compose logs` появляется с опозданием
# на часы (env выставлен в основной стадии ниже).

# pg_dump 16 для ночных бэкапов (app/backups.py). В bookworm из коробки
# только 15-я версия клиента (сервер 16 она не дампит), а репозиторий PGDG
# из РФ недоступен/душится — сборка на VPS падала с exit 100 (та же беда,
# что с GitHub CDN, грабля №12). Поэтому берём бинарники из образа
# postgres:16 — он и так скачан локально (на нём крутится db), интернет
# сборке не нужен. Библиотеки собираем ldd-ом в свой каталог и грузим
# через LD_LIBRARY_PATH.
#
# ТЕГ ПРИБИТ К -bookworm НАРОЧНО. Плавающий `postgres:16` уехал на Debian
# 13 (trixie) — и скопированный оттуда pg_dump перестал запускаться на
# нашей bookworm-базе: «/lib/x86_64-linux-gnu/libc.so.6: version
# GLIBC_2.38 not found» (trixie собран под glibc 2.41, в bookworm 2.36).
# Бэкапы при этом падали МОЛЧА, раз в сутки в 4 утра. glibc обратно
# совместим только в одну сторону: старый бинарник на новом libc живёт,
# наоборот — нет. Обе стадии обязаны быть на ОДНОМ дистрибутиве.
FROM postgres:16-bookworm AS pgtools
RUN mkdir -p /pgtools/lib \
 && cp /usr/lib/postgresql/16/bin/pg_dump /usr/lib/postgresql/16/bin/pg_restore /pgtools/ \
 && ldd /usr/lib/postgresql/16/bin/pg_dump /usr/lib/postgresql/16/bin/pg_restore \
    | awk '/=> \//{print $3}' | grep -v 'libc.so.6' | sort -u | xargs -I{} cp -L {} /pgtools/lib/
# libc НЕ копируем: системный загрузчик обязан работать со своей libc, а
# бинарники под старый glibc прекрасно живут на новом (обратная совместимость)

# База прибита к bookworm НАРОЧНО: плавающий python:3.12-slim недавно
# переехал на Debian 13 (trixie) и молча сломал сборку (PGDG-строка была
# bookworm, libldap-2.5-0 в trixie нет — exit 100). Пин = никаких
# сюрпризов от смены дистрибутива под ногами; и glibc тот же, что у
# pgtools-стадии выше (она тоже прибита к -bookworm — менять только ПАРОЙ).
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1

COPY --from=pgtools /pgtools /opt/pgtools
RUN printf '#!/bin/sh\nexec env LD_LIBRARY_PATH=/opt/pgtools/lib /opt/pgtools/pg_dump "$@"\n' > /usr/local/bin/pg_dump \
 && printf '#!/bin/sh\nexec env LD_LIBRARY_PATH=/opt/pgtools/lib /opt/pgtools/pg_restore "$@"\n' > /usr/local/bin/pg_restore \
 && chmod +x /usr/local/bin/pg_dump /usr/local/bin/pg_restore
# Смоук-тест прямо в сборке: если стадии разъедутся по дистрибутивам,
# образ НЕ соберётся, а не отдаст молча дохлый pg_dump, о котором узнаём
# через неделю по пустой папке бэкапов.
RUN pg_dump --version && pg_restore --version

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p uploads/avatars uploads/files

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
