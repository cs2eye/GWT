# Great Western Trail — play against the AI

A browser version of Alexander Pfister's board game *Great Western Trail*, adapted for one human against an automated opponent ("Rancher Bot"). It uses plain HTML/CSS/JavaScript with no build step and no dependencies.

## Play

Open `index.html` in a browser. It works straight from the file system. You can also serve the folder (`npm start`, then visit http://localhost:8000).

- Click a highlighted location on the map to move, or use the buttons in the decision panel on the right.
- Hover over any location, station or city to see what it does.
- The **Rules** button has a short how-to-play. The **Building reference** panel lists every building action.
- The game saves to `localStorage` after every move, so reloading the page resumes it.
- **AI speed** controls how fast the bot's moves play out. Its actions appear in the log in blue.

## What's implemented

- **The trail.** Neutral buildings A–G, 16 building sites, flood/drought/rockfall hazard areas and a teepee area, with forks. Movement counts only occupied locations. You can't stop on the other cowboy's location. Hazards, teepees and the opponent's buildings charge tolls.
- **Building actions vs. auxiliary actions.** You take the location's actions in any order, or one auxiliary action instead.
- **Workers.** Cowboys, craftsmen and engineers, hired from a job market with row prices.
- **Cattle.** A deck-building herd: hand value = distinct breeds, plus a cattle market with cowboy-based prices, and drawing extra cards into the market.
- **Private buildings.** Ten of them, which can be built or upgraded in place with craftsmen.
- **Kansas City.** Foresight tile selection (3 columns), income, certificates (temporary and permanent), delivery to 10 cities, and transport costs based on how far your engine is from the city.
- **Railroad.** Engine movement (occupied spaces are skipped), 8 stations, and station-master tiles.
- **Player-board disks.** Placed when you deliver or upgrade a station. Each one unlocks a bigger hand, more steps or better auxiliary actions.
- **Objective cards.** One starting objective plus a display you take from at G.
- **Game end and scoring.** The game ends when the job market fills: that player gets +2 VP and the opponent takes one last turn. Scoring follows the usual categories.

## Differences from the board game

This is a streamlined fan adaptation, not a rules-exact copy. Building effects, prices, city values, station costs, the player-board layout and the tile mix are simplified or invented to keep the engine compact. Specific differences:

- Objective cards are held aside and are not shuffled into your deck.
- Station masters don't cost a worker.
- Disks can be taken from any unlock slot (the board game has white/black disk restrictions).
- Neighbouring city pairs give no bonus.
- If no toll route is affordable, you pay what you can.

All tunable numbers live in `js/data.js`.

## The AI

`js/ai.js` handles every decision the same way:

1. Clone the game state and re-shuffle all hidden information (deck orders, stacks), so the bot can't peek at upcoming cards.
2. Apply the option.
3. Play out the rest of its own turn greedily, looking two choices ahead at each step.
4. Score the resulting position with a heuristic: current VP, money, certificates, workers, engine position, unlocks, deck quality, objectives, and hand strength as it nears Kansas City.

In headless tests it beats a random player every time. Its main weakness is that it plans only within the current turn.

## Code layout

| File | Purpose |
| --- | --- |
| `js/data.js` | Map, buildings, cattle, cities, stations, unlocks, objectives |
| `js/engine.js` | Rules engine: JSON state + task stack, `GWT.newGame`, `GWT.choose`, `GWT.score` |
| `js/ai.js` | `GWT.aiChoose(state)` → option index |
| `js/ui.js` | SVG board rendering and input |
| `test/sim.js` | Headless AI-vs-AI / AI-vs-random games with invariant checks |

The engine never needs to know who is choosing. It stops at `state.decision = { player, type, prompt, options }`, and any front end (the UI or the AI) answers with `GWT.choose(state, index)`.

## Tests

```
npm test            # 2 AI-vs-AI games + 2 AI-vs-random games
node test/sim.js 10 # more games, prints scores and timing
```
