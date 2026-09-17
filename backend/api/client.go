package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	BaseURL string
	APIKey  string
	HTTP    *http.Client
}

type APIError struct {
	Status int
}

func (e *APIError) Error() string {
	return fmt.Sprintf("api %d", e.Status)
}

func New(baseURL, apiKey string) *Client {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	return &Client{
		BaseURL: baseURL,
		APIKey:  strings.TrimSpace(apiKey),
		HTTP:    &http.Client{Timeout: 60 * time.Second},
	}
}

type FileItem struct {
	ID           string `json:"id"`
	OriginalName string `json:"original_name"`
	FileName     string `json:"file_name"`
	Size         int64  `json:"size"`
	MimeType     string `json:"mime_type"`
	Path         string `json:"path"`
	CreatedAt    string `json:"created_at"`
}

type ListResponse struct {
	Files       []FileItem       `json:"files"`
	Folders     []string         `json:"folders"`
	FolderSizes map[string]int64 `json:"folderSizes"`
	NextCursor  *string          `json:"nextCursor"`
	HasMore     bool             `json:"hasMore"`
	Path        string           `json:"path"`
}

type Me struct {
	ID                string `json:"id"`
	Email             string `json:"email"`
	Name              string `json:"name"`
	Role              string `json:"role"`
	CanUseApi         bool   `json:"canUseApi"`
	CanCreateHotlinks bool   `json:"canCreateHotlinks"`
}

type ProfileSummary struct {
	Me
	UsedBytes        int64   `json:"usedBytes"`
	MaxStorageBytes  int64   `json:"maxStorageBytes"`
	MaxFileSizeBytes int64   `json:"maxFileSizeBytes"`
	StoragePercent   float64 `json:"storagePercent"`
	UploadsCount     int64   `json:"uploadsCount"`
	SharesCount      int64   `json:"sharesCount"`
}

type StorageAvailable struct {
	UsedBytes       int64   `json:"usedBytes"`
	AvailableBytes  int64   `json:"availableBytes"`
	MaxStorageBytes int64   `json:"maxStorageBytes"`
	StoragePercent  float64 `json:"storagePercent"`
}

type Share struct {
	Token           string  `json:"token"`
	FileID          *string `json:"file_id"`
	OriginalName    *string `json:"original_name"`
	FolderPath      *string `json:"folder_path"`
	FolderName      *string `json:"folder_name"`
	IsActive        bool    `json:"is_active"`
	ExpiresAt       *string `json:"expires_at"`
	MaxDownloads    *int    `json:"max_downloads"`
	DownloadCount   int     `json:"download_count"`
	HasPassword     bool    `json:"password_protected"`
	IsPermanentLink bool    `json:"is_permanent_link"`
	CreatedAt       string  `json:"created_at"`
}

type MultipartInit struct {
	UploadID              string `json:"uploadId"`
	Key                   string `json:"key"`
	NodeID                string `json:"nodeId"`
	OriginalName          string `json:"originalName"`
	PartSizeBytes         int64  `json:"partSizeBytes"`
	DirectPartSizeBytes   *int64 `json:"directPartSizeBytes"`
	PartUploadConcurrency int    `json:"partUploadConcurrency"`
	DirectPartUpload      bool   `json:"directPartUpload"`
}

type PartURL struct {
	PartNumber int    `json:"partNumber"`
	URL        string `json:"url"`
}

func (c *Client) req(method, p string, query map[string]string, body any) (*http.Response, error) {
	return c.reqCtx(context.Background(), method, p, query, body)
}

func (c *Client) reqCtx(ctx context.Context, method, p string, query map[string]string, body any) (*http.Response, error) {
	if c.BaseURL == "" {
		return nil, fmt.Errorf("server URL not configured")
	}
	if c.APIKey == "" {
		return nil, fmt.Errorf("missing API key")
	}
	u, err := url.Parse(c.BaseURL + p)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	for k, v := range query {
		q.Set(k, v)
	}
	u.RawQuery = q.Encode()
	var r io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		r = bytes.NewReader(raw)
	}
	httpReq, err := http.NewRequestWithContext(ctx, method, u.String(), r)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.APIKey)
	httpReq.Header.Set("Accept", "application/json")
	if body != nil {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		defer resp.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		msg := parseError(raw, resp.Header.Get("Content-Type"))
		return nil, fmt.Errorf("%s: %w", msg, &APIError{Status: resp.StatusCode})
	}
	return resp, nil
}

func decode(resp *http.Response, out any) error {
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if len(raw) == 0 {
		return nil
	}
	return json.Unmarshal(raw, out)
}

func parseError(raw []byte, ct string) string {
	s := strings.TrimSpace(string(raw))
	if s == "" {
		return "request failed"
	}
	if strings.Contains(ct, "json") || strings.HasPrefix(s, "{") {
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err == nil {
			for _, k := range []string{"error", "message"} {
				if v, ok := m[k].(string); ok && v != "" {
					return v
				}
			}
		}
	}
	if len(s) > 300 {
		return s[:300]
	}
	return s
}

func (c *Client) GetMe() (Me, error) {
	var out Me
	resp, err := c.req(http.MethodGet, "/auth/me", nil, nil)
	if err != nil {
		return out, err
	}
	return out, decode(resp, &out)
}

func (c *Client) GetProfile() (ProfileSummary, error) {
	var out ProfileSummary
	resp, err := c.req(http.MethodGet, "/profile/summary", nil, nil)
	if err != nil {
		return out, err
	}
	return out, decode(resp, &out)
}

func (c *Client) GetStorage() (StorageAvailable, error) {
	var out StorageAvailable
	resp, err := c.req(http.MethodGet, "/storage/available", nil, nil)
	if err != nil {
		return out, err
	}
	return out, decode(resp, &out)
}

func (c *Client) ListFiles(path string, limit int, cursor string, query string) (ListResponse, error) {
	var out ListResponse
	q := map[string]string{"path": path}
	if limit > 0 {
		q["limit"] = fmt.Sprintf("%d", limit)
	}
	if cursor != "" {
		q["cursor"] = cursor
	}
	if query != "" {
		q["q"] = query
	}
	resp, err := c.req(http.MethodGet, "/files", q, nil)
	if err != nil {
		return out, err
	}
	return out, decode(resp, &out)
}

func (c *Client) DeleteFile(idOrName string) error {
	resp, err := c.req(http.MethodDelete, "/files/"+url.PathEscape(idOrName), nil, nil)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func (c *Client) CreateFolder(path, name string) error {
	resp, err := c.req(http.MethodPost, "/files/folders", nil, map[string]any{"path": path, "name": name})
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func (c *Client) RenameFolder(path, oldName, newName string) error {
	resp, err := c.req(http.MethodPatch, "/files/folders", nil, map[string]any{"path": path, "oldName": oldName, "newName": newName})
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func (c *Client) RenameFile(idOrName, newName string) error {
	resp, err := c.req(http.MethodPatch, "/files/"+url.PathEscape(idOrName), nil, map[string]any{"originalName": newName})
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func (c *Client) MoveFile(fileID, toPath string) error {
	resp, err := c.req(http.MethodPost, "/files/move", nil, map[string]any{"fileId": fileID, "toPath": toPath})
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func (c *Client) MoveFolder(folderPath, toPath string) error {
	resp, err := c.req(http.MethodPost, "/files/move", nil, map[string]any{"folderPath": folderPath, "toPath": toPath})
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

type TrashItem struct {
	ID           string `json:"id"`
	OriginalName string `json:"original_name"`
	FileName     string `json:"file_name"`
	Size         int64  `json:"size"`
	Path         string `json:"path"`
	DeletedAt    string `json:"deleted_at"`
}

func (c *Client) GetTrash() ([]TrashItem, error) {
	var wrapper struct {
		Files []TrashItem `json:"files"`
	}
	resp, err := c.req(http.MethodGet, "/trash", nil, nil)
	if err != nil {
		return nil, err
	}
	if err := decode(resp, &wrapper); err != nil {
		return nil, err
	}
	if wrapper.Files == nil {
		return []TrashItem{}, nil
	}
	return wrapper.Files, nil
}

func (c *Client) DeleteTrash(id string, all bool) error {
	q := map[string]string{}
	if all {
		q["all"] = "true"
	} else {
		q["id"] = id
	}
	resp, err := c.req(http.MethodDelete, "/trash", q, nil)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func (c *Client) BulkDownloadStream(fileIDs, folderPaths []string, w io.Writer) error {
	body := map[string]any{"mode": "zip"}
	if fileIDs != nil {
		body["fileIds"] = fileIDs
	}
	if folderPaths != nil {
		body["folderPaths"] = folderPaths
	}
	resp, err := c.req(http.MethodPost, "/files/bulk-download", nil, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, err = io.Copy(w, resp.Body)
	return err
}

type ArchiveEntry struct {
	Path           string `json:"path"`
	FileName       string `json:"fileName"`
	FileSize       int64  `json:"fileSize"`
	CompressedSize int64  `json:"compressedSize"`
	IsDirectory    bool   `json:"isDirectory"`
}

func (c *Client) ListArchive(fileID string) ([]ArchiveEntry, error) {
	var out struct {
		Entries []ArchiveEntry `json:"entries"`
	}
	resp, err := c.req(http.MethodGet, "/files/"+url.PathEscape(fileID)+"/archive", nil, nil)
	if err != nil {
		return nil, err
	}
	if err := decode(resp, &out); err != nil {
		return nil, err
	}
	if out.Entries == nil {
		return []ArchiveEntry{}, nil
	}
	return out.Entries, nil
}

func (c *Client) ExtractArchiveStream(fileID, entryPath string, w io.Writer) error {
	resp, err := c.req(http.MethodGet, "/files/"+url.PathEscape(fileID)+"/archive/download", map[string]string{"path": entryPath}, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, err = io.Copy(w, resp.Body)
	return err
}

func (c *Client) InitMultipartCtx(ctx context.Context, name string, size int64, mimeType, path string) (MultipartInit, error) {
	var out MultipartInit
	resp, err := c.reqCtx(ctx, http.MethodPost, "/files/multipart/init", nil, map[string]any{
		"originalName": name,
		"size":         size,
		"mimeType":     mimeType,
		"path":         path,
	})
	if err != nil {
		return out, err
	}
	return out, decode(resp, &out)
}

func (c *Client) PresignedPartUrlsCtx(ctx context.Context, uploadID, key, nodeID, originalName, path string, numbers []int) ([]PartURL, error) {
	var wrapper struct {
		Urls []PartURL `json:"urls"`
	}
	resp, err := c.reqCtx(ctx, http.MethodPost, "/files/multipart/presigned", nil, map[string]any{
		"uploadId":     uploadID,
		"key":          key,
		"nodeId":       nodeID,
		"originalName": originalName,
		"path":         path,
		"partNumbers":  numbers,
	})
	if err != nil {
		return nil, err
	}
	return wrapper.Urls, decode(resp, &wrapper)
}

func (c *Client) CompleteMultipartCtx(ctx context.Context, uploadID, key, nodeID, originalName, path, mimeType string, size int64, parts []map[string]any, md5 string) (string, error) {
	body := map[string]any{
		"uploadId":     uploadID,
		"key":          key,
		"nodeId":       nodeID,
		"originalName": originalName,
		"path":         path,
		"mimeType":     mimeType,
		"size":         size,
		"parts":        parts,
	}
	if md5 != "" {
		body["md5"] = md5
	}
	resp, err := c.reqCtx(ctx, http.MethodPost, "/files/multipart/complete", nil, body)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	var wrapper struct {
		File struct {
			ID string `json:"id"`
		} `json:"file"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return "", fmt.Errorf("unexpected complete response")
	}
	return wrapper.File.ID, nil
}

func (c *Client) AbortMultipartCtx(ctx context.Context, uploadID, key, nodeID, originalName, path string) {
	resp, err := c.reqCtx(ctx, http.MethodPost, "/files/multipart/abort", nil, map[string]any{
		"uploadId":     uploadID,
		"key":          key,
		"nodeId":       nodeID,
		"originalName": originalName,
		"path":         path,
	})
	if err != nil {
		return
	}
	resp.Body.Close()
}

func (c *Client) PresignedDownload(fileID, disposition string) (string, error) {
	if disposition == "" {
		disposition = "attachment"
	}
	var out struct {
		URL       string `json:"url"`
		ExpiresIn int    `json:"expiresIn"`
	}
	resp, err := c.req(http.MethodGet, "/files/"+url.PathEscape(fileID)+"/presigned", map[string]string{"disposition": disposition}, nil)
	if err != nil {
		return "", err
	}
	if err := decode(resp, &out); err != nil {
		return "", err
	}
	if out.URL == "" {
		return "", fmt.Errorf("empty download url")
	}
	return out.URL, nil
}

func (c *Client) ListShares() ([]Share, error) {
	var wrapper struct {
		Shares []Share `json:"shares"`
	}
	resp, err := c.req(http.MethodGet, "/shares", nil, nil)
	if err != nil {
		return nil, err
	}
	if err := decode(resp, &wrapper); err != nil {
		return nil, err
	}
	if wrapper.Shares != nil {
		return wrapper.Shares, nil
	}
	return []Share{}, nil
}

func (c *Client) CreateShareFile(fileID string, expires *int, maxDownloads *int, password string) (Share, error) {
	var wrapper struct {
		Share Share `json:"share"`
	}
	body := map[string]any{"fileId": fileID}
	if expires != nil {
		body["expiresInHours"] = *expires
	} else {
		body["expiresInHours"] = nil
	}
	if maxDownloads != nil {
		body["maxDownloads"] = *maxDownloads
	}
	if password != "" {
		body["password"] = password
	}
	resp, err := c.req(http.MethodPost, "/shares", nil, body)
	if err != nil {
		return wrapper.Share, err
	}
	return wrapper.Share, decode(resp, &wrapper)
}

func (c *Client) DeleteShare(token string) error {
	resp, err := c.req(http.MethodDelete, "/shares/"+url.PathEscape(token), nil, nil)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

type SyncHeartbeatFolder struct {
	PairID     string `json:"pairId"`
	LocalPath  string `json:"localPath"`
	RemotePath string `json:"remotePath"`
	Direction  string `json:"direction"`
	Status     string `json:"status"`
	Files      int    `json:"files"`
	Pending    int    `json:"pending"`
	LastSync   int64  `json:"lastSync"`
}

func (c *Client) HeartbeatComputer(computerName, platform, appVersion string, folders []SyncHeartbeatFolder) error {
	if folders == nil {
		folders = []SyncHeartbeatFolder{}
	}
	resp, err := c.req(http.MethodPost, "/sync/computers/heartbeat", nil, map[string]any{
		"computerName": computerName,
		"platform":     platform,
		"appVersion":   appVersion,
		"folders":      folders,
	})
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}
