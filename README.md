# Game Jam (working title)

An autumn pixel-art survival game, hosted on [Betacade](https://betacade.com).

An old story says the first snow can't fall until every leaf has touched the ground. Leaves fall from the great tree in waves, and gusts blow them sideways. Tap a fire pit, or press 1–5, to burn a log there. The warm air rises and lifts leaves back up, even ones already on the ground. Logs come in slowly and fires burn out, so you keep scrambling. Score is how long you hold off winter.

The game gets harder over time: leaves fall faster and in bigger flurries, gusts get stronger, fires burn quicker and logs arrive more slowly.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

```sh
./deploy.sh
```

It uses the same Betacade token as Hold Fast (`~/.config/betacade/token`). The game id is kept in `.betacade-game`.

## Betacade hooks

- Save: `localStorage["save"]` = `{ bestTime, runs }`
- Events: `run.start`, `run.end` (`time`, `rescues`, `best`)
- Pause: `wt:pause` / `wt:resume`

## Tuning

The constants at the top of `src/main.js` set lift, gravity, logs and fuel. The difficulty ramps are the four one-line functions under "Difficulty ramps with time".
