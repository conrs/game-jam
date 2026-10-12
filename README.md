# Game Jam (working title)

An autumn pixel-art survival game, hosted on [Betacade](https://betacade.com).

An old story says the first snow can't fall until every leaf has touched the ground. Leaves fall from the great tree in waves, and gusts blow them sideways. Tap a fire pit, or press 1–5, to burn a log there. The warm air rises and lifts leaves back up, even ones already on the ground. Logs come in slowly and fires burn out, so you keep scrambling. Score is how long you hold off winter.

The game gets harder over time: leaves fall faster and in bigger flurries, gusts get stronger, fires burn quicker and logs arrive more slowly.

## Credits

Code is MIT (see `LICENSE`). Music in `assets/` is not covered by the MIT license:

- `assets/menu.mp3`: "Home at Last" by Matthew Z. (Matyze), [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), from [OpenGameArt](https://opengameart.org/content/home-at-last).
- `assets/game.mp3`: "Around the Fireplace" by Matthew Z. (Matyze), [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), from [OpenGameArt](https://opengameart.org/content/around-the-fireplace).

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

Every push to `main` deploys automatically via `.github/workflows/betacade.yml` (uses the `BETACADE_TOKEN` repo secret). To deploy by hand:

```sh
./deploy.sh
```

It uses the same Betacade token as Hold Fast (`~/.config/betacade/token`). The game id is kept in `.betacade-game`.

## itch.io

`betacade.js` (Betacade's SDK, 1.0.0) ships in every build, so copies hosted elsewhere still send play data to the same Betacade game. Each copy has to name its Betacade build in `data-build` on the script tag (the repo keeps `0`, which sends nothing). Both deploy paths make a stamped copy:

- `./deploy.sh` writes `dist/game-jam-itch-build<N>.zip`.
- The GitHub Actions run keeps it as the `game-jam-itch-build<N>` artifact.

On itch.io: Kind of project → HTML, upload the zip, tick "This file will be played in the browser".

## Betacade hooks

- Save: `localStorage["game-jam:save"]` = `{ bestTime, runs, scores }` (namespaced because itch.io shares one origin; older builds used `save`, migrated on Betacade only)
- Events: `run.start`, `run.end` (`time`, `rescues`, `best`)
- Pause: `wt:pause` / `wt:resume`

## Tuning

The constants at the top of `src/main.js` set lift, gravity, logs and fuel. The difficulty ramps are the four one-line functions under "Difficulty ramps with time".
