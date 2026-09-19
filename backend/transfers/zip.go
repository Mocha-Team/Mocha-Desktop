package transfers

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"mocha-desktop/backend/api"
)

type ZipFile struct {
	FileID string `json:"id"`
	Name   string `json:"name"`
}

func zipEntryName(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	name = strings.TrimSpace(path.Base(name))
	if name == "" || name == "." || name == "/" {
		return "file"
	}
	return name
}

func uniqueZipEntryName(used map[string]int, name string) string {
	key := strings.ToLower(name)
	n := used[key]
	used[key] = n + 1
	if n == 0 {
		return name
	}
	ext := path.Ext(name)
	return fmt.Sprintf("%s (%d)%s", strings.TrimSuffix(name, ext), n, ext)
}

func ZipFiles(ctx context.Context, client *api.Client, files []ZipFile, w io.Writer, jobID string, emit Emitter) error {
	zw := zip.NewWriter(w)
	used := map[string]int{}
	for _, f := range files {
		if err := ctx.Err(); err != nil {
			return err
		}
		name := uniqueZipEntryName(used, zipEntryName(f.Name))
		if err := zipFileInto(ctx, client, f.FileID, name, zw, jobID, emit); err != nil {
			return err
		}
	}
	return zw.Close()
}

func zipFileInto(ctx context.Context, client *api.Client, fileID, name string, zw *zip.Writer, jobID string, emit Emitter) error {
	directURL, err := client.PresignedDownload(fileID, "attachment")
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, directURL, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download status %d", resp.StatusCode)
	}
	fw, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate})
	if err != nil {
		return err
	}
	total := resp.ContentLength
	emit("download:progress", Progress{JobID: jobID, FileName: name, Total: total, Status: "downloading"})
	buf := make([]byte, 256*1024)
	var loaded int64
	start := time.Now()
	lastEmit := start
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := fw.Write(buf[:n]); werr != nil {
				return werr
			}
			loaded += int64(n)
			if time.Since(lastEmit) > 250*time.Millisecond {
				lastEmit = time.Now()
				var pct, speed float64
				if total > 0 {
					pct = float64(loaded) / float64(total) * 100
				}
				if el := time.Since(start).Seconds(); el > 0 {
					speed = float64(loaded) / el
				}
				emit("download:progress", Progress{JobID: jobID, FileName: name, Loaded: loaded, Total: total, Percent: pct, SpeedBps: speed, Status: "downloading"})
			}
		}
		if rerr != nil {
			if rerr == io.EOF {
				break
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return rerr
		}
	}
	return nil
}
