package updater

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

func Download(client *http.Client, url, sha256hex, dest string, onProgress func(loaded, total int64)) error {
	url = strings.TrimSpace(url)
	sha256hex = strings.ToLower(strings.TrimSpace(sha256hex))
	dest = strings.TrimSpace(dest)
	if url == "" || sha256hex == "" || dest == "" {
		return fmt.Errorf("download url, checksum, and destination required")
	}
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("download %d", resp.StatusCode)
	}
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	failed := true
	defer func() {
		_ = out.Close()
		if failed {
			_ = os.Remove(dest)
		}
	}()
	hash := sha256.New()
	total := resp.ContentLength
	var loaded int64
	buf := make([]byte, 128*1024)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := out.Write(buf[:n]); werr != nil {
				return werr
			}
			if _, werr := hash.Write(buf[:n]); werr != nil {
				return werr
			}
			loaded += int64(n)
			if onProgress != nil {
				onProgress(loaded, total)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	if err := out.Close(); err != nil {
		return err
	}
	if got := hex.EncodeToString(hash.Sum(nil)); got != sha256hex {
		return fmt.Errorf("checksum mismatch")
	}
	failed = false
	return nil
}
