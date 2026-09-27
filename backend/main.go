package main

import (
	"context"
	"embed"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// LRN-07: the 3D bird for the glossary (Smithsonian "Cher Ami" pigeon scan, CC0), shrunk with gltf-transform.
//
//go:embed models/*.glb
var modelFS embed.FS

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return v
	}
	return fallback
}

func envFloat(key string, fallback float64) float64 {
	if v, err := strconv.ParseFloat(os.Getenv(key), 64); err == nil {
		return v
	}
	return fallback
}

// loadDotEnv sets KEY=VALUE lines from backend/.env (dev secrets, gitignored) without overriding real env vars.
func loadDotEnv(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		k, v, ok := strings.Cut(strings.TrimSpace(line), "=")
		if ok && k != "" && !strings.HasPrefix(k, "#") && os.Getenv(k) == "" {
			os.Setenv(k, strings.Trim(v, `"'`))
		}
	}
}

func main() {
	loadDotEnv(".env")
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := openDB(ctx)
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	defer db.Close()

	if err := migrate(ctx, db); err != nil {
		log.Fatal(err)
	}
	if len(os.Args) > 1 && os.Args[1] == "seed-species" {
		path := "seed/ioc_species.csv"
		if len(os.Args) > 2 {
			path = os.Args[2]
		}
		n, dropped, err := seedSpecies(ctx, db, path)
		if err != nil {
			log.Fatalf("seed species: %v", err)
		}
		log.Printf("seeded %d species", n)
		if len(dropped) > 0 { // ADM-02: lumped or split in the new list; an admin merges or splits them in the app
			log.Printf("%d species are not in this list and haven't been merged or split yet: %s", len(dropped), strings.Join(dropped, ", "))
		}
		return
	}
	// ADM-02: go run . import-local-names <csv with scientific_name,name,language>
	if len(os.Args) == 3 && os.Args[1] == "import-local-names" {
		added, unknown, err := importLocalNames(ctx, db, os.Args[2])
		if err != nil {
			log.Fatalf("import-local-names: %v", err)
		}
		log.Printf("import-local-names: %d names added or updated; %d rows with unknown species: %s", added, len(unknown), strings.Join(unknown, ", "))
		return
	}
	// OBS-14: go run . set-sensitive "<scientific name>" true|false — until the admin console (ADM-03).
	if len(os.Args) == 4 && os.Args[1] == "set-sensitive" {
		tag, err := db.Exec(ctx, `UPDATE species SET sensitive = $2 WHERE scientific_name = $1`, os.Args[2], os.Args[3] == "true")
		if err != nil || tag.RowsAffected() == 0 {
			log.Fatalf("set-sensitive: no species %q (%v)", os.Args[2], err)
		}
		log.Printf("%s sensitive = %v", os.Args[2], os.Args[3] == "true")
		return
	}
	// OBS-06: go run . seed-region — Sierra Leone species + months from GBIF (~110 requests); rerun to refresh.
	if len(os.Args) > 1 && os.Args[1] == "seed-region" {
		matched, unmatched, err := (&server{db: db}).seedRegion(ctx, newGBIFClient())
		if err != nil {
			log.Fatalf("seed-region: %v", err)
		}
		log.Printf("seed-region: %d species matched; %d GBIF names not in our taxonomy: %s",
			matched, len(unmatched), strings.Join(unmatched, ", "))
		return
	}
	// LIB-01: go run . seed-details [limit] — Wikipedia text + IUCN status for Sierra Leone species; resumable.
	if len(os.Args) > 1 && os.Args[1] == "seed-details" {
		limit := 1 << 30
		if len(os.Args) > 2 {
			if limit, err = strconv.Atoi(os.Args[2]); err != nil {
				log.Fatalf("seed-details: limit must be a number")
			}
		}
		found, missing, err := (&server{db: db}).seedDetails(ctx, newWikiClient(), limit)
		if err != nil {
			log.Fatalf("seed-details: %v (found %d, missing %d so far; rerun to resume)", err, found, missing)
		}
		log.Printf("seed-details: %d articles stored, %d species without one", found, missing)
		return
	}
	// Bootstraps the first admin; in-app role assignment is ADM-04.
	if len(os.Args) == 4 && os.Args[1] == "set-role" {
		tag, err := db.Exec(ctx, `UPDATE users SET role = $2 WHERE email = $1`, os.Args[2], os.Args[3])
		if err != nil || tag.RowsAffected() == 0 {
			log.Fatalf("set-role: no user %q or bad role %q (%v)", os.Args[2], os.Args[3], err)
		}
		log.Printf("%s is now %s", os.Args[2], os.Args[3])
		return
	}

	cache, err := openCache()
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer cache.Close()

	media, err := openStore(ctx)
	if err != nil {
		log.Fatalf("s3: %v", err)
	}
	// LIB-12b: go run . seed-sounds [limit] — needs XENO_API_KEY; resumable, ~1 species/second.
	if len(os.Args) > 1 && os.Args[1] == "seed-sounds" {
		limit := 1 << 30
		if len(os.Args) > 2 {
			if limit, err = strconv.Atoi(os.Args[2]); err != nil {
				log.Fatalf("seed-sounds: limit must be a number")
			}
		}
		xc, err := newXenoClient()
		if err != nil {
			log.Fatalf("seed-sounds: %v", err)
		}
		a := &server{db: db, cache: cache, media: media}
		found, missing, failed, err := a.seedSounds(ctx, xc, limit)
		if err != nil {
			log.Fatalf("seed-sounds: %v (found %d, missing %d, %d to retry; rerun to resume)", err, found, missing, failed)
		}
		log.Printf("seed-sounds: done, %d sounds added, %d species without a suitable recording, %d to retry", found, missing, failed)
		return
	}
	// LIB-09: go run . seed-sound-gallery [limit] — songs/calls/alarms/flight calls per Sierra Leone species; resumable.
	if len(os.Args) > 1 && os.Args[1] == "seed-sound-gallery" {
		limit := 1 << 30
		if len(os.Args) > 2 {
			if limit, err = strconv.Atoi(os.Args[2]); err != nil {
				log.Fatalf("seed-sound-gallery: limit must be a number")
			}
		}
		xc, err := newXenoClient()
		if err != nil {
			log.Fatalf("seed-sound-gallery: %v", err)
		}
		a := &server{db: db, cache: cache, media: media}
		species, sounds, err := a.seedSoundGallery(ctx, xc, limit)
		if err != nil {
			log.Fatalf("seed-sound-gallery: %v (%d species, %d recordings so far; rerun to resume)", err, species, sounds)
		}
		log.Printf("seed-sound-gallery: done, %d species looked up, %d recordings stored", species, sounds)
		return
	}
	// LIB-08: go run . seed-gallery [limit] — up to 8 tagged iNaturalist photos per Sierra Leone species; resumable.
	if len(os.Args) > 1 && os.Args[1] == "seed-gallery" {
		limit := 1 << 30
		if len(os.Args) > 2 {
			if limit, err = strconv.Atoi(os.Args[2]); err != nil {
				log.Fatalf("seed-gallery: limit must be a number")
			}
		}
		a := &server{db: db, cache: cache, media: media}
		wc := newWikiClient()
		wc.http.Timeout = 2 * time.Minute // large photos from a busy bucket
		species, photos, err := a.seedGallery(ctx, newINatClient(), wc, limit)
		if err != nil {
			log.Fatalf("seed-gallery: %v (%d species, %d photos so far; rerun to resume)", err, species, photos)
		}
		log.Printf("seed-gallery: done, %d species looked up, %d photos stored", species, photos)
		return
	}
	// LIB-12: go run . seed-images [limit] — resumable; set WIKIMEDIA_CONTACT to a URL or email for Wikimedia's API policy.
	if len(os.Args) > 1 && os.Args[1] == "seed-images" {
		limit := 1 << 30
		if len(os.Args) > 2 {
			if limit, err = strconv.Atoi(os.Args[2]); err != nil {
				log.Fatalf("seed-images: limit must be a number")
			}
		}
		a := &server{db: db, cache: cache, media: media}
		found, missing, err := a.seedImages(ctx, newWikiClient(), limit)
		if err != nil {
			log.Fatalf("seed-images: %v (found %d, missing %d so far; rerun to resume)", err, found, missing)
		}
		log.Printf("seed-images: done, %d photos added, %d species without a free photo", found, missing)
		return
	}

	srv := &http.Server{Addr: env("ADDR", ":8080"), Handler: routes(db, cache, media), ReadHeaderTimeout: 10 * time.Second}
	go (&server{db: db, cache: cache, media: media}).remindersLoop(ctx) // NTF-02
	go func() {
		log.Printf("listening on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
}

func openCache() (*redis.Client, error) {
	opts, err := redis.ParseURL(env("REDIS_URL", "redis://localhost:6380/0"))
	if err != nil {
		return nil, err
	}
	return redis.NewClient(opts), nil
}

func routes(db *pgxpool.Pool, cache *redis.Client, media *store) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		status := map[string]string{"postgres": "ok", "redis": "ok"}
		code := http.StatusOK
		if err := db.Ping(ctx); err != nil {
			status["postgres"], code = err.Error(), http.StatusServiceUnavailable
		}
		if err := cache.Ping(ctx).Err(); err != nil {
			status["redis"], code = err.Error(), http.StatusServiceUnavailable
		}
		writeJSON(w, code, status)
	})
	mux.HandleFunc("GET /features", listFeatures)
	mux.HandleFunc("GET /media/{key...}", media.serve)
	mux.Handle("GET /models/", http.FileServerFS(modelFS))

	a := &server{db: db, cache: cache, media: media}
	mux.HandleFunc("GET /species", a.listSpecies)
	mux.HandleFunc("GET /species/pick", a.optionalUser(a.pickSpecies))
	mux.HandleFunc("GET /species/cards", a.speciesCards)
	mux.HandleFunc("GET /species/families-of", a.familiesOf)
	mux.HandleFunc("GET /families", a.listFamilies)
	mux.HandleFunc("GET /sites", a.nearbySites)
	mux.HandleFunc("POST /sites", a.requireUser(a.createSite))
	mux.HandleFunc("GET /species/{id}", a.getSpecies)
	mux.HandleFunc("GET /species/{id}/photos", a.speciesPhotos)
	mux.HandleFunc("GET /species/{id}/similar", a.similarSpecies)
	mux.HandleFunc("GET /species/{id}/sightings-map", a.optionalUser(a.speciesSightingsMap))
	mux.HandleFunc("GET /species/{id}/tips", a.listTips)
	mux.HandleFunc("GET /species/{id}/likely", a.speciesLikely)
	mux.HandleFunc("PUT /species/{id}/mnemonic", a.requireRole("verifier", a.putMnemonic))
	mux.HandleFunc("GET /packs/sierra-leone", a.sierraLeonePack)
	mux.HandleFunc("GET /s/{id}", a.shareSpecies)
	mux.HandleFunc("GET /o/{id}", a.shareObservation)
	mux.HandleFunc("GET /area/checklist", a.optionalUser(a.areaChecklist))
	mux.HandleFunc("PUT /species/{id}/tips", a.requireRole("verifier", a.putTip))
	mux.HandleFunc("DELETE /tips/{id}", a.requireRole("verifier", a.deleteTip))
	mux.HandleFunc("GET /compare", a.compare)
	mux.HandleFunc("GET /lessons", a.listLessons)
	mux.HandleFunc("GET /lessons/{slug}", a.getLesson)
	mux.HandleFunc("GET /admin/lessons", a.requireRole("admin", a.adminLessons))
	mux.HandleFunc("PUT /admin/lessons/{slug}", a.requireRole("admin", a.putLesson))
	mux.HandleFunc("DELETE /admin/lessons/{slug}", a.requireRole("admin", a.deleteLesson))
	mux.HandleFunc("GET /admin/challenges", a.requireRole("admin", a.adminChallenges))
	mux.HandleFunc("PUT /admin/challenges/{id}", a.requireRole("admin", a.putChallenge))
	mux.HandleFunc("GET /admin/analytics", a.requireRole("admin", a.adminAnalytics))
	mux.HandleFunc("POST /admin/export-link", a.requireRole("admin", a.exportLink))
	mux.HandleFunc("GET /export/occurrences.csv", a.exportCSV)
	mux.HandleFunc("GET /gbif/dwca.zip", a.gbifArchive)
	mux.HandleFunc("GET /quiz/picture", a.optionalUser(a.quiz("photo")))
	mux.HandleFunc("GET /quiz/sound", a.optionalUser(a.quiz("sound")))
	mux.HandleFunc("GET /games/spot", a.spotGame)
	mux.HandleFunc("GET /quiz/chorus", a.chorus)
	mux.HandleFunc("POST /duels", a.requireUser(a.createDuel))
	mux.HandleFunc("GET /duels/{code}", a.requireUser(a.getDuel))
	mux.HandleFunc("POST /duels/{code}/score", a.requireUser(a.scoreDuel))
	mux.HandleFunc("GET /me/duels", a.requireUser(a.myDuels))
	mux.HandleFunc("PUT /quiz/suitability", a.requireRole("verifier", a.setQuizSuitable))
	mux.HandleFunc("POST /auth/signup", a.signup)
	mux.HandleFunc("POST /auth/login", a.login)
	mux.HandleFunc("POST /auth/google", a.googleSignIn)
	mux.HandleFunc("POST /auth/logout", a.logout)
	mux.HandleFunc("GET /me", a.requireUser(a.me))
	mux.HandleFunc("GET /me/stats", a.requireUser(a.myStats))
	mux.HandleFunc("GET /me/lifelist", a.requireUser(a.lifeList))
	mux.HandleFunc("GET /me/achievements", a.requireUser(a.myAchievements))
	mux.HandleFunc("GET /challenges", a.optionalUser(a.weekChallenges))
	mux.HandleFunc("GET /leaderboard", a.optionalUser(a.leaderboard))
	mux.HandleFunc("GET /events", a.optionalUser(a.listEvents))
	mux.HandleFunc("POST /groups", a.requireUser(a.createGroup))
	mux.HandleFunc("GET /me/groups", a.requireUser(a.myGroups))
	mux.HandleFunc("POST /groups/join", a.requireUser(a.joinGroup))
	mux.HandleFunc("GET /groups/{id}", a.requireUser(a.getGroup))
	mux.HandleFunc("GET /groups/{id}/sightings", a.requireUser(a.groupSightings))
	mux.HandleFunc("DELETE /groups/{id}", a.requireUser(a.ownGroup))
	mux.HandleFunc("POST /groups/{id}/code", a.requireUser(a.ownGroup))
	mux.HandleFunc("DELETE /groups/{id}/members/{user}", a.requireUser(a.removeMember))
	mux.HandleFunc("POST /groups/{id}/challenges", a.requireUser(a.groupChallengeWrite))
	mux.HandleFunc("DELETE /groups/{id}/challenges/{cid}", a.requireUser(a.groupChallengeWrite))
	mux.HandleFunc("GET /events/{slug}", a.optionalUser(a.getEvent))
	mux.HandleFunc("PUT /admin/events/{slug}", a.requireRole("admin", a.putEvent))
	mux.HandleFunc("DELETE /admin/events/{slug}", a.requireRole("admin", a.deleteEvent))
	mux.HandleFunc("GET /me/learn-next", a.requireUser(a.learnNext))
	mux.HandleFunc("POST /outings", a.requireUser(a.upsertOuting))
	mux.HandleFunc("GET /outings/{id}", a.requireUser(a.getOuting))
	mux.HandleFunc("GET /me/outings", a.requireUser(a.myOutings))
	mux.HandleFunc("GET /me/quiz-stats", a.requireUser(a.myQuizStats))
	mux.HandleFunc("POST /me/quiz-stats", a.requireUser(a.addQuizStats))
	mux.HandleFunc("GET /me/notifications", a.requireUser(a.myNotifications))
	mux.HandleFunc("POST /me/notifications/read", a.requireUser(a.readNotifications))
	mux.HandleFunc("POST /me/push-token", a.requireUser(a.savePushToken))
	mux.HandleFunc("GET /me/devices", a.requireUser(a.myDevices))
	mux.HandleFunc("DELETE /me/notifications/{id}", a.requireUser(a.deleteNotifications))
	mux.HandleFunc("DELETE /me/notifications", a.requireUser(a.deleteNotifications))
	mux.HandleFunc("DELETE /me/push-token", a.requireUser(a.deletePushToken))
	mux.HandleFunc("DELETE /me", a.requireUser(a.deleteAccount))
	mux.HandleFunc("GET /me/export", a.requireUser(a.exportAccount))
	mux.HandleFunc("PATCH /me", a.requireUser(a.updateProfile))
	mux.HandleFunc("POST /me/guidelines", a.requireUser(a.acceptGuidelines))
	mux.HandleFunc("PUT /me/avatar", a.requireUser(a.putAvatar))
	mux.HandleFunc("DELETE /me/avatar", a.requireUser(a.deleteAvatar))
	mux.HandleFunc("GET /users/{id}", a.optionalUser(a.getProfile))
	mux.HandleFunc("PUT /users/{id}/block", a.requireUser(a.block))
	mux.HandleFunc("DELETE /users/{id}/block", a.requireUser(a.block))
	mux.HandleFunc("POST /users/{id}/report", a.requireUser(a.reportUser))
	mux.HandleFunc("GET /me/blocks", a.requireUser(a.myBlocks))
	mux.HandleFunc("PUT /users/{id}/follow", a.requireUser(a.follow))
	mux.HandleFunc("DELETE /users/{id}/follow", a.requireUser(a.follow))
	mux.HandleFunc("GET /me/following", a.requireUser(a.myFollowing))
	mux.HandleFunc("GET /me/rare-alerts", a.requireUser(a.rareAlerts))
	mux.HandleFunc("PUT /me/rare-alerts", a.requireUser(a.rareAlerts))
	mux.HandleFunc("PUT /observations/{id}/like", a.requireUser(a.like))
	mux.HandleFunc("DELETE /observations/{id}/like", a.requireUser(a.like))
	mux.HandleFunc("GET /activity", a.optionalUser(a.activity))

	mux.HandleFunc("GET /observations", a.optionalUser(a.feed))
	mux.HandleFunc("GET /verify/queue", a.requireRole("verifier", a.verifyQueue))
	mux.HandleFunc("PUT /verify/reference", a.requireRole("verifier", a.setReference))
	mux.HandleFunc("PUT /photos/tags", a.requireUser(a.setPhotoTags))
	mux.HandleFunc("POST /photos/marks", a.requireRole("verifier", a.addFieldMark))
	mux.HandleFunc("DELETE /photos/marks/{id}", a.requireRole("verifier", a.deleteFieldMark))
	mux.HandleFunc("GET /mod/queue", a.requireRole("moderator", a.modQueue))
	mux.HandleFunc("POST /admin/species/{id}/names", a.requireRole("admin", a.addLocalName))
	mux.HandleFunc("DELETE /admin/species/{id}/names", a.requireRole("admin", a.deleteLocalName))
	mux.HandleFunc("POST /admin/species/merge", a.requireRole("admin", a.mergeSpecies))
	mux.HandleFunc("GET /admin/sensitive", a.requireRole("admin", a.listSensitive))
	mux.HandleFunc("GET /admin/users", a.requireRole("admin", a.searchUsers))
	mux.HandleFunc("PUT /admin/users/{id}/role", a.requireRole("admin", a.setUserRole))
	mux.HandleFunc("PUT /admin/species/{id}/sensitive", a.requireRole("admin", a.setSensitive))
	mux.HandleFunc("POST /admin/species/split", a.requireRole("admin", a.splitSpecies))
	mux.HandleFunc("POST /mod/observations/{id}", a.requireRole("moderator", a.moderateObservation))
	mux.HandleFunc("POST /mod/users/{id}", a.requireRole("moderator", a.moderateUser))
	mux.HandleFunc("POST /mod/comments/{id}", a.requireRole("moderator", a.moderateComment))
	mux.HandleFunc("GET /observations/{id}/comments", a.optionalUser(a.listComments))
	mux.HandleFunc("POST /observations/{id}/comments", a.requireUser(a.addComment))
	mux.HandleFunc("DELETE /comments/{id}", a.requireUser(a.deleteComment))
	mux.HandleFunc("POST /comments/{id}/report", a.requireUser(a.reportComment))
	mux.HandleFunc("POST /observations", a.requireUser(a.createObservation))
	mux.HandleFunc("GET /me/observations", a.requireUser(a.myObservations))
	mux.HandleFunc("GET /observations/{id}", a.optionalUser(a.getObservation))
	mux.HandleFunc("PUT /observations/{id}", a.requireUser(a.updateObservation))
	mux.HandleFunc("DELETE /observations/{id}", a.requireUser(a.deleteObservation))
	mux.HandleFunc("GET /observations/{id}/history", a.requireUser(a.observationHistory))
	mux.HandleFunc("GET /observations/{id}/identifications", a.optionalUser(a.listIdentifications))
	mux.HandleFunc("POST /observations/{id}/identifications", a.requireUser(a.addIdentification))
	mux.HandleFunc("DELETE /observations/{id}/identifications", a.requireUser(a.withdrawIdentification))
	mux.HandleFunc("POST /observations/{id}/flags", a.requireUser(a.flagObservation))
	mux.HandleFunc("POST /observations/{id}/photos", a.requireUser(a.addPhoto))
	mux.HandleFunc("DELETE /observations/{id}/photos/{photoID}", a.requireUser(a.deletePhoto))
	mux.HandleFunc("POST /observations/{id}/sounds", a.requireUser(a.addSound))
	mux.HandleFunc("DELETE /observations/{id}/sounds/{photoID}", a.requireUser(a.deletePhoto))
	mux.HandleFunc("POST /audio/preview", a.requireUser(a.previewAudio))

	return mux
}
