package database

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Needs the docker-compose Postgres; skipped when it isn't reachable.
func testDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := t.Context()
	db, err := Open(ctx)
	if err == nil {
		err = db.Ping(ctx)
	}
	if err != nil {
		t.Skipf("postgres not available: %v", err)
	}
	t.Cleanup(db.Close)
	return db
}

func TestMigrateAndSeedAreIdempotent(t *testing.T) {
	ctx := t.Context()
	db := testDB(t)

	for range 2 {
		if err := Migrate(ctx, db); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := SeedSpecies(ctx, db, "../../seed/ioc_species.csv"); err != nil {
		t.Fatal(err)
	}
	var id1, id2, total int64
	db.QueryRow(ctx, `SELECT id FROM species WHERE scientific_name = 'Corvus albus'`).Scan(&id1)
	if _, _, err := SeedSpecies(ctx, db, "../../seed/ioc_species.csv"); err != nil {
		t.Fatal(err)
	}
	db.QueryRow(ctx, `SELECT id FROM species WHERE scientific_name = 'Corvus albus'`).Scan(&id2)
	db.QueryRow(ctx, `SELECT count(*) FROM species`).Scan(&total)

	if id1 == 0 || id1 != id2 {
		t.Fatalf("species id changed across re-seed: %d -> %d", id1, id2)
	}
	if total != 11227 {
		t.Fatalf("species count = %d, want 11227", total)
	}
}
