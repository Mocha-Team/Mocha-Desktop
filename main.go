package main

import (
	"embed"
	"runtime"

	"mocha-desktop/backend/startup"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

var version = "dev"

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:         "Mocha",
		Width:         1120,
		Height:        720,
		MinWidth:      960,
		MinHeight:     640,
		DisableResize: true,
		Frameless:     runtime.GOOS != "darwin",
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour:  &options.RGBA{R: 12, G: 10, B: 9, A: 1},
		HideWindowOnClose: true,
		StartHidden:       startup.StartedHidden(),
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "mocha-desktop",
			OnSecondInstanceLaunch: func(secondInstanceData options.SecondInstanceData) {
				app.ShowMain()
			},
		},
		Mac: &mac.Options{
			TitleBar:   mac.TitleBarDefault(),
			Appearance: mac.NSAppearanceNameDarkAqua,
			About: &mac.AboutInfo{
				Title:   "Mocha Desktop",
				Message: "Mocha file hosting for desktop.",
				Icon:    trayIconPNG,
			},
		},
		Linux: &linux.Options{
			Icon:        trayIconPNG,
			ProgramName: "mocha-desktop",
		},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
