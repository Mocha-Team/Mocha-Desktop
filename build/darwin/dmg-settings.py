# dmgbuild settings for the Mocha macOS installer.
# Finder-independent: .DS_Store is synthesized, no AppleScript involved.
# Geometry reference: window is 660x400 pt, background PNG is 1320x800 (2x).
# Run via: bash build/darwin/package-dmg.sh [path/to/app.app]

APP = defines.get("app", "build/bin/Mocha.app")

filename = defines.get("out", "build/bin/Mocha.dmg")
volume_name = "Mocha"
format = "UDZO"
compression_level = 9

files = [APP]
symlinks = {"Applications": "/Applications"}
hide_extensions = ["Mocha.app"]

icon_locations = {
    "Mocha.app": (125, 200),
    "Applications": (535, 200),
}
background = "build/darwin/dmg-background.png"

show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
arrange_by = None
icon_size = 80
text_size = 12
window_rect = ((200, 120), (660, 400))
default_view = "icon-view"
