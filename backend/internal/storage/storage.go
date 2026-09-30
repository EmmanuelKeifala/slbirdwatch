// Package storage keeps media in an S3-compatible bucket and prepares uploaded images for it.
package storage

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

	"github.com/slbirdwatch/backend/internal/config"
)

const (
	MaxUploadBytes = 15 << 20 // phones should resize first (NFR-04); this is the hard stop
	maxPixels      = 50_000_000
)

type Store struct {
	s3        *minio.Client
	bucket    string
	publicURL string // CDN base in production; empty = served by this API under /media/
}

// Open connects to S3_ENDPOINT and creates the bucket on first run.
func Open(ctx context.Context) (*Store, error) {
	c, err := minio.New(config.Env("S3_ENDPOINT", "localhost:9000"), &minio.Options{
		Creds:  s3creds.NewStaticV4(config.Env("S3_ACCESS_KEY", "birdwatch"), config.Env("S3_SECRET_KEY", "birdwatch-secret"), ""),
		Secure: config.Env("S3_USE_SSL", "false") == "true",
	})
	if err != nil {
		return nil, err
	}
	st := &Store{s3: c, bucket: config.Env("S3_BUCKET", "birdwatch-media"), publicURL: strings.TrimSuffix(config.Env("MEDIA_PUBLIC_URL", ""), "/")}
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

// URL returns where clients fetch a stored object: absolute on a CDN, or an API-relative path in dev.
func (st *Store) URL(key string) string {
	if st.publicURL != "" {
		return st.publicURL + "/" + key
	}
	return "/media/" + key
}

// NewKey is a random, never-reused object key.
func NewKey(prefix, ext string) string {
	b := make([]byte, 12)
	rand.Read(b)
	return prefix + hex.EncodeToString(b) + ext
}

var ErrBadImage = errors.New("upload a JPEG, PNG or WebP image")

// ProcessImage decodes an upload and re-encodes it as JPEG. Re-encoding drops all metadata,
// including EXIF GPS (NFR-07). squareSide > 0 centre-crops to a square of that side;
// otherwise the long edge is capped at maxEdge.
func ProcessImage(r io.Reader, squareSide, maxEdge int) (jpg []byte, width, height int, err error) {
	src, err := decode(r)
	if err != nil {
		return nil, 0, 0, err
	}
	dst := scale(src, squareSide, maxEdge)
	jpg, err = encode(dst)
	return jpg, dst.Bounds().Dx(), dst.Bounds().Dy(), err
}

// ProcessImageWithThumb is ProcessImage (long edge ≤ maxEdge) plus a thumbnail scaled from the in-memory result,
// so the upload is decoded once.
func ProcessImageWithThumb(r io.Reader, maxEdge, thumbEdge int) (full, thumb []byte, width, height int, err error) {
	src, err := decode(r)
	if err != nil {
		return nil, nil, 0, 0, err
	}
	dst := scale(src, 0, maxEdge)
	if full, err = encode(dst); err != nil {
		return nil, nil, 0, 0, err
	}
	if thumb, err = encode(scale(dst, 0, thumbEdge)); err != nil {
		return nil, nil, 0, 0, err
	}
	return full, thumb, dst.Bounds().Dx(), dst.Bounds().Dy(), nil
}

func decode(r io.Reader) (image.Image, error) {
	data, err := io.ReadAll(io.LimitReader(r, MaxUploadBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > MaxUploadBytes {
		return nil, fmt.Errorf("image is larger than %d MB", MaxUploadBytes>>20)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, ErrBadImage
	}
	if cfg.Width*cfg.Height > maxPixels { // decompression-bomb guard before allocating
		return nil, errors.New("image dimensions are too large")
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, ErrBadImage
	}
	return src, nil
}

func scale(src image.Image, squareSide, maxEdge int) *image.RGBA {
	b := src.Bounds()
	if squareSide > 0 {
		side := min(b.Dx(), b.Dy())
		crop := image.Rect(0, 0, side, side).Add(image.Pt(b.Min.X+(b.Dx()-side)/2, b.Min.Y+(b.Dy()-side)/2))
		out := min(squareSide, side)
		dst := image.NewRGBA(image.Rect(0, 0, out, out))
		draw.CatmullRom.Scale(dst, dst.Bounds(), src, crop, draw.Src, nil)
		return dst
	}
	w, h := b.Dx(), b.Dy()
	if long := max(w, h); long > maxEdge {
		w, h = w*maxEdge/long, h*maxEdge/long
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	return dst
}

func encode(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (st *Store) Put(ctx context.Context, key, contentType string, data []byte) error {
	_, err := st.s3.PutObject(ctx, st.bucket, key, bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{ContentType: contentType, CacheControl: "public, max-age=31536000, immutable"})
	return err
}

func (st *Store) PutJPEG(ctx context.Context, key string, data []byte) error {
	return st.Put(ctx, key, "image/jpeg", data)
}

func (st *Store) Remove(ctx context.Context, key string) {
	if err := st.s3.RemoveObject(ctx, st.bucket, key, minio.RemoveObjectOptions{}); err != nil {
		log.Printf("remove %s: %v", key, err) // orphaned object costs storage, not correctness
	}
}

// ServeHTTP (GET /media/{key...}) streams an object in dev (or when no CDN is configured).
// Keys are random and never reused, so responses are cacheable forever.
func (st *Store) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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
	log.Printf("serve media %s: %v", key, err)
	http.Error(w, "internal error", http.StatusInternalServerError)
}
