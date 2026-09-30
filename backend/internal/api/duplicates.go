package api

import (
	"bytes"
	"context"
	"errors"
	"image"
	_ "image/jpeg"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/image/draw"
)

// OBS-15 duplicate and spam detection.

// dHash is a 64-bit perceptual fingerprint: shrink to 9×8 greyscale and record whether each pixel is brighter
// than its right-hand neighbour. Resizing, recompression and small edits barely change it.
func dHash(jpg []byte) (int64, error) {
	src, _, err := image.Decode(bytes.NewReader(jpg))
	if err != nil {
		return 0, err
	}
	small := image.NewGray(image.Rect(0, 0, 9, 8))
	draw.ApproxBiLinear.Scale(small, small.Bounds(), src, src.Bounds(), draw.Src, nil)
	var h uint64
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			h <<= 1
			if small.GrayAt(x, y).Y > small.GrayAt(x+1, y).Y {
				h |= 1
			}
		}
	}
	return int64(h), nil
}

// photoDuplicate finds a stored photo that looks the same (at most 4 of 64 fingerprint bits differ).
// ponytail: scans every photo's hash; switch to a BK-tree or bucketed bits if photos reach the millions.
func (a *Server) photoDuplicate(ctx context.Context, hash, uploader, oid int64) (msg string, err error) {
	var owner, onObs int64
	err = a.db.QueryRow(ctx, `
		SELECT o.user_id, o.id FROM media m JOIN observations o ON o.id = m.observation_id
		WHERE m.kind = 'photo' AND m.phash IS NOT NULL AND bit_count((m.phash # $1)::bit(64)) <= 4
		ORDER BY o.user_id = $2 DESC LIMIT 1`, hash, uploader).Scan(&owner, &onObs)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return "", nil
	case err != nil:
		return "", err
	case owner != uploader:
		return "this photo is already on someone else's sighting; please upload your own photos", nil
	case onObs == oid:
		return "this photo is already on this sighting", nil
	default:
		return "you've already added this photo to another of your sightings", nil
	}
}

// spamCheck runs before a new sighting is stored. A retry of one already created (same client_id) passes, so
// the offline queue's retries are never mistaken for duplicates. A rejection is a status code and response body;
// code 0 means the sighting may be saved.
func (a *Server) spamCheck(ctx context.Context, uid int64, in observationInput) (code int, body map[string]any, err error) {
	if in.ClientID != "" {
		var retry bool
		if err := a.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM observations WHERE user_id = $1 AND client_id = $2)`,
			uid, in.ClientID).Scan(&retry); err != nil || retry {
			return 0, nil, err
		}
	}
	if a.rateLimited(ctx, "obs:"+strconv.FormatInt(uid, 10), 300, time.Hour) {
		return http.StatusTooManyRequests, map[string]any{"error": "too many sightings this hour, they'll upload a little later"}, nil
	}
	if in.SpeciesID != nil { // two unknown birds at the same spot can be different birds: only known species count
		var dup int64
		err := a.db.QueryRow(ctx, `
			SELECT id FROM observations
			WHERE user_id = $1 AND species_id = $2 AND abs(extract(epoch FROM observed_at - $3)) <= 60
			  AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, 30)
			LIMIT 1`, uid, in.SpeciesID, in.ObservedAt, *in.Lat, *in.Lng).Scan(&dup)
		if err == nil {
			return http.StatusConflict, map[string]any{"error": "this looks like a sighting you already saved (same bird, place and minute)",
				"code": "duplicate", "observation_id": dup}, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return 0, nil, err
		}
	}
	var burst int
	if err := a.db.QueryRow(ctx, `SELECT count(*) FROM observations WHERE user_id = $1 AND observed_at BETWEEN $2::timestamptz - interval '5 minutes'
		AND $2::timestamptz + interval '5 minutes'`, uid, in.ObservedAt).Scan(&burst); err != nil {
		return 0, nil, err
	}
	if burst >= 60 {
		return http.StatusBadRequest, map[string]any{"error": "that's a lot of sightings for the same few minutes; for a flock, use the count on one sighting",
			"code": "burst"}, nil
	}
	return 0, nil, nil
}
