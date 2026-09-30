package api

import (
	"context"
	"embed"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/klauspost/compress/gzhttp"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"

	"github.com/slbirdwatch/backend/internal/storage"
)

// LRN-07: the 3D bird for the glossary (Smithsonian "Cher Ami" pigeon scan, CC0), shrunk with gltf-transform.
//
//go:embed models/*.glb
var modelFS embed.FS

// Server holds what the handlers share. The zero value of every other field is ready to use.
type Server struct {
	db    *pgxpool.Pool
	cache *redis.Client
	media *storage.Store

	packs  singleflight.Group // one offline-pack build at a time (LIB-11)
	active activeUsers        // ADM-06 daily-active bookkeeping, deduplicated in memory
}

func New(db *pgxpool.Pool, cache *redis.Client, media *storage.Store) *Server {
	return &Server{db: db, cache: cache, media: media}
}

// Handler is the API with response compression: JSON shrinks ~5-10x, which matters on mobile data in Sierra Leone.
// gzhttp skips small bodies and already-compressed types (JPEG, audio), and leaves range requests alone.
// Media is served as-is: it is already compressed and clients seek audio with range requests.
func (a *Server) Handler() http.Handler {
	mux := a.routes()
	gz := gzhttp.GzipHandler(mux)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/media/") {
			mux.ServeHTTP(w, r)
			return
		}
		gz.ServeHTTP(w, r)
	})
}

func (a *Server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", a.health)
	mux.HandleFunc("GET /features", listFeatures)
	mux.Handle("GET /media/{key...}", a.media)
	mux.Handle("GET /models/", http.FileServerFS(modelFS))

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

func (a *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	status := map[string]string{"postgres": "ok", "redis": "ok"}
	code := http.StatusOK
	if err := a.db.Ping(ctx); err != nil {
		status["postgres"], code = err.Error(), http.StatusServiceUnavailable
	}
	if err := a.cache.Ping(ctx).Err(); err != nil {
		status["redis"], code = err.Error(), http.StatusServiceUnavailable
	}
	writeJSON(w, code, status)
}
