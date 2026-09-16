package main

import (
	"context"
	_ "embed"
	"os"
	goruntime "runtime"

	"fyne.io/systray"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	viewMain   = "main"
	viewFlyout = "flyout"
	viewHidden = "hidden"
)

const (
	mainWidth, mainHeight                 = 1120, 720
	flyoutWidth, flyoutHeight             = 380, 540
	flyoutMarginRight, flyoutMarginBottom = 16, 64
)

//go:embed build/windows/icon.ico
var trayIconICO []byte

//go:embed build/appicon.png
var trayIconPNG []byte

func trayIcon() []byte {
	if goruntime.GOOS == "windows" {
		return trayIconICO
	}
	return trayIconPNG
}

func (a *App) startTray() {
	systray.Run(a.onTrayReady, a.onTrayExit)
}

func (a *App) onTrayReady() {
	systray.SetIcon(trayIcon())
	systray.SetTooltip("Mocha Desktop")
	systray.SetOnTapped(a.onTrayTapped)
	mShow := systray.AddMenuItem("Show", "Show Mocha Desktop")
	mPause := systray.AddMenuItem("Pause sync", "Pause or resume all watched folders")
	mRescan := systray.AddMenuItem("Rescan", "Rescan all watched folders")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("Quit", "Quit Mocha Desktop")
	go func() {
		for {
			select {
			case <-mShow.ClickedCh:
				a.ShowMain()
			case <-mPause.ClickedCh:
				_ = a.TogglePauseAll()
			case <-mRescan.ClickedCh:
				_ = a.RescanSync()
			case <-mQuit.ClickedCh:
				systray.Quit()
				if a.ctx != nil {
					runtime.Quit(a.ctx)
				}
				return
			}
		}
	}()
}

func (a *App) onTrayExit() {
}

func (a *App) shutdown(ctx context.Context) {
	systray.Quit()
}

func (a *App) onTrayTapped() {
	a.viewMu.Lock()
	defer a.viewMu.Unlock()
	if a.ctx == nil {
		return
	}
	if a.view == viewMain {
		runtime.WindowShow(a.ctx)
		return
	}
	a.applyFlyoutLocked()
}

func (a *App) ShowMain() {
	a.viewMu.Lock()
	defer a.viewMu.Unlock()
	if a.ctx == nil {
		return
	}
	runtime.WindowSetMinSize(a.ctx, 960, 640)
	runtime.WindowSetMaxSize(a.ctx, 0, 0)
	runtime.WindowSetSize(a.ctx, mainWidth, mainHeight)
	runtime.WindowSetAlwaysOnTop(a.ctx, false)
	runtime.WindowCenter(a.ctx)
	runtime.WindowShow(a.ctx)
	runtime.WindowUnminimise(a.ctx)
	a.view = viewMain
	a.emit("tray:full", nil)
}

func (a *App) CloseWindow() {
	a.viewMu.Lock()
	defer a.viewMu.Unlock()
	if a.ctx == nil {
		return
	}
	runtime.WindowHide(a.ctx)
	a.view = viewHidden
}

func (a *App) applyFlyoutLocked() {
	runtime.WindowSetMinSize(a.ctx, flyoutWidth, flyoutHeight)
	runtime.WindowSetMaxSize(a.ctx, 0, 0)
	runtime.WindowSetSize(a.ctx, flyoutWidth, flyoutHeight)
	if goruntime.GOOS == "linux" {
		runtime.WindowSetAlwaysOnTop(a.ctx, false)
		if os.Getenv("WAYLAND_DISPLAY") != "" {
			runtime.WindowCenter(a.ctx)
		} else {
			x, y := a.flyoutPos()
			runtime.WindowSetPosition(a.ctx, x, y)
		}
	} else {
		x, y := a.flyoutPos()
		runtime.WindowSetPosition(a.ctx, x, y)
		runtime.WindowSetAlwaysOnTop(a.ctx, true)
	}
	runtime.WindowShow(a.ctx)
	a.view = viewFlyout
	a.emit("tray:flyout", nil)
}

func (a *App) flyoutPos() (int, int) {
	screens, err := runtime.ScreenGetAll(a.ctx)
	if err != nil || len(screens) == 0 {
		return 0, 0
	}
	picked := screens[0]
	for _, s := range screens {
		if s.IsCurrent {
			picked = s
			break
		}
		if s.IsPrimary {
			picked = s
		}
	}
	w, h := picked.Size.Width, picked.Size.Height
	if w <= 0 || h <= 0 {
		w, h = picked.Width, picked.Height
	}
	if w <= 0 || h <= 0 {
		return 0, 0
	}
	x := w - flyoutWidth - flyoutMarginRight
	y := h - flyoutHeight - flyoutMarginBottom
	if x < 0 {
		x = 0
	}
	if y < 0 {
		y = 0
	}
	return x, y
}
