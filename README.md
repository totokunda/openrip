<h1 align="center">OpenRip</h1>
<p align="center">A fast, open-source desktop video editor.</p>

OpenRip is a timeline-based video editor for macOS, Windows and Linux. It's a fork of [Apex Studio](https://github.com/totokunda/apex-studio) with every AI and generative feature removed: no Python backend, no model downloads, no GPU inference. It's just a video editor.

> **Status:** early. The current app is Electron + TypeScript. A ground-up rewrite in Rust focused on speed is planned. See [ROADMAP.md](ROADMAP.md).

## Features

- Multi-track timeline: video, image, audio, text, shape, drawing, filter and group clips
- Trim, split, merge, group, copy/paste, snapping, and per-track mute/hide
- Transform, crop, opacity and corner radius on visual clips
- Color correction and effects: brightness, contrast, exposure, hue/saturation, blur, sharpness, noise, vignette
- LUT filters (Hald CLUT)
- Text with fonts, stroke, shadow and background
- Manual lasso and shape masks with feathering, inversion and keyframes
- Audio volume, fades, speed, and detaching audio from video
- Local media library with optional proxy files for smooth playback
- Export with FFmpeg
- Projects saved as plain JSON with autosave

## Building from source

See [BUILDING.md](BUILDING.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
