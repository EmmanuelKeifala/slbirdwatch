package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ADM-02 taxonomy management (admin): local names, merges (lumps) and splits. The IOC list itself is imported
// with `go run . seed-species <csv>`, which now also reports species the new list no longer has.

type localName struct {
	Name     string `json:"name"`
	Language string `json:"language"` // e.g. kri (Krio), men (Mende), tem (Temne); "" if unknown
}

func (a *server) localNames(ctx context.Context, speciesID int64) ([]localName, error) {
	rows, err := a.db.Query(ctx, `SELECT name, language FROM species_local_names WHERE species_id = $1 ORDER BY language, name`, speciesID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[localName])
}

func speciesPathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return 0, false
	}
	return id, true
}

// POST /admin/species/{id}/names {name, language}
func (a *server) addLocalName(w http.ResponseWriter, r *http.Request) {
	id, ok := speciesPathID(w, r)
	if !ok {
		return
	}
	var n localName
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&n); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	n.Name, n.Language = strings.TrimSpace(n.Name), strings.ToLower(strings.TrimSpace(n.Language))
	if n.Name == "" || len(n.Name) > 100 || len(n.Language) > 10 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name must be 1–100 characters, language up to 10"})
		return
	}
	_, err := a.db.Exec(r.Context(), `INSERT INTO species_local_names (species_id, name, language) VALUES ($1, $2, $3)
		ON CONFLICT (species_id, name) DO UPDATE SET language = excluded.language`, id, n.Name, n.Language)
	var fk interface{ SQLState() string }
	if errors.As(err, &fk) && fk.SQLState() == "23503" {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		internalError(w, "add local name", err)
		return
	}
	a.respondNames(w, r, id)
}

// DELETE /admin/species/{id}/names?name=
func (a *server) deleteLocalName(w http.ResponseWriter, r *http.Request) {
	id, ok := speciesPathID(w, r)
	if !ok {
		return
	}
	if _, err := a.db.Exec(r.Context(), `DELETE FROM species_local_names WHERE species_id = $1 AND name = $2`, id, r.URL.Query().Get("name")); err != nil {
		internalError(w, "delete local name", err)
		return
	}
	a.respondNames(w, r, id)
}

func (a *server) respondNames(w http.ResponseWriter, r *http.Request, id int64) {
	names, err := a.localNames(r.Context(), id)
	if err != nil {
		internalError(w, "local names", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": names})
}

type taxonomyChange struct {
	From int64   `json:"from"`
	Into []int64 `json:"into"`
	Note string  `json:"note"`
}

func readTaxonomyChange(w http.ResponseWriter, r *http.Request, minInto int) (taxonomyChange, bool) {
	var c taxonomyChange
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&c); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return c, false
	}
	slices.Sort(c.Into)
	c.Into = slices.Compact(c.Into)
	switch {
	case len(c.Into) < minInto || len(c.Into) > 10:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("into needs %d–10 species", minInto)})
	case slices.Contains(c.Into, c.From):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a species can't be merged or split into itself"})
	case len(c.Note) > 1000:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "note is too long"})
	default:
		return c, true
	}
	return c, false
}

// activeSpecies checks every id exists and is current (not merged away); returns false after writing the error.
func activeSpecies(ctx context.Context, tx pgx.Tx, w http.ResponseWriter, ids ...int64) (bool, error) {
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM species WHERE id = ANY($1) AND merged_into IS NULL`, ids).Scan(&n); err != nil {
		return false, err
	}
	if n != len(ids) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown or already merged species"})
		return false, nil
	}
	return true, nil
}

// POST /admin/species/merge {from, into: [id], note} — a lump: everything recorded as `from` becomes `into`.
func (a *server) mergeSpecies(w http.ResponseWriter, r *http.Request) {
	c, ok := readTaxonomyChange(w, r, 1)
	if !ok {
		return
	}
	if len(c.Into) != 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "merge into exactly one species"})
		return
	}
	into, wrote := c.Into[0], false
	err := pgx.BeginFunc(r.Context(), a.db, func(tx pgx.Tx) error {
		ok, err := activeSpecies(r.Context(), tx, w, c.From, into)
		if !ok || err != nil {
			wrote = !ok
			return err
		}
		rows, err := tx.Query(r.Context(), `SELECT DISTINCT o.id FROM observations o LEFT JOIN identifications i ON i.observation_id = o.id
			WHERE o.species_id = $1 OR o.community_species_id = $1 OR i.species_id = $1`, c.From)
		if err != nil {
			return err
		}
		affected, err := pgx.CollectRows(rows, pgx.RowTo[int64])
		if err != nil {
			return err
		}
		for _, q := range []string{
			`UPDATE observations SET species_id = $2 WHERE species_id = $1`,
			`UPDATE observations SET community_species_id = $2 WHERE community_species_id = $1`,
			`UPDATE identifications SET species_id = $2 WHERE species_id = $1`,
			`UPDATE species_gallery SET species_id = $2 WHERE species_id = $1`,
			`UPDATE species_sound_gallery SET species_id = $2 WHERE species_id = $1`,
			`INSERT INTO species_local_names (species_id, name, language) SELECT $2, name, language FROM species_local_names
			 WHERE species_id = $1 ON CONFLICT DO NOTHING`,
			`UPDATE species SET merged_into = $2 WHERE id = $1`,
			`UPDATE species SET merged_into = $2 WHERE merged_into = $1`, // earlier merges follow along
		} {
			if _, err := tx.Exec(r.Context(), q, c.From, into); err != nil {
				return err
			}
		}
		for _, oid := range affected {
			if err := recompute(r.Context(), tx, oid); err != nil {
				return err
			}
		}
		_, err = tx.Exec(r.Context(), `INSERT INTO taxonomy_changes (kind, from_species, into_species, admin_id, note)
			VALUES ('merge', $1, $2, $3, $4)`, c.From, c.Into, userID(r), c.Note)
		return err
	})
	a.finishTaxonomy(w, r, wrote, err)
}

// POST /admin/species/split {from, into: [ids], note} — the old species stays with its sightings (nothing lost)
// and points at the new ones; its sightings reappear in the verifier queue for re-identification.
func (a *server) splitSpecies(w http.ResponseWriter, r *http.Request) {
	c, ok := readTaxonomyChange(w, r, 2)
	if !ok {
		return
	}
	wrote := false
	err := pgx.BeginFunc(r.Context(), a.db, func(tx pgx.Tx) error {
		ok, err := activeSpecies(r.Context(), tx, w, append([]int64{c.From}, c.Into...)...)
		if !ok || err != nil {
			wrote = !ok
			return err
		}
		if _, err := tx.Exec(r.Context(), `UPDATE species SET split_into = $2 WHERE id = $1`, c.From, c.Into); err != nil {
			return err
		}
		_, err = tx.Exec(r.Context(), `INSERT INTO taxonomy_changes (kind, from_species, into_species, admin_id, note)
			VALUES ('split', $1, $2, $3, $4)`, c.From, c.Into, userID(r), c.Note)
		return err
	})
	a.finishTaxonomy(w, r, wrote, err)
}

func (a *server) finishTaxonomy(w http.ResponseWriter, r *http.Request, wrote bool, err error) {
	switch {
	case wrote:
	case err != nil:
		internalError(w, "taxonomy change", err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// importLocalNames reads "scientific_name,name,language" rows (header required) and adds them; unknown
// scientific names are returned so they can be fixed.
func importLocalNames(ctx context.Context, db *pgxpool.Pool, path string) (added int64, unknown []string, err error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, nil, err
	}
	defer f.Close()
	rd := csv.NewReader(f)
	if h, err := rd.Read(); err != nil || strings.Join(h, ",") != "scientific_name,name,language" {
		return 0, nil, fmt.Errorf("want a header row scientific_name,name,language")
	}
	for {
		rec, err := rd.Read()
		if err == io.EOF {
			return added, unknown, nil
		}
		if err != nil {
			return added, unknown, err
		}
		tag, err := db.Exec(ctx, `INSERT INTO species_local_names (species_id, name, language)
			SELECT id, $2, lower($3) FROM species WHERE scientific_name = $1 AND merged_into IS NULL
			ON CONFLICT (species_id, name) DO UPDATE SET language = excluded.language`, rec[0], strings.TrimSpace(rec[1]), strings.TrimSpace(rec[2]))
		if err != nil {
			return added, unknown, err
		}
		if tag.RowsAffected() == 0 {
			unknown = append(unknown, rec[0])
		}
		added += tag.RowsAffected()
	}
}
