// Package database opens Postgres (applying the embedded migrations) and Redis.
package database

import (
	"context"
	"embed"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"runtime"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/slbirdwatch/backend/internal/config"
)

// Open connects to DATABASE_URL. pool_max_conns etc. in the URL override the defaults below.
func Open(ctx context.Context) (*pgxpool.Pool, error) {
	url := config.Env("DATABASE_URL", "postgres://birdwatch:birdwatch@localhost:5432/birdwatch?sslmode=disable")
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	// pgx defaults to max(4, NumCPU) connections; handlers wait on I/O, not CPU, so allow more in flight.
	if !strings.Contains(url, "pool_max_conns") {
		cfg.MaxConns = int32(max(16, 4*runtime.NumCPU()))
	}
	if !strings.Contains(url, "pool_min_conns") {
		cfg.MinConns = 2 // no connect handshake on the first requests after idle
	}
	// Species search: typos like "kingfshr" score ~0.56 against "Kingfisher"; default 0.6 misses them.
	cfg.ConnConfig.RuntimeParams["pg_trgm.word_similarity_threshold"] = "0.5"
	return pgxpool.NewWithConfig(ctx, cfg)
}

//go:embed migrations/*.sql
var migrationFS embed.FS

// Migrate applies migrations/*.sql in filename order, each once, each in its own transaction.
func Migrate(ctx context.Context, db *pgxpool.Pool) error {
	if _, err := db.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	files, err := migrationFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, len(files))
	for i, f := range files {
		names[i] = f.Name()
	}
	sort.Strings(names)

	for _, name := range names {
		err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
			// Serialise concurrent API instances starting at once.
			if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(7243901)`); err != nil {
				return err
			}
			var done bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, name).Scan(&done); err != nil || done {
				return err
			}
			sql, err := migrationFS.ReadFile("migrations/" + name)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, string(sql)); err != nil {
				return err
			}
			_, err = tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, name)
			return err
		})
		if err != nil {
			return fmt.Errorf("migration %s: %w", name, err)
		}
	}
	return nil
}

var speciesColumns = []string{"seq", "scientific_name", "english_name", "order_name", "family_sci", "family_en",
	"genus", "authority", "breeding_range", "nonbreeding_range", "extinct", "taxonomy_version"}

// SeedSpecies upserts species from the CSV written by seed/ioc_to_csv.py.
// Upsert (not truncate) so rows referenced by observations keep their ids.
func SeedSpecies(ctx context.Context, db *pgxpool.Pool, path string) (int64, []string, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, nil, err
	}
	defer f.Close()
	r := csv.NewReader(f)
	header, err := r.Read()
	if err != nil {
		return 0, nil, err
	}
	if fmt.Sprint(header) != fmt.Sprint(speciesColumns) {
		return 0, nil, fmt.Errorf("unexpected CSV header %v, want %v", header, speciesColumns)
	}

	var rows [][]any
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return 0, nil, err
		}
		row := make([]any, len(rec))
		for i, v := range rec {
			row[i] = v
		}
		row[10] = rec[10] == "true"
		rows = append(rows, row)
	}

	var n int64
	var dropped []string
	err = pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `CREATE TEMP TABLE species_in (seq text, scientific_name text, english_name text, order_name text,
			family_sci text, family_en text, genus text, authority text, breeding_range text, nonbreeding_range text,
			extinct boolean, taxonomy_version text) ON COMMIT DROP`); err != nil {
			return err
		}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"species_in"}, speciesColumns, pgx.CopyFromRows(rows)); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO species (seq, scientific_name, english_name, order_name, family_sci, family_en, genus,
				authority, breeding_range, nonbreeding_range, extinct, taxonomy_version)
			SELECT seq::int, scientific_name, english_name, order_name, family_sci, family_en, genus,
				authority, breeding_range, nonbreeding_range, extinct, taxonomy_version FROM species_in
			ON CONFLICT (scientific_name) DO UPDATE SET
				seq = EXCLUDED.seq, english_name = EXCLUDED.english_name, order_name = EXCLUDED.order_name,
				family_sci = EXCLUDED.family_sci, family_en = EXCLUDED.family_en, genus = EXCLUDED.genus,
				authority = EXCLUDED.authority, breeding_range = EXCLUDED.breeding_range,
				nonbreeding_range = EXCLUDED.nonbreeding_range, extinct = EXCLUDED.extinct,
				taxonomy_version = EXCLUDED.taxonomy_version, updated_at = now()`)
		n = tag.RowsAffected()
		if err != nil {
			return err
		}
		// Species this list no longer has stay in place (their sightings keep their ids) until an admin merges or splits them.
		rows, err := tx.Query(ctx, `SELECT scientific_name FROM species s WHERE merged_into IS NULL AND split_into = '{}'
			AND NOT EXISTS (SELECT 1 FROM species_in i WHERE i.scientific_name = s.scientific_name) ORDER BY seq`)
		if err == nil {
			dropped, err = pgx.CollectRows(rows, pgx.RowTo[string])
		}
		return err
	})
	return n, dropped, err
}

// OpenRedis returns a client for REDIS_URL (it connects lazily, on first use).
func OpenRedis() (*redis.Client, error) {
	opts, err := redis.ParseURL(config.Env("REDIS_URL", "redis://localhost:6380/0"))
	if err != nil {
		return nil, err
	}
	return redis.NewClient(opts), nil
}
