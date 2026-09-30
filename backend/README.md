# SL Birdwatch API

Go stdlib `net/http` + Postgres (PostGIS) + Redis + S3-compatible storage.

```
cmd/birdwatch/       entry point: serves the API, or runs a maintenance task
internal/api/        HTTP handlers, middleware, routes, seeders (one package: they share the Server)
internal/database/   Postgres pool, embedded migrations, species import; Redis client
internal/storage/    S3 media store and image processing (re-encode, strip EXIF)
internal/config/     environment variables and .env loading
seed/                IOC species list (CSV) and its converter
```

```sh
docker compose up -d                              # from the repo root
go run ./cmd/birdwatch                            # serve on :8080 (migrations run on start)
go run ./cmd/birdwatch seed-species               # also: seed-region, seed-details, seed-images, seed-gallery,
                                                  # seed-sounds, seed-sound-gallery, import-local-names, set-role, set-sensitive
go test ./...                                     # needs the compose services; skips when they're down
```

Settings: `DATABASE_URL` (add `pool_max_conns=N` to override the pool size), `REDIS_URL` (Redis 7+),
`S3_*`, `MEDIA_PUBLIC_URL`, `PUBLIC_URL`, `ADDR`. Dev secrets go in `backend/.env` (gitignored).
