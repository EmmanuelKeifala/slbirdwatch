package api

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/sync/errgroup"
)

// LIB-11: the offline pack, everything the species page shows for each Sierra Leone bird (most recorded first),
// in one gzipped download. The app saves it with the main photo and, if chosen, the main call next to it.
// Built at most every 12 hours (Redis), since it runs the species page's queries ~600 times.

const packTTL = 12 * time.Hour

func (a *Server) buildPack(ctx context.Context) ([]byte, error) {
	rows, err := a.db.Query(ctx, `SELECT rs.species_id FROM region_species rs JOIN species s ON s.id = rs.species_id
		WHERE NOT s.extinct AND s.merged_into IS NULL ORDER BY rs.records DESC`)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return nil, err
	}
	loaded := make([]*speciesDetail, len(ids))
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(8) // leaves most of the pool to live requests
	for i, id := range ids {
		g.Go(func() (err error) {
			loaded[i], err = a.loadSpeciesDetail(gctx, id)
			return err
		})
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}
	species := slices.DeleteFunc(loaded, func(sp *speciesDetail) bool { return sp == nil })

	var z bytes.Buffer // ~6 MB of JSON is ~1.6 MB gzipped
	zw := gzip.NewWriter(&z)
	if err := json.NewEncoder(zw).Encode(map[string]any{"version": time.Now().UTC().Format(time.RFC3339), "species": species}); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return z.Bytes(), nil
}

// GET /packs/sierra-leone
func (a *Server) sierraLeonePack(w http.ResponseWriter, r *http.Request) {
	b, err := a.cache.Get(r.Context(), "pack:sl:gz").Bytes()
	if err != nil {
		// Concurrent misses share one build; it outlives any single client hanging up.
		v, err, _ := a.packs.Do("sl", func() (any, error) {
			ctx := context.WithoutCancel(r.Context())
			b, err := a.buildPack(ctx)
			if err == nil {
				a.cache.Set(ctx, "pack:sl:gz", b, packTTL)
			}
			return b, err
		})
		if err != nil {
			internalError(w, "offline pack", err)
			return
		}
		b = v.([]byte)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("Vary", "Accept-Encoding")
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Content-Length", strconv.Itoa(len(b))) // lets the app show download progress
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
