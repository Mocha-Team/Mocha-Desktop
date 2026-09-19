package transfers

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"mocha-desktop/backend/api"
)

var ErrTransferCancelled = fmt.Errorf("transfer cancelled")

func sleepCtx(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		return ctx.Err() == nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

type Progress struct {
	JobID    string  `json:"jobId"`
	FileName string  `json:"fileName"`
	Loaded   int64   `json:"loaded"`
	Total    int64   `json:"total"`
	Percent  float64 `json:"percent"`
	SpeedBps float64 `json:"speedBps"`
	Status   string  `json:"status"`
	Error    string  `json:"error,omitempty"`
}

type Emitter func(event string, payload any)

const DefaultFileConcurrency = 3
const SmallFileConcurrency = 8
const SmallFileThreshold = 50 * 1024 * 1024

var jobCounter atomic.Uint64

func NewJobID(prefix string) string {
	return prefix + fmt.Sprintf("%d-%d", time.Now().UnixNano(), jobCounter.Add(1))
}

type BatchFile struct {
	LocalPath  string
	RemotePath string
	JobID      string
}

type BatchResult struct {
	JobID     string
	LocalPath string
	FileID    string
	Err       error
}

type progressReader struct {
	sr     *io.SectionReader
	loaded *atomic.Int64
	sent   *int64
	emit   func()
}

func (r *progressReader) Read(p []byte) (int, error) {
	n, err := r.sr.Read(p)
	if n > 0 {
		r.loaded.Add(int64(n))
		*r.sent += int64(n)
		r.emit()
	}
	return n, err
}

func UploadFileWithID(ctx context.Context, client *api.Client, localPath, remotePath, jobID string, emit Emitter) (string, error) {
	info, err := os.Stat(localPath)
	if err != nil {
		return "", err
	}
	size := info.Size()
	name := filepath.Base(localPath)
	mimeType := mime.TypeByExtension(filepath.Ext(name))
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	emit("upload:progress", Progress{JobID: jobID, FileName: name, Total: size, Status: "init"})

	var init api.MultipartInit
	var initErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(backoff(attempt - 1)):
			}
			emit("upload:progress", Progress{JobID: jobID, FileName: name, Total: size, Status: "init"})
		}
		init, initErr = client.InitMultipartCtx(ctx, name, size, mimeType, remotePath)
		if initErr == nil {
			break
		}
		if ctx.Err() != nil {
			break
		}
		if !isTransientInitError(initErr) {
			break
		}
	}
	if initErr != nil {
		if ctx.Err() != nil {
			emit("upload:progress", Progress{JobID: jobID, FileName: name, Total: size, Status: "cancelled", Error: ctx.Err().Error()})
			return "", ctx.Err()
		}
		emit("upload:progress", Progress{JobID: jobID, FileName: name, Total: size, Status: "error", Error: initErr.Error()})
		return "", initErr
	}
	originalName := init.OriginalName
	if originalName == "" {
		originalName = name
	}
	chunk := init.PartSizeBytes
	if init.DirectPartUpload && init.DirectPartSizeBytes != nil && *init.DirectPartSizeBytes > 0 {
		chunk = *init.DirectPartSizeBytes
	}
	if chunk <= 0 {
		chunk = 50 * 1024 * 1024
	}
	numParts := int((size + chunk - 1) / chunk)
	if numParts < 1 {
		numParts = 1
	}
	concurrency := init.PartUploadConcurrency
	if concurrency < 1 {
		concurrency = 4
	}
	if concurrency > 8 {
		concurrency = 8
	}

	type result struct {
		Num  int
		ETag string
		Err  error
	}
	sem := make(chan struct{}, concurrency)
	results := make([]result, numParts)
	var mu sync.Mutex
	var loaded atomic.Int64
	var lastEmit atomic.Int64
	var failed error
	var wg sync.WaitGroup
	start := time.Now()
	lastEmit.Store(time.Now().Add(-time.Second).UnixNano())
	emitUploading := func() {
		l := loaded.Load()
		if l > size {
			l = size
		}
		elapsed := time.Since(start).Seconds()
		var speed float64
		if elapsed > 0 {
			speed = float64(l) / elapsed
		}
		var pct float64
		if size > 0 {
			pct = float64(l) / float64(size) * 100
			if pct > 100 {
				pct = 100
			}
		} else {
			pct = 100
		}
		emit("upload:progress", Progress{JobID: jobID, FileName: name, Loaded: l, Total: size, Percent: pct, SpeedBps: speed, Status: "uploading"})
	}
	maybeEmit := func() {
		now := time.Now().UnixNano()
		if now-lastEmit.Load() < 200*int64(time.Millisecond) {
			return
		}
		lastEmit.Store(now)
		emitUploading()
	}

	putPart := func(partNum int, offset, length int64) {
		defer wg.Done()
		sem <- struct{}{}
		defer func() { <-sem }()
		mu.Lock()
		alreadyFailed := failed != nil
		mu.Unlock()
		if alreadyFailed || ctx.Err() != nil {
			return
		}
		var etag string
		var lastErr error
		for attempt := 0; attempt < 6; attempt++ {
			select {
			case <-ctx.Done():
				return
			default:
			}
			urls, err := client.PresignedPartUrlsCtx(ctx, init.UploadID, init.Key, init.NodeID, originalName, remotePath, []int{partNum})
			if err != nil || len(urls) == 0 {
				lastErr = err
				if lastErr == nil {
					lastErr = fmt.Errorf("no presigned url")
				}
				if ctx.Err() != nil {
					return
				}
				if !sleepCtx(ctx, backoff(attempt)) {
					return
				}
				continue
			}
			lastErr = nil
			etag, lastErr = putPartAttempt(ctx, urls[0].URL, localPath, offset, length, partNum, &loaded, maybeEmit)
			if lastErr == nil {
				break
			}
			if ctx.Err() != nil {
				return
			}
			if !sleepCtx(ctx, backoff(attempt)) {
				return
			}
		}
		mu.Lock()
		defer mu.Unlock()
		if lastErr != nil {
			if failed == nil {
				failed = lastErr
			}
			return
		}
		results[partNum-1] = result{Num: partNum, ETag: etag}
		emitUploading()
	}

	for i := 0; i < numParts; i++ {
		off := int64(i) * chunk
		ln := chunk
		if off+ln > size {
			ln = size - off
		}
		wg.Add(1)
		go putPart(i+1, off, ln)
	}
	wg.Wait()
	if size == 0 {
		loaded.Store(0)
	}
	loadedFinal := loaded.Load()
	if ctx.Err() != nil {
		client.AbortMultipartCtx(ctx, init.UploadID, init.Key, init.NodeID, originalName, remotePath)
		emit("upload:progress", Progress{JobID: jobID, FileName: name, Loaded: loadedFinal, Total: size, Status: "cancelled", Error: ctx.Err().Error()})
		return "", ctx.Err()
	}
	if failed != nil {
		client.AbortMultipartCtx(context.Background(), init.UploadID, init.Key, init.NodeID, originalName, remotePath)
		emit("upload:progress", Progress{JobID: jobID, FileName: name, Loaded: loadedFinal, Total: size, Status: "error", Error: failed.Error()})
		return "", failed
	}
	slices.SortFunc(results, func(a, b result) int { return a.Num - b.Num })
	parts := make([]map[string]any, 0, numParts)
	for _, r := range results {
		parts = append(parts, map[string]any{"partNumber": r.Num, "etag": r.ETag})
	}
	var md5hex string
	if size <= 200*1024*1024 {
		if h, err := fileMD5(localPath); err == nil {
			md5hex = h
		}
	}
	fileID, err := client.CompleteMultipartCtx(ctx, init.UploadID, init.Key, init.NodeID, originalName, remotePath, mimeType, size, parts, md5hex)
	if err != nil {
		emit("upload:progress", Progress{JobID: jobID, FileName: name, Total: size, Status: "error", Error: err.Error()})
		return "", err
	}
	var doneSpeed float64
	if elapsed := time.Since(start).Seconds(); elapsed > 0 && size > 0 {
		doneSpeed = float64(size) / elapsed
	}
	emit("upload:progress", Progress{JobID: jobID, FileName: name, Loaded: size, Total: size, Percent: 100, SpeedBps: doneSpeed, Status: "done"})
	return fileID, nil
}

var ErrDestExists = fmt.Errorf("destination already exists")

func syncParentDir(p string) {
	if d, err := os.Open(filepath.Dir(p)); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
}

func DownloadFileWithID(ctx context.Context, client *api.Client, fileID, destPath, disposition, jobID string, emit Emitter) error {
	if jobID == "" {
		jobID = fileID
	}
	directURL, err := client.PresignedDownload(fileID, disposition)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return err
	}
	var keepMode os.FileMode
	if st, err := os.Stat(destPath); err == nil && !st.IsDir() {
		keepMode = st.Mode().Perm()
	}
	partPath := destPath + ".mocha-part"
	var have int64
	if st, err := os.Stat(partPath); err == nil {
		have = st.Size()
	}
	name := filepath.Base(destPath)
	emit("download:progress", Progress{JobID: jobID, FileName: name, Loaded: have, Status: "init"})
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, directURL, nil)
	if err != nil {
		return err
	}
	if have > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", have))
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusRequestedRangeNotSatisfiable {
		_ = os.Rename(partPath, destPath)
		syncParentDir(destPath)
		emit("download:progress", Progress{JobID: jobID, FileName: name, Loaded: have, Total: have, Percent: 100, Status: "done"})
		return nil
	}
	resumed := resp.StatusCode == http.StatusPartialContent
	if resp.StatusCode != http.StatusOK && !resumed {
		emit("download:progress", Progress{JobID: jobID, FileName: name, Status: "error", Error: fmt.Sprintf("download status %d", resp.StatusCode)})
		return fmt.Errorf("download status %d", resp.StatusCode)
	}
	if !resumed {
		have = 0
	}
	total := resp.ContentLength
	if resumed {
		if cr := resp.Header.Get("Content-Range"); cr != "" {
			if i := strings.LastIndex(cr, "/"); i >= 0 {
				if n, perr := strconv.ParseInt(strings.TrimSpace(cr[i+1:]), 10, 64); perr == nil && n > 0 {
					total = n
				}
			}
		} else if total >= 0 {
			total += have
		}
	}
	var out *os.File
	if resumed {
		out, err = os.OpenFile(partPath, os.O_WRONLY|os.O_CREATE, 0o644)
		if err != nil {
			return err
		}
		if _, err := out.Seek(have, io.SeekStart); err != nil {
			out.Close()
			return err
		}
	} else {
		out, err = os.OpenFile(partPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
		if err != nil {
			return err
		}
	}
	buf := make([]byte, 256*1024)
	loaded := have
	start := time.Now()
	lastEmit := time.Now()
	emitProgress := func(status string) {
		var pct float64
		if total > 0 {
			pct = float64(loaded) / float64(total) * 100
		}
		var speed float64
		if el := time.Since(start).Seconds(); el > 0 {
			speed = float64(loaded-have) / el
		}
		emit("download:progress", Progress{JobID: jobID, FileName: name, Loaded: loaded, Total: total, Percent: pct, SpeedBps: speed, Status: status})
	}
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := out.Write(buf[:n]); werr != nil {
				out.Close()
				return werr
			}
			loaded += int64(n)
			if time.Since(lastEmit) > 250*time.Millisecond {
				lastEmit = time.Now()
				emitProgress("downloading")
			}
		}
		if rerr != nil {
			if rerr == io.EOF {
				break
			}
			out.Close()
			if ctx.Err() != nil {
				emit("download:progress", Progress{JobID: jobID, FileName: name, Loaded: loaded, Total: total, Status: "cancelled", Error: ctx.Err().Error()})
				return ctx.Err()
			}
			emit("download:progress", Progress{JobID: jobID, FileName: name, Loaded: loaded, Total: total, Status: "error", Error: rerr.Error()})
			return rerr
		}
	}
	_ = out.Sync()
	out.Close()
	if err := os.Rename(partPath, destPath); err != nil {
		emit("download:progress", Progress{JobID: jobID, FileName: name, Loaded: loaded, Total: total, Status: "error", Error: err.Error()})
		return err
	}
	if keepMode != 0 {
		_ = os.Chmod(destPath, keepMode)
	}
	syncParentDir(destPath)
	emit("download:progress", Progress{JobID: jobID, FileName: name, Loaded: total, Total: total, Percent: 100, Status: "done"})
	return nil
}

func putPartAttempt(ctx context.Context, url, localPath string, offset, length int64, partNum int, loaded *atomic.Int64, emit func()) (string, error) {
	attemptCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	f, err := os.Open(localPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	var sent int64
	sr := io.NewSectionReader(f, offset, length)
	req, err := http.NewRequestWithContext(attemptCtx, http.MethodPut, url, &progressReader{sr: sr, loaded: loaded, sent: &sent, emit: emit})
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.ContentLength = length
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		loaded.Add(-sent)
		return "", err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		loaded.Add(-sent)
		return "", fmt.Errorf("part %d status %d", partNum, resp.StatusCode)
	}
	etag := resp.Header.Get("ETag")
	if len(etag) >= 2 && etag[0] == '"' {
		etag = etag[1 : len(etag)-1]
	}
	return etag, nil
}

func backoff(attempt int) time.Duration {
	d := time.Duration(1<<attempt) * time.Second
	if d > 8*time.Second {
		d = 8 * time.Second
	}
	return d
}

func isTransientInitError(err error) bool {
	if err == nil {
		return false
	}
	var apiErr *api.APIError
	if errors.As(err, &apiErr) {
		return apiErr.Status == 429 || apiErr.Status >= 500
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return false
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	return errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)
}

func fileMD5(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := md5.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
