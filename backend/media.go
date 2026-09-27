package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/minio/minio-go/v7"
	s3creds "github.com/minio/minio-go/v7/pkg/credentials"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	maxUploadBytes = 15 << 20 // phones should resize first (NFR-04); this is the hard stop
	maxPixels      = 50_000_000
)

type store struct {
	s3        *minio.Client
	bucket    string
	publicURL string // CDN base in production; empty = served by this API under /media/
}

func openStore(ctx context.Context) (*store, error) {
	c, err := minio.New(env("S3_ENDPOINT", "localhost:9000"), &minio.Options{
		Creds:  s3creds.NewStaticV4(env("S3_ACCESS_KEY", "birdwatch"), env("S3_SECRET_KEY", "birdwatch-secret"), ""),
		Secure: env("S3_USE_SSL", "false") == "true",
	})
	if err != nil {
		return nil, err
	}
	st := &store{s3: c, bucket: env("S3_BUCKET", "birdwatch-media"), publicURL: strings.TrimSuffix(env("MEDIA_PUBLIC_URL", ""), "/")}
	exists, err := c.BucketExists(ctx, st.bucket)
	if err != nil {
		return nil, fmt.Errorf("bucket check: %w", err)
	}
	if !exists {
		if err := c.MakeBucket(ctx, st.bucket, minio.MakeBucketOptions{}); err != nil {
			return nil, fmt.Errorf("make bucket: %w", err)
		}
	}
	return st, nil
}

// url returns where clients fetch a stored object: absolute on a CDN, or an API-relative path in dev.
func (st *store) url(key string) string {
	if st.publicURL != "" {
		return st.publicURL + "/" + key
	}
	return "/media/" + key
}

func newKey(prefix, ext string) string {
	b := make([]byte, 12)
	rand.Read(b)
	return prefix + hex.EncodeToString(b) + ext
}

var errBadImage = errors.New("upload a JPEG, PNG or WebP image")

// processImage decodes an upload and re-encodes it as JPEG. Re-encoding drops all metadata,
// including EXIF GPS (NFR-07). squareSide > 0 centre-crops to a square of that side;
// otherwise the long edge is capped at maxEdge.
func processImage(r io.Reader, squareSide, maxEdge int) (jpg []byte, width, height int, err error) {
	data, err := io.ReadAll(io.LimitReader(r, maxUploadBytes+1))
	if err != nil {
		return nil, 0, 0, err
	}
	if len(data) > maxUploadBytes {
		return nil, 0, 0, fmt.Errorf("image is larger than %d MB", maxUploadBytes>>20)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, 0, 0, errBadImage
	}
	if cfg.Width*cfg.Height > maxPixels { // decompression-bomb guard before allocating
		return nil, 0, 0, errors.New("image dimensions are too large")
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, 0, 0, errBadImage
	}

	b := src.Bounds()
	var dst *image.RGBA
	if squareSide > 0 {
		side := min(b.Dx(), b.Dy())
		crop := image.Rect(0, 0, side, side).Add(image.Pt(b.Min.X+(b.Dx()-side)/2, b.Min.Y+(b.Dy()-side)/2))
		out := min(squareSide, side)
		dst = image.NewRGBA(image.Rect(0, 0, out, out))
		draw.CatmullRom.Scale(dst, dst.Bounds(), src, crop, draw.Src, nil)
	} else {
		w, h := b.Dx(), b.Dy()
		if long := max(w, h); long > maxEdge {
			w, h = w*maxEdge/long, h*maxEdge/long
		}
		dst = image.NewRGBA(image.Rect(0, 0, w, h))
		draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 85}); err != nil {
		return nil, 0, 0, err
	}
	return buf.Bytes(), dst.Bounds().Dx(), dst.Bounds().Dy(), nil
}

func (st *store) put(ctx context.Context, key, contentType string, data []byte) error {
	_, err := st.s3.PutObject(ctx, st.bucket, key, bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{ContentType: contentType, CacheControl: "public, max-age=31536000, immutable"})
	return err
}

func (st *store) putJPEG(ctx context.Context, key string, data []byte) error {
	return st.put(ctx, key, "image/jpeg", data)
}

func (st *store) remove(ctx context.Context, key string) {
	if err := st.s3.RemoveObject(ctx, st.bucket, key, minio.RemoveObjectOptions{}); err != nil {
		log.Printf("remove %s: %v", key, err) // orphaned object costs storage, not correctness
	}
}

// GET /media/{key...} streams an object in dev (or when no CDN is configured).
// Keys are random and never reused, so responses are cacheable forever.
func (st *store) serve(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	obj, err := st.s3.GetObject(r.Context(), st.bucket, key, minio.GetObjectOptions{})
	if err == nil {
		var info minio.ObjectInfo
		if info, err = obj.Stat(); err == nil {
			defer obj.Close()
			w.Header().Set("Content-Type", info.ContentType)
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			http.ServeContent(w, r, "", info.LastModified, obj)
			return
		}
	}
	if minio.ToErrorResponse(err).Code == "NoSuchKey" {
		http.NotFound(w, r)
		return
	}
	internalError(w, "serve media", err)
}
