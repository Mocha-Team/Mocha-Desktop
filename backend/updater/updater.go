package updater

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

type Asset struct {
	OS     string `json:"os"`
	Arch   string `json:"arch"`
	Name   string `json:"name"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
}

type Manifest struct {
	Version string  `json:"version"`
	Notes   string  `json:"notes"`
	Assets  []Asset `json:"assets"`
}

type CheckResult struct {
	Available bool   `json:"available"`
	Version   string `json:"version"`
	Notes     string `json:"notes"`
	Asset     Asset  `json:"asset"`
}

func stripV(v string) string {
	return strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(v), "v"))
}

func parseStable(v string) ([]int, bool) {
	v = stripV(v)
	if v == "" || v == "dev" {
		return nil, false
	}
	if i := strings.Index(v, "-"); i != -1 {
		return nil, false
	}
	parts := strings.Split(v, ".")
	nums := make([]int, 0, len(parts))
	for _, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return nil, false
		}
		nums = append(nums, n)
	}
	if len(nums) == 0 {
		return nil, false
	}
	return nums, true
}

func UpdateAvailable(current, latest string) bool {
	cur, ok := parseStable(current)
	if !ok {
		return false
	}
	lat, ok := parseStable(latest)
	if !ok {
		return false
	}
	max := len(cur)
	if len(lat) > max {
		max = len(lat)
	}
	for i := 0; i < max; i++ {
		c := 0
		l := 0
		if i < len(cur) {
			c = cur[i]
		}
		if i < len(lat) {
			l = lat[i]
		}
		if l != c {
			return l > c
		}
	}
	return false
}

var errNoAsset = errors.New("no update")

func MatchAsset(m Manifest, goos, goarch string) (Asset, error) {
	for _, a := range m.Assets {
		if strings.EqualFold(a.OS, goos) && strings.EqualFold(a.Arch, goarch) {
			if strings.TrimSpace(a.URL) == "" || strings.TrimSpace(a.SHA256) == "" {
				return Asset{}, fmt.Errorf("update asset incomplete")
			}
			return a, nil
		}
	}
	return Asset{}, fmt.Errorf("%w for %s/%s", errNoAsset, goos, goarch)
}

func Check(client *http.Client, manifestURL, current, goos, goarch string) (CheckResult, error) {
	manifestURL = strings.TrimSpace(manifestURL)
	if manifestURL == "" {
		return CheckResult{}, fmt.Errorf("manifest url required")
	}
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Get(manifestURL)
	if err != nil {
		return CheckResult{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return CheckResult{}, fmt.Errorf("update check %d", resp.StatusCode)
	}
	var m Manifest
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		return CheckResult{}, err
	}
	if !UpdateAvailable(current, m.Version) {
		return CheckResult{}, nil
	}
	asset, err := MatchAsset(m, goos, goarch)
	if err != nil {
		if errors.Is(err, errNoAsset) {
			return CheckResult{Available: false, Version: stripV(m.Version), Notes: m.Notes}, nil
		}
		return CheckResult{}, err
	}
	return CheckResult{Available: true, Version: stripV(m.Version), Notes: m.Notes, Asset: asset}, nil
}
