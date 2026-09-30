package api

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/slbirdwatch/backend/internal/database"
)

// Command is a maintenance task run from the command line: `birdwatch <name> [args]`.
type Command struct {
	Usage      string
	NeedsMedia bool // needs Redis and S3 as well as Postgres
	Run        func(ctx context.Context, a *Server, args []string) error
}

// Commands are the maintenance tasks. The seeders are resumable: rerun one to continue where it stopped.
var Commands = map[string]Command{
	"seed-species": {Usage: "[csv]", Run: func(ctx context.Context, a *Server, args []string) error {
		path := "seed/ioc_species.csv"
		if len(args) > 0 {
			path = args[0]
		}
		n, dropped, err := database.SeedSpecies(ctx, a.db, path)
		if err != nil {
			return err
		}
		log.Printf("seeded %d species", n)
		if len(dropped) > 0 { // ADM-02: lumped or split in the new list; an admin merges or splits them in the app
			log.Printf("%d species are not in this list and haven't been merged or split yet: %s", len(dropped), strings.Join(dropped, ", "))
		}
		return nil
	}},
	// ADM-02: a CSV with scientific_name,name,language
	"import-local-names": {Usage: "<csv>", Run: func(ctx context.Context, a *Server, args []string) error {
		if len(args) != 1 {
			return errUsage
		}
		added, unknown, err := importLocalNames(ctx, a.db, args[0])
		if err != nil {
			return err
		}
		log.Printf("%d names added or updated; %d rows with unknown species: %s", added, len(unknown), strings.Join(unknown, ", "))
		return nil
	}},
	// OBS-14: also settable in the admin console (ADM-03).
	"set-sensitive": {Usage: `"<scientific name>" true|false`, Run: func(ctx context.Context, a *Server, args []string) error {
		if len(args) != 2 {
			return errUsage
		}
		tag, err := a.db.Exec(ctx, `UPDATE species SET sensitive = $2 WHERE scientific_name = $1`, args[0], args[1] == "true")
		if err != nil || tag.RowsAffected() == 0 {
			return fmt.Errorf("no species %q (%v)", args[0], err)
		}
		log.Printf("%s sensitive = %v", args[0], args[1] == "true")
		return nil
	}},
	// Bootstraps the first admin; after that, roles are assigned in the app (ADM-04).
	"set-role": {Usage: "<email> <role>", Run: func(ctx context.Context, a *Server, args []string) error {
		if len(args) != 2 {
			return errUsage
		}
		tag, err := a.db.Exec(ctx, `UPDATE users SET role = $2 WHERE email = $1`, args[0], args[1])
		if err != nil || tag.RowsAffected() == 0 {
			return fmt.Errorf("no user %q or bad role %q (%v)", args[0], args[1], err)
		}
		log.Printf("%s is now %s", args[0], args[1])
		return nil
	}},
	// OBS-06: Sierra Leone species + months from GBIF (~110 requests); rerun to refresh.
	"seed-region": {Run: func(ctx context.Context, a *Server, _ []string) error {
		matched, unmatched, err := a.seedRegion(ctx, newGBIFClient())
		if err != nil {
			return err
		}
		log.Printf("%d species matched; %d GBIF names not in our taxonomy: %s", matched, len(unmatched), strings.Join(unmatched, ", "))
		return nil
	}},
	// LIB-01: Wikipedia text + IUCN status for Sierra Leone species.
	"seed-details": {Usage: "[limit]", Run: withLimit(func(ctx context.Context, a *Server, limit int) error {
		found, missing, err := a.seedDetails(ctx, newWikiClient(), limit)
		if err != nil {
			return fmt.Errorf("%w (found %d, missing %d so far)", err, found, missing)
		}
		log.Printf("%d articles stored, %d species without one", found, missing)
		return nil
	})},
	// LIB-12b: needs XENO_API_KEY; ~1 species/second.
	"seed-sounds": {Usage: "[limit]", NeedsMedia: true, Run: withLimit(func(ctx context.Context, a *Server, limit int) error {
		xc, err := newXenoClient()
		if err != nil {
			return err
		}
		found, missing, failed, err := a.seedSounds(ctx, xc, limit)
		if err != nil {
			return fmt.Errorf("%w (found %d, missing %d, %d to retry)", err, found, missing, failed)
		}
		log.Printf("%d sounds added, %d species without a suitable recording, %d to retry", found, missing, failed)
		return nil
	})},
	// LIB-09: songs/calls/alarms/flight calls per Sierra Leone species.
	"seed-sound-gallery": {Usage: "[limit]", NeedsMedia: true, Run: withLimit(func(ctx context.Context, a *Server, limit int) error {
		xc, err := newXenoClient()
		if err != nil {
			return err
		}
		species, sounds, err := a.seedSoundGallery(ctx, xc, limit)
		if err != nil {
			return fmt.Errorf("%w (%d species, %d recordings so far)", err, species, sounds)
		}
		log.Printf("%d species looked up, %d recordings stored", species, sounds)
		return nil
	})},
	// LIB-08: up to 8 tagged iNaturalist photos per Sierra Leone species.
	"seed-gallery": {Usage: "[limit]", NeedsMedia: true, Run: withLimit(func(ctx context.Context, a *Server, limit int) error {
		wc := newWikiClient()
		wc.http.Timeout = 2 * time.Minute // large photos from a busy bucket
		species, photos, err := a.seedGallery(ctx, newINatClient(), wc, limit)
		if err != nil {
			return fmt.Errorf("%w (%d species, %d photos so far)", err, species, photos)
		}
		log.Printf("%d species looked up, %d photos stored", species, photos)
		return nil
	})},
	// LIB-12: set WIKIMEDIA_CONTACT to a URL or email for Wikimedia's API policy.
	"seed-images": {Usage: "[limit]", NeedsMedia: true, Run: withLimit(func(ctx context.Context, a *Server, limit int) error {
		found, missing, err := a.seedImages(ctx, newWikiClient(), limit)
		if err != nil {
			return fmt.Errorf("%w (found %d, missing %d so far)", err, found, missing)
		}
		log.Printf("%d photos added, %d species without a free photo", found, missing)
		return nil
	})},
}

var errUsage = fmt.Errorf("wrong arguments")

// withLimit parses an optional first argument as how many species to process.
func withLimit(run func(ctx context.Context, a *Server, limit int) error) func(context.Context, *Server, []string) error {
	return func(ctx context.Context, a *Server, args []string) error {
		limit := 1 << 30
		if len(args) > 0 {
			n, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("limit must be a number")
			}
			limit = n
		}
		return run(ctx, a, limit)
	}
}
