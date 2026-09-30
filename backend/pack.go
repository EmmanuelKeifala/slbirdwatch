package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// LIB-11: the offline pack, everything the species page shows for each Sierra Leone bird (most recorded first),
// in one gzipped download. The app saves it with the main photo and, if chosen, the main call next to it.
// Built at most every 12 hours (Redis), since it runs the species page's queries ~600 times.

const packTTL = 12 * time.Hour

func (a *server) buildPack(ctx context.Context) ([]byte, error) {
	rows, err := a.db.Query(ctx, `SELECT rs.species_id FROM region_species rs JOIN species s ON s.id = rs.species_id
		WHERE NOT s.extinct AND s.merged_into IS NULL ORDER BY rs.records DESC`)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return nil, err
	}
	species := make([]*speciesDetail, 0, len(ids))
	for _, id := range ids {
		sp, err := a.loadSpeciesDetail(ctx, id)
		if err != nil {
			return nil, fmt.Errorf("species %d: %w", id, err)
		}
		if sp != nil {
			species = append(species, sp)
		}
	}
	raw, err := json.Marshal(map[string]any{"version": time.Now().UTC().Format(time.RFC3339), "species": species})
	if err != nil {
		return nil, err
	}
	var z bytes.Buffer // ~6 MB of JSON is ~1.6 MB gzipped
	zw := gzip.NewWriter(&z)
	zw.Write(raw)
	zw.Close()
	return z.Bytes(), nil
}

// GET /packs/sierra-leone
func (a *server) sierraLeonePack(w http.ResponseWriter, r *http.Request) {
	b, err := a.cache.Get(r.Context(), "pack:sl:gz").Bytes()
	if err != nil {
		if b, err = a.buildPack(r.Context()); err != nil {
			internalError(w, "offline pack", err)
			return
		}
		a.cache.Set(r.Context(), "pack:sl:gz", b, packTTL)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("Vary", "Accept-Encoding")
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
		w.Write(b)
		return
	}
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		internalError(w, "offline pack", err)
		return
	}
	io.Copy(w, zr)
}
