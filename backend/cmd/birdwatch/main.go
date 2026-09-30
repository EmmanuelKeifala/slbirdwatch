// Command birdwatch serves the SL Birdwatch API, or runs a maintenance task: birdwatch <task> [args].
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"maps"
	"net/http"
	"os"
	"os/signal"
	"slices"
	"syscall"
	"time"

	"github.com/slbirdwatch/backend/internal/api"
	"github.com/slbirdwatch/backend/internal/config"
	"github.com/slbirdwatch/backend/internal/database"
	"github.com/slbirdwatch/backend/internal/storage"
)

func main() {
	config.LoadDotEnv(".env")
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:]); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context, args []string) error {
	var cmd api.Command
	if len(args) > 0 {
		var ok bool
		if cmd, ok = api.Commands[args[0]]; !ok {
			return fmt.Errorf("unknown task %q; tasks: %v", args[0], slices.Sorted(maps.Keys(api.Commands)))
		}
	}

	db, err := database.Open(ctx)
	if err != nil {
		return fmt.Errorf("postgres: %w", err)
	}
	defer db.Close()
	if err := database.Migrate(ctx, db); err != nil {
		return err
	}
	if cmd.Run != nil && !cmd.NeedsMedia {
		return runTask(ctx, args, cmd, api.New(db, nil, nil))
	}

	cache, err := database.OpenRedis()
	if err != nil {
		return fmt.Errorf("redis: %w", err)
	}
	defer cache.Close()
	media, err := storage.Open(ctx)
	if err != nil {
		return fmt.Errorf("s3: %w", err)
	}
	a := api.New(db, cache, media)
	if cmd.Run != nil {
		return runTask(ctx, args, cmd, a)
	}
	return serve(ctx, a)
}

func runTask(ctx context.Context, args []string, cmd api.Command, a *api.Server) error {
	if err := cmd.Run(ctx, a, args[1:]); err != nil {
		return fmt.Errorf("%s %s: %w", args[0], cmd.Usage, err)
	}
	return nil
}

func serve(ctx context.Context, a *api.Server) error {
	srv := &http.Server{
		Addr:              config.Env("ADDR", ":8080"),
		Handler:           a.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute, // keep-alive for the app's bursts of requests, without hoarding sockets
		MaxHeaderBytes:    64 << 10,
		// No Read/WriteTimeout: 15 MB uploads and the offline pack take minutes on slow mobile links.
	}
	go a.RemindersLoop(ctx) // NTF-02

	errc := make(chan error, 1)
	go func() {
		log.Printf("listening on %s", srv.Addr)
		errc <- srv.ListenAndServe()
	}()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
