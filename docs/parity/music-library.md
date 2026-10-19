# Music and Sound effects libraries

The left Audio tab's Music and Sound effects, from openly licensed audio fetched on demand. No account, no key.

## Source

[Openverse](https://api.openverse.org/v1/audio/) gathers Creative Commons audio from Freesound, Jamendo, Wikimedia and others. OpenRip's main process (`MusicLibraryModule.ts`) asks it anonymously:

- Music: `category=music`, with the category's words as the query (Epic, Chill, Hip-Hop…). The results are mostly Jamendo.
- Sound effects: `source=freesound` with the kind as the query (Whoosh, Click, Applause…).
- Always `license=cc0,pdm,by` and `mature=false`; then `toTrack` checks each result again, so a stray licence in an answer is dropped.

Anonymous use is limited to 20 requests a minute and 200 a day. So requests go one at a time, at most 12 a minute, and stop on a 429 until its Retry-After; a category's results are kept 6 hours and a typed search 30 minutes (`<userData>/music-library/search/`); kept results older than that still answer when the network doesn't. Every request carries `User-Agent: OpenRip/0.1 (open-source video editor; +https://github.com/totokunda/openrip)`.

## Licences

| Licence | Listed | Why |
|---|---|---|
| CC0, Public Domain Mark | yes | Free to use in a video, no credit. Still listed in the credits, marked. |
| CC BY (any version) | yes | Free to use, commercially too, with a credit (title, author, licence, link). The credits view writes it. |
| CC BY-SA | no | Setting a track to pictures is an adaptation under Creative Commons' guidance; share-alike would then ask the whole video to be BY-SA. Not something to hand users quietly. |
| any NC | no | A video's use is often commercial, and a creator can't tell which. |
| any ND | no | Cutting, fading, mixing and putting it under pictures are changes. |

## Files, favourites and credits

- A track is downloaded when it's added (the arrow, "+", a star): `<userData>/music-library/files/<id>.<ext>` with its details beside it as `<id>.json`. Covers come from the source when it has one.
- Favourites are kept whole in `favorites.json` and downloaded, so a favourite plays and adds with no network.
- An added track's asset keeps `credit` (title, author, author URL, licence and version, licence URL, source URL, source) in the project. A drop from the list carries the same credit.
- Credits: the Export dialog's finished screen lists the project's library tracks and has the text to paste into a video's description (CC BY first, each as `"Title" by Author (link), CC BY 3.0 (licence link), source link`); the audio clip's inspector has a License section. The clip's bar is named after the track's title.

## Offline

An unseen category or search says "You're offline" (what still works: downloaded tracks and Favorites) with Try again; seen ones are listed from the kept results ("Showing saved results"); a rate-limited answer says so.

## Tests

`packages/renderer/tests/music-library.test.ts` (licence filter, request, hosts, pacing, credits text), harness steps `musiclib` (fixture server, `OPENRIP_OPENVERSE_BASE`) and `musicreal` (the real API).

## Not done

Waveforms on rows (Openverse's waveform is a request per track against the daily limit; rows show the cover or a note), the right-click menu on rows, dragging a track that isn't downloaded yet, Incompetech and ccMixter (no API with stable JSON; Openverse already lists Jamendo and Freesound).
